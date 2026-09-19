// lib/migration/cli.ts
// Operator CLI for the backend migration tool. This is the only composition
// surface for the migration modules; it never touches the application pool,
// the global repository, the build-time backend selector or NEXT_PUBLIC_*.
//
// Commands implemented at checkpoint C01: validate, inspect, preflight.
// Export/plan/resolve/apply/verify arrive with C03–C05; unknown commands fail
// with a usage error instead of doing something surprising.
//
// Exit codes are unambiguous:
//   0 success | 1 unexpected failure | 2 usage | 3 invalid bundle/content
//   4 environment/connection/configuration | 5 blocked prerequisite

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  MigrationConfigError,
  assertAuthDatabaseBinding,
  resolveAuthTarget,
  resolveDatabaseTarget,
  type ResolvedAuthTarget,
  type ResolvedDatabaseTarget,
} from './connections'
import {
  MigrationFormatError,
  bundleDigestOf,
  canonicalStringify,
  canonicalizeTimestampText,
  sha256Hex,
  type BundleManifest,
} from './format'
import {
  MigrationRunError,
  RUN_ROOT,
  RunJournal,
  createExplicitRunDirectory,
  createRunDirectory,
  randomRunId,
  redactResult,
  writeExclusiveFile,
} from './journal'
import { checkEntitySchemaCompatibility, computeSchemaFingerprint } from './schema'
import { loadBundleRows, validateBundleDirectory } from './validation'
import { openReadOnlySession, type DatabaseSession } from './providers/session'
import { inspectInstance } from './providers/native'
import { readDeploymentSnapshot } from './providers/read'
import { buildPreview, summarize, type MergePlan, type PlanningContext } from './merge-plan'
import {
  buildDecisionsTemplate,
  decisionFileSchema,
  mergePlanSchema,
  resolvePlan,
  verifyResolvedPlan,
} from './resolutions'
import {
  createSupabaseAuthAdmin,
  verifyAuthDatabaseConsistency,
  type AuthAdminPort,
} from './providers/supabase'

export const EXIT_CODES = {
  OK: 0,
  FAILURE: 1,
  USAGE: 2,
  VALIDATION: 3,
  ENVIRONMENT: 4,
  BLOCKED: 5,
} as const

export class CliUsageError extends Error {}

const BOOLEAN_FLAGS = new Set(['json', 'no-journal', 'help'])
const VALUE_FLAGS = new Set([
  'bundle',
  'source',
  'source-env',
  'target',
  'target-env',
  'auth-url-env',
  'auth-service-key-env',
  'target-app-version',
  'run-dir',
  'out',
  'plan',
  'decisions',
])

export interface ParsedCli {
  command: string | null
  flags: Map<string, string>
  booleans: Set<string>
}

export function parseArgs(argv: string[]): ParsedCli {
  const flags = new Map<string, string>()
  const booleans = new Set<string>()
  const positionals: string[] = []
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token.startsWith('--')) {
      const equals = token.indexOf('=')
      const name = equals === -1 ? token.slice(2) : token.slice(2, equals)
      const inline = equals === -1 ? null : token.slice(equals + 1)
      if (BOOLEAN_FLAGS.has(name)) {
        if (inline !== null) throw new CliUsageError(`Flag --${name} does not take a value.`)
        booleans.add(name)
        continue
      }
      if (!VALUE_FLAGS.has(name)) throw new CliUsageError(`Unknown flag --${name}.`)
      let value = inline
      if (value === null) {
        const next = argv[i + 1]
        if (next === undefined || next.startsWith('--')) {
          throw new CliUsageError(`Flag --${name} requires a value.`)
        }
        value = next
        i += 1
      }
      if (value.length === 0) throw new CliUsageError(`Flag --${name} requires a non-empty value.`)
      flags.set(name, value)
      continue
    }
    positionals.push(token)
  }
  return { command: positionals[0] ?? null, flags, booleans }
}

export function helpText(): string {
  return [
    'Usage: npm run migration -- <command> [flags]',
    '',
    'Commands:',
    '  validate   Offline bundle validation (no database access).',
    '  inspect    Read-only inspection of one database endpoint.',
    '  preflight  Validate a bundle against a target endpoint without writing.',
    '  plan       Read-only preview plan for merging a bundle into a target.',
    '  resolve    Apply a reviewed decision file to a plan (no database access).',
    '',
    'Flags:',
    '  --bundle <dir>                 Bundle directory (manifest.json + JSONL files).',
    '  --source <native|supabase>     Source provider for inspect/preflight.',
    '  --source-env <MIGRATION_ENV>   Env var holding the source connection string.',
    '  --target <native|supabase>     Target provider for inspect/preflight/plan.',
    '  --target-env <MIGRATION_ENV>   Env var holding the target connection string.',
    '  --auth-url-env <MIGRATION_ENV>        Supabase Auth URL env var (required for supabase targets).',
    '  --auth-service-key-env <MIGRATION_ENV> Supabase service-role key env var (required for supabase targets).',
    '  --target-app-version <version> Application release declared for the target.',
    '  --run-dir <dir>                Explicit run directory (must not exist).',
    '  --out <path>                   Artifact path for plan/resolve output (must not exist).',
    '  --plan <path>                  Reviewed plan JSON for resolve.',
    '  --decisions <path>             Operator decision file for resolve.',
    '  --json                         Emit a single redacted JSON result.',
    '  --no-journal                   Do not create a run directory/journal.',
    '',
    'Connection material is only ever read from explicitly named MIGRATION_* env vars;',
    'the CLI never falls back to DATABASE_URL or the application pool.',
  ].join('\n')
}

export interface CliDependencies {
  env?: Record<string, string | undefined>
  cwd?: string
  now?: () => Date
  out?: (line: string) => void
  err?: (line: string) => void
  openSession?: (target: ResolvedDatabaseTarget) => DatabaseSession
  openAuthAdmin?: (target: ResolvedAuthTarget) => AuthAdminPort
  runRoot?: string
}

class CliFailure extends Error {
  readonly exitCode: number
  readonly code: string
  readonly result: Record<string, unknown> | null

  constructor(exitCode: number, code: string, message: string, result?: Record<string, unknown>) {
    super(message)
    this.name = 'CliFailure'
    this.exitCode = exitCode
    this.code = code
    this.result = result ?? null
  }
}

interface LoggedSession {
  session: DatabaseSession
  identity: Awaited<ReturnType<DatabaseSession['identity']>>
  inspection: Awaited<ReturnType<typeof inspectInstance>>
}

function requireFlag(parsed: ParsedCli, name: string): string {
  const value = parsed.flags.get(name)
  if (value === undefined) throw new CliUsageError(`Flag --${name} is required for this command.`)
  return value
}

function connectionPair(
  parsed: ParsedCli,
  role: 'source' | 'target'
): { provider: string; envName: string } {
  const provider = parsed.flags.get(role)
  const envName = parsed.flags.get(`${role}-env`)
  if (provider === undefined && envName === undefined) {
    throw new CliUsageError(`Provide both --${role} and --${role}-env.`)
  }
  if (provider === undefined || envName === undefined) {
    throw new CliUsageError(`Provide both --${role} and --${role}-env together.`)
  }
  return { provider, envName }
}

function authPair(parsed: ParsedCli): { urlEnvName: string; keyEnvName: string } | null {
  const urlEnvName = parsed.flags.get('auth-url-env')
  const keyEnvName = parsed.flags.get('auth-service-key-env')
  if (urlEnvName === undefined && keyEnvName === undefined) return null
  if (urlEnvName === undefined || keyEnvName === undefined) {
    throw new CliUsageError('Provide --auth-url-env and --auth-service-key-env together.')
  }
  return { urlEnvName, keyEnvName }
}

async function inspectTarget(
  deps: Required<Pick<CliDependencies, 'openSession'>>,
  target: ResolvedDatabaseTarget,
  journal: RunJournal | null
): Promise<LoggedSession> {
  const session = deps.openSession(target)
  journal?.append(target.role === 'source' ? 'inspect-source' : 'inspect-target', 'connect', {
    provider: target.provider,
    displayTarget: target.displayTarget,
  })
  await session.assertReadOnly()
  journal?.append(target.role === 'source' ? 'inspect-source' : 'inspect-target', 'read-only-probe', {
    result: 'write-rejected',
  })
  const inspection = await inspectInstance(session)
  journal?.append(target.role === 'source' ? 'inspect-source' : 'inspect-target', 'inspected', {
    namespace: inspection.identity.namespace,
    database: inspection.identity.database,
    counts: inspection.counts,
    missingTables: inspection.missingTables,
  })
  return { session, identity: inspection.identity, inspection }
}

function summaryOf(result: Record<string, unknown>, out: (line: string) => void): void {
  for (const [key, value] of Object.entries(result)) {
    if (value === null || value === undefined) continue
    if (Array.isArray(value)) {
      out(`${key}: ${value.length > 0 ? value.map((v) => (typeof v === 'object' ? JSON.stringify(v) : String(v))).join(', ') : '(none)'}`)
      continue
    }
    if (typeof value === 'object') {
      out(`${key}: ${JSON.stringify(value)}`)
      continue
    }
    out(`${key}: ${String(value)}`)
  }
}

function openJournal(
  deps: CliDependencies,
  parsed: ParsedCli,
  command: string,
  extra: { provider?: string; role?: string; bundleDigest?: string | null }
): RunJournal | null {
  if (parsed.booleans.has('no-journal')) return null
  const now = deps.now ?? (() => new Date())
  const runId = randomRunId()
  const explicit = parsed.flags.get('run-dir')
  const directory = explicit
    ? createExplicitRunDirectory(explicit)
    : createRunDirectory(deps.runRoot ?? join(deps.cwd ?? process.cwd(), RUN_ROOT), command, now())
  const journal = RunJournal.open(
    directory,
    {
      runId,
      command,
      provider: extra.provider,
      role: extra.role,
      bundleDigest: extra.bundleDigest ?? null,
    },
    now
  )
  journal.acquireLock()
  return journal
}

function finishJournal(journal: RunJournal | null, result: Record<string, unknown>): void {
  if (!journal) return
  journal.append('run', 'result', result)
  writeExclusiveFile(join(journal.directory, 'result.json'), `${JSON.stringify(redactResult(result), null, 2)}\n`)
  journal.releaseLock()
}

async function runValidate(parsed: ParsedCli, deps: CliDependencies): Promise<Record<string, unknown>> {
  const bundle = requireFlag(parsed, 'bundle')
  const journal = openJournal(deps, parsed, 'validate', {})
  try {
    const validation = await validateBundleDirectory(bundle)
    const result: Record<string, unknown> = {
      command: 'validate',
      bundle,
      ok: validation.ok,
      bundleDigest: validation.bundleDigest,
      entities: validation.entities.map((e) => ({ entity: e.entity, rowCount: e.rowCount, byteSize: e.byteSize })),
      errors: validation.errors,
      warnings: validation.warnings,
      journal: journal ? journal.directory : null,
    }
    journal?.append('validate', validation.ok ? 'bundle-valid' : 'bundle-invalid', {
      bundleDigest: validation.bundleDigest,
      errorCount: validation.errors.length,
    })
    finishJournal(journal, result)
    if (!validation.ok) {
      throw new CliFailure(EXIT_CODES.VALIDATION, 'E_BUNDLE_INVALID', 'Bundle validation failed.', result)
    }
    return result
  } catch (error) {
    journal?.releaseLock()
    throw error
  }
}

async function runInspect(parsed: ParsedCli, deps: CliDependencies): Promise<Record<string, unknown>> {
  const hasSource = parsed.flags.has('source') || parsed.flags.has('source-env')
  const hasTarget = parsed.flags.has('target') || parsed.flags.has('target-env')
  if (hasSource === hasTarget) {
    throw new CliUsageError('inspect requires exactly one of --source/--source-env or --target/--target-env.')
  }
  const role = hasSource ? 'source' : 'target'
  const pair = connectionPair(parsed, role)
  const auth = authPair(parsed)
  const env = deps.env ?? process.env
  const target = resolveDatabaseTarget({
    provider: pair.provider,
    role: role === 'source' ? 'source' : 'destination',
    envName: pair.envName,
    env: env,
  })
  const journal = openJournal(deps, parsed, 'inspect', { provider: target.provider, role })
  let session: DatabaseSession | null = null
  try {
    const logged = await inspectTarget({ openSession: deps.openSession ?? openReadOnlySession }, target, journal)
    session = logged.session
    let authEvidence: Record<string, unknown> | null = null
    if (auth) {
      if (target.provider !== 'supabase') {
        throw new CliUsageError('Auth flags are only valid for a supabase endpoint.')
      }
      const authTarget = resolveAuthTarget({ role: target.role, ...auth, env })
      assertAuthDatabaseBinding(target, authTarget)
      const admin = (deps.openAuthAdmin ?? createSupabaseAuthAdmin)(authTarget)
      const binding = await verifyAuthDatabaseConsistency(session, admin)
      authEvidence = { verified: binding.verified, detail: binding.detail }
      journal?.append('inspect', 'auth-binding', authEvidence)
    }
    const result: Record<string, unknown> = {
      command: 'inspect',
      role,
      provider: target.provider,
      displayTarget: target.displayTarget,
      namespace: logged.identity.namespace,
      runtimeFingerprint: logged.identity.runtimeFingerprint,
      database: logged.identity.database,
      serverVersion: logged.identity.serverVersion,
      systemIdentifier: logged.identity.systemIdentifier,
      schemaFingerprint: computeSchemaFingerprint(logged.inspection.catalog),
      counts: logged.inspection.counts,
      missingTables: logged.inspection.missingTables,
      appliedMigrations: logged.inspection.appliedMigrations,
      auth: authEvidence,
      journal: journal ? journal.directory : null,
    }
    finishJournal(journal, result)
    return result
  } catch (error) {
    journal?.releaseLock()
    throw error
  } finally {
    if (session) await session.close()
  }
}

async function runPreflight(parsed: ParsedCli, deps: CliDependencies): Promise<Record<string, unknown>> {
  const bundle = requireFlag(parsed, 'bundle')
  const targetPair = connectionPair(parsed, 'target')
  const hasSource = parsed.flags.has('source') || parsed.flags.has('source-env')
  const sourcePair = hasSource ? connectionPair(parsed, 'source') : null
  const auth = authPair(parsed)
  const env = deps.env ?? process.env

  const validation = await validateBundleDirectory(bundle)
  if (!validation.ok || !validation.manifest) {
    throw new CliFailure(EXIT_CODES.VALIDATION, 'E_BUNDLE_INVALID', 'Bundle validation failed; preflight aborted.', {
      command: 'preflight',
      ok: false,
      errors: validation.errors,
    })
  }
  const manifest: BundleManifest = validation.manifest
  const journal = openJournal(deps, parsed, 'preflight', {
    provider: targetPair.provider,
    bundleDigest: bundleDigestOf(manifest),
  })
  const blockers: string[] = []
  const checks: Array<{ id: string; status: 'pass' | 'fail' | 'blocked'; detail: string }> = []
  let session: DatabaseSession | null = null
  let sourceSession: DatabaseSession | null = null
  try {
    checks.push({ id: 'bundle', status: 'pass', detail: `Bundle valid (${manifest.entities.length} entities).` })

    const target = resolveDatabaseTarget({
      provider: targetPair.provider,
      role: 'destination',
      envName: targetPair.envName,
      env,
    })
    const logged = await inspectTarget({ openSession: deps.openSession ?? openReadOnlySession }, target, journal)
    session = logged.session

    const probe = 'read-only write probe rejected'
    checks.push({ id: 'target-readonly-session', status: 'pass', detail: probe })

    const schemaIssues = checkEntitySchemaCompatibility(
      logged.inspection.catalog,
      manifest.transformations
    )
    if (logged.inspection.missingTables.length > 0) {
      checks.push({
        id: 'target-schema',
        status: 'fail',
        detail: `Missing tables: ${logged.inspection.missingTables.join(', ')}`,
      })
    } else if (schemaIssues.length > 0) {
      checks.push({
        id: 'target-schema',
        status: 'fail',
        detail: schemaIssues.map((issue) => issue.message).join(' | '),
      })
    } else {
      checks.push({
        id: 'target-schema',
        status: 'pass',
        detail: `Target schema fingerprint ${computeSchemaFingerprint(logged.inspection.catalog).slice(0, 16)} is compatible.`,
      })
    }

    if (logged.inspection.appliedMigrations.length === 0) {
      checks.push({ id: 'target-migrations', status: 'fail', detail: 'Target migration ledger is empty.' })
    } else {
      checks.push({
        id: 'target-migrations',
        status: 'pass',
        detail: `${logged.inspection.appliedMigrations.length} applied migrations recorded.`,
      })
    }

    if (sourcePair) {
      const source = resolveDatabaseTarget({
        provider: sourcePair.provider,
        role: 'source',
        envName: sourcePair.envName,
        env,
      })
      const loggedSource = await inspectTarget({ openSession: deps.openSession ?? openReadOnlySession }, source, journal)
      sourceSession = loggedSource.session
      if (
        loggedSource.identity.namespace === logged.identity.namespace ||
        loggedSource.identity.runtimeFingerprint === logged.identity.runtimeFingerprint
      ) {
        checks.push({
          id: 'distinct-instances',
          status: 'fail',
          detail: 'Source and target resolve to the same database instance.',
        })
      } else {
        checks.push({
          id: 'distinct-instances',
          status: 'pass',
          detail: 'Source and target are distinct database instances.',
        })
      }
    }

    if (target.provider === 'supabase') {
      if (!auth) {
        blockers.push('A supabase target requires --auth-url-env and --auth-service-key-env before apply.')
        checks.push({
          id: 'auth-binding',
          status: 'blocked',
          detail: 'Supabase Auth endpoint/key not supplied.',
        })
      } else {
        const authTarget = resolveAuthTarget({ role: 'destination', ...auth, env })
        assertAuthDatabaseBinding(target, authTarget)
        const admin = (deps.openAuthAdmin ?? createSupabaseAuthAdmin)(authTarget)
        const binding = await verifyAuthDatabaseConsistency(session, admin)
        if (binding.verified) {
          checks.push({ id: 'auth-binding', status: 'pass', detail: binding.detail })
        } else {
          blockers.push(`Auth binding unverified: ${binding.detail}`)
          checks.push({ id: 'auth-binding', status: 'blocked', detail: binding.detail })
        }
      }
    } else {
      checks.push({ id: 'auth-binding', status: 'pass', detail: 'Native target uses in-app credentials.' })
    }

    const failures = checks.filter((check) => check.status === 'fail')
    const result: Record<string, unknown> = {
      command: 'preflight',
      ok: failures.length === 0 && blockers.length === 0,
      bundleDigest: bundleDigestOf(manifest),
      sourceNamespace: null,
      targetNamespace: logged.identity.namespace,
      checks,
      blockers,
      journal: journal ? journal.directory : null,
    }
    finishJournal(journal, result)
    if (failures.length > 0) {
      throw new CliFailure(EXIT_CODES.VALIDATION, 'E_PREFLIGHT_FAILED', 'Preflight checks failed.', result)
    }
    if (blockers.length > 0) {
      throw new CliFailure(EXIT_CODES.BLOCKED, 'E_PREFLIGHT_BLOCKED', 'Preflight is blocked pending required inputs.', result)
    }
    return result
  } catch (error) {
    journal?.releaseLock()
    throw error
  } finally {
    if (session) await session.close()
    if (sourceSession) await sourceSession.close()
  }
}

function assertWritableArtifactPath(path: string, bundle: string | null): void {
  const normalized = path.replace(/\\/g, '/')
  if (bundle && (normalized === bundle.replace(/\\/g, '/') || normalized.startsWith(`${bundle.replace(/\\/g, '/').replace(/\/$/, '')}/`))) {
    throw new CliUsageError('--out must not point inside the source bundle directory.')
  }
}

async function runPlan(parsed: ParsedCli, deps: CliDependencies): Promise<Record<string, unknown>> {
  const bundle = requireFlag(parsed, 'bundle')
  const out = requireFlag(parsed, 'out')
  assertWritableArtifactPath(out, bundle)
  const targetPair = connectionPair(parsed, 'target')
  const auth = authPair(parsed)
  const declaredTargetVersion = parsed.flags.get('target-app-version') ?? 'unverified'
  const env = deps.env ?? process.env

  const validation = await validateBundleDirectory(bundle)
  if (!validation.ok || !validation.manifest) {
    throw new CliFailure(EXIT_CODES.VALIDATION, 'E_BUNDLE_INVALID', 'Bundle validation failed; planning aborted.', {
      command: 'plan',
      ok: false,
      errors: validation.errors,
    })
  }
  const manifest = validation.manifest
  const bundleDigest = bundleDigestOf(manifest)
  const journal = openJournal(deps, parsed, 'plan', { provider: targetPair.provider, bundleDigest })

  let session: DatabaseSession | null = null
  try {
    const target = resolveDatabaseTarget({
      provider: targetPair.provider,
      role: 'destination',
      envName: targetPair.envName,
      env,
    })
    const logged = await inspectTarget({ openSession: deps.openSession ?? openReadOnlySession }, target, journal)
    session = logged.session

    if (target.provider === 'supabase') {
      if (!auth) {
        throw new CliFailure(
          EXIT_CODES.BLOCKED,
          'E_AUTH_REQUIRED',
          'A supabase target requires --auth-url-env and --auth-service-key-env so the plan can bind Auth to this database.',
          { command: 'plan', ok: false }
        )
      }
      const authTarget = resolveAuthTarget({ role: 'destination', ...auth, env })
      assertAuthDatabaseBinding(target, authTarget)
      const admin = (deps.openAuthAdmin ?? createSupabaseAuthAdmin)(authTarget)
      const binding = await verifyAuthDatabaseConsistency(session, admin)
      journal?.append('plan', 'auth-binding', { verified: binding.verified, detail: binding.detail })
      if (!binding.verified) {
        throw new CliFailure(EXIT_CODES.BLOCKED, 'E_AUTH_UNVERIFIED', binding.detail, {
          command: 'plan',
          ok: false,
        })
      }
    }

    const schemaIssues = checkEntitySchemaCompatibility(logged.inspection.catalog, manifest.transformations)
    if (logged.inspection.missingTables.length > 0 || schemaIssues.length > 0) {
      throw new CliFailure(EXIT_CODES.VALIDATION, 'E_TARGET_SCHEMA', 'Target schema is not compatible with this bundle.', {
        command: 'plan',
        ok: false,
        missingTables: logged.inspection.missingTables,
        issues: schemaIssues,
      })
    }

    const sourceRows = await loadBundleRows(bundle, manifest)
    const snapshot = await readDeploymentSnapshot(session)
    const context: PlanningContext = {
      manifest,
      provenance: validation.aliases,
      sourceRows,
      target: snapshot,
      targetApplicationVersion: declaredTargetVersion,
      targetSchemaFingerprint: computeSchemaFingerprint(logged.inspection.catalog),
    }
    const plan = buildPreview(context, {
      runId: journal?.runId ?? randomRunId(),
      createdAt: canonicalizeTimestampText((deps.now ?? (() => new Date()))().toISOString()),
    })
    const template = buildDecisionsTemplate(plan, {
      name: parsed.flags.get('operator') ?? 'operator',
      at: plan.createdAt,
    })

    writeExclusiveFile(out, `${JSON.stringify(plan, null, 2)}\n`)
    writeExclusiveFile(`${out}.decisions.json`, `${JSON.stringify(template, null, 2)}\n`)

    const result: Record<string, unknown> = {
      command: 'plan',
      ok: true,
      out,
      decisionsTemplate: `${out}.decisions.json`,
      planDigest: plan.planDigest,
      bundleDigest,
      targetNamespace: plan.target.namespace,
      counts: plan.counts,
      unresolvedCount: plan.unresolved.length,
      unresolved: plan.unresolved.slice(0, 50),
      summary: summarize(plan),
      journal: journal ? journal.directory : null,
    }
    journal?.append('plan', 'preview-built', {
      planDigest: plan.planDigest,
      unresolved: plan.unresolved.length,
    })
    finishJournal(journal, result)
    return result
  } catch (error) {
    journal?.releaseLock()
    throw error
  } finally {
    if (session) await session.close()
  }
}

async function runResolve(parsed: ParsedCli, deps: CliDependencies): Promise<Record<string, unknown>> {
  const planPath = requireFlag(parsed, 'plan')
  const decisionsPath = requireFlag(parsed, 'decisions')
  const out = requireFlag(parsed, 'out')
  const journal = openJournal(deps, parsed, 'resolve', {})
  try {
    const planJson = JSON.parse(readFileSync(planPath, 'utf8')) as unknown
    const planParse = mergePlanSchema.safeParse(planJson)
    if (!planParse.success) {
      throw new CliFailure(EXIT_CODES.VALIDATION, 'E_PLAN_SCHEMA', 'Plan file does not match the reviewed plan format.', {
        command: 'resolve',
        ok: false,
        issues: planParse.error.issues.map((issue) => issue.message),
      })
    }
    const plan = planParse.data as MergePlan
    const planWithoutDigest = { ...plan } as Record<string, unknown>
    delete planWithoutDigest.planDigest
    if (sha256Hex(canonicalStringify(planWithoutDigest)) !== plan.planDigest) {
      throw new CliFailure(EXIT_CODES.VALIDATION, 'E_PLAN_TAMPERED', 'The plan document does not match its own digest.', {
        command: 'resolve',
        ok: false,
      })
    }

    const decisionsJson = JSON.parse(readFileSync(decisionsPath, 'utf8')) as unknown
    const decisionsParse = decisionFileSchema.safeParse(decisionsJson)
    if (!decisionsParse.success) {
      throw new CliFailure(
        EXIT_CODES.VALIDATION,
        'E_DECISIONS_SCHEMA',
        'Decision file does not match the reviewed resolution format.',
        { command: 'resolve', ok: false, issues: decisionsParse.error.issues.map((issue) => issue.message) }
      )
    }

    const outcome = resolvePlan(plan, decisionsParse.data)
    if (!outcome.ok || !outcome.resolvedPlan) {
      throw new CliFailure(EXIT_CODES.VALIDATION, 'E_RESOLUTION_INVALID', 'The submitted decisions do not produce a valid merged state.', {
        command: 'resolve',
        ok: false,
        issues: outcome.issues,
      })
    }
    const verification = verifyResolvedPlan(outcome.resolvedPlan)
    if (verification.length > 0) {
      throw new CliFailure(EXIT_CODES.VALIDATION, 'E_RESOLVED_PLAN_INVALID', 'Resolved plan failed its digest checks.', {
        command: 'resolve',
        ok: false,
        issues: verification,
      })
    }

    writeExclusiveFile(out, `${JSON.stringify(outcome.resolvedPlan, null, 2)}\n`)
    const result: Record<string, unknown> = {
      command: 'resolve',
      ok: true,
      out,
      planDigest: plan.planDigest,
      expectedResultDigest: outcome.resolvedPlan.expectedResultDigest,
      resolutionDigest: outcome.resolvedPlan.resolutionDigest,
      exclusions: outcome.resolvedPlan.exclusions.length,
      entries: outcome.resolvedPlan.entries.length,
      journal: journal ? journal.directory : null,
    }
    journal?.append('resolve', 'resolved', {
      expectedResultDigest: outcome.resolvedPlan.expectedResultDigest,
      exclusions: outcome.resolvedPlan.exclusions.length,
    })
    finishJournal(journal, result)
    return result
  } catch (error) {
    journal?.releaseLock()
    throw error
  }
}

function describeError(error: unknown): { exitCode: number; code: string; message: string } {
  if (error instanceof CliUsageError) return { exitCode: EXIT_CODES.USAGE, code: 'E_USAGE', message: error.message }
  if (error instanceof MigrationConfigError) {
    return { exitCode: EXIT_CODES.ENVIRONMENT, code: error.code, message: error.message }
  }
  if (error instanceof MigrationFormatError) {
    return { exitCode: EXIT_CODES.VALIDATION, code: error.code, message: error.message }
  }
  if (error instanceof MigrationRunError) {
    return { exitCode: EXIT_CODES.ENVIRONMENT, code: error.code, message: error.message }
  }
  const message = error instanceof Error ? error.message : String(error)
  return { exitCode: EXIT_CODES.FAILURE, code: 'E_UNEXPECTED', message }
}

export async function runCli(argv: string[], deps: CliDependencies = {}): Promise<number> {
  const out = deps.out ?? ((line: string) => process.stdout.write(`${line}\n`))
  const err = deps.err ?? ((line: string) => process.stderr.write(`${line}\n`))
  let parsed: ParsedCli
  try {
    parsed = parseArgs(argv)
  } catch (error) {
    err(describeError(error).message)
    err(helpText())
    return EXIT_CODES.USAGE
  }
  const json = parsed.booleans.has('json')

  const emit = (result: Record<string, unknown>): void => {
    if (json) out(JSON.stringify(redactResult(result), null, 2))
    else summaryOf(redactResult(result) as Record<string, unknown>, out)
  }

  if (parsed.command === null || parsed.booleans.has('help') || parsed.command === 'help') {
    if (parsed.command === 'help' || parsed.booleans.has('help')) {
      out(helpText())
      return EXIT_CODES.OK
    }
    err('A command is required.')
    err(helpText())
    return EXIT_CODES.USAGE
  }

  try {
    switch (parsed.command) {
      case 'validate': {
        emit(await runValidate(parsed, deps))
        return EXIT_CODES.OK
      }
      case 'inspect': {
        emit(await runInspect(parsed, deps))
        return EXIT_CODES.OK
      }
      case 'preflight': {
        emit(await runPreflight(parsed, deps))
        return EXIT_CODES.OK
      }
      case 'plan': {
        emit(await runPlan(parsed, deps))
        return EXIT_CODES.OK
      }
      case 'resolve': {
        emit(await runResolve(parsed, deps))
        return EXIT_CODES.OK
      }
      default: {
        err(`Unknown command "${parsed.command}".`)
        err(helpText())
        return EXIT_CODES.USAGE
      }
    }
  } catch (error) {
    if (error instanceof CliFailure) {
      emit(error.result ?? { ok: false, error: error.message })
      err(`${error.code}: ${error.message}`)
      return error.exitCode
    }
    const described = describeError(error)
    if (json) {
      out(JSON.stringify({ ok: false, code: described.code, error: described.message }, null, 2))
    } else {
      err(`${described.code}: ${described.message}`)
    }
    return described.exitCode
  }
}
