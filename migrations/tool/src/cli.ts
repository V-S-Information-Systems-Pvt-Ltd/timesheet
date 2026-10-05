// migrations/tool/src/cli.ts
// Operator CLI for the backend migration tool. This is the only composition
// surface for the migration modules; it never touches the application pool,
// the global repository, the build-time backend selector or NEXT_PUBLIC_*.
//
// Unknown commands fail with a usage error.
//
// Exit codes are unambiguous:
//   0 success | 1 unexpected failure | 2 usage | 3 invalid bundle/content
//   4 environment/connection/configuration | 5 blocked prerequisite

import { closeSync, openSync, readFileSync, realpathSync, writeSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
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
  redactString,
  writeExclusiveFile,
} from './journal'
import {
  CURRENT_APPLICATION_RELEASE,
  SUPPORTED_APPLICATION_RELEASES,
  checkEntitySchemaCompatibility,
  checkMigrationLedger,
  computeSchemaFingerprint,
  isSupportedApplicationRelease,
  isSupportedApplicationTransition,
  isSupportedSchemaFingerprint,
} from './schema'
import { loadBundleRows, validateBundleDirectory } from './validation'
import { openReadOnlySession, openWriteSession, type DatabaseSession, type WriteSession } from './providers/session'
import { readWriteGate, recoverWriteGate, setWriteGate, type WriteGateChange } from './gate'
import {
  activateFenceInTransaction,
  createFenceArtifact,
  inventoryFence,
  parseFenceArtifact,
  parseFenceRoles,
  restoreFenceGrants,
  verifyFence,
} from './providers/fence'
import { admitWriters, recordPublicationIntent, recordVerifiedState } from './publish'
import { inspectInstance } from './providers/native'
import { readDeploymentSnapshot, readDestinationProvenanceReceipts } from './providers/read'
import { buildPreview, summarize, type MergePlan, type PlanningContext, type ResolvedPlan } from './merge-plan'
import { exportBundle } from './export'
import { applyResolvedPlan, reconcile } from './import'
import {
  buildDecisionsTemplate,
  decisionFileSchema,
  mergePlanSchema,
  resolvePlan,
  resolvedPlanSchema,
  verifyResolvedPlan,
} from './resolutions'
import {
  createSupabaseAuthAdmin,
  verifyAuthDatabaseConsistency,
  type AuthAdminPort,
} from './providers/supabase'
import {
  captureRetirementEvidence,
  parseRetirementDeclaration,
} from './retirement-inventory'

export const EXIT_CODES = {
  OK: 0,
  FAILURE: 1,
  USAGE: 2,
  VALIDATION: 3,
  ENVIRONMENT: 4,
  BLOCKED: 5,
} as const

export class CliUsageError extends Error {}

const BOOLEAN_FLAGS = new Set(['json', 'no-journal', 'help', 'recovery', 'record'])
const VALUE_FLAGS = new Set([
  'bundle',
  'source',
  'source-env',
  'target',
  'target-env',
  'auth-url-env',
  'auth-service-key-env',
  'target-app-version',
  'app-version',
  'operator',
  'run-dir',
  'run-id',
  'out',
  'plan',
  'decisions',
  'expect-plan-digest',
  'state',
  'reason',
  'actor',
  'phase',
  'action',
  'role',
  'inventory',
  'manifest',
])

export interface ParsedCli {
  command: string | null
  flags: Map<string, string>
  booleans: Set<string>
}

/** Run-time refusals that are operator-actionable, so they exit BLOCKED (5). */
const BLOCKED_RUN_CODES = new Set([
  'E_WRITERS_NOT_FENCED',
  'E_GATE_MISSING',
  'E_FENCE_MISMATCH',
  'E_TARGET_MISMATCH',
  'E_RUN_ID_REUSED',
  'E_RECOVERY_AFTER_INTENT',
  'E_LEDGER_INCOMPLETE',
  'E_PUBLICATION_STATE',
  'E_RECEIPT_MISSING',
  'E_AUTH_REQUIRED',
  'E_SESSION_WRITE_BLOCKED',
  'E_SOURCE_WRITABLE',
  'E_WRITE_ROLE',
  'E_INSTANCE_IDENTITY_UNAVAILABLE',
  'E_RETIREMENT_EVIDENCE_BLOCKED',
  'E_RETIREMENT_EVIDENCE_INCOMPATIBLE',
  'E_RETIREMENT_IDENTITY_MISMATCH',
  'E_RETIREMENT_VISIBILITY_UNVERIFIED',
])

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
    '  export     Read-only export of one deployment into a bundle directory.',
    '  apply      Apply a resolved plan to the destination in one transaction.',
    '  verify     Re-read the destination and compare it with the resolved plan.',
    '               --record persists the verified receipt state (needs a write connection)',
    '  publish    Record publication intent or admit writers (--phase intent|admit).',
    '               --run-id <id> --reason <text> [--actor <name>]',
    '  gate       Read or set the durable destination write gate (C06B fence).',
    '               --state open|fenced --reason <text> [--actor <name>] [--run-id <id>] [--recovery]',
    '  fence      Provider-level write fence: revoke/restore DML for writer roles (plan §11).',
    '               --action inventory|activate|verify|release --role <role[,role…]> --reason <text>',
    '               activate writes the grant inventory to --out (exclusive); release needs',
    '               --inventory <file> and is gated on a writable receipt or --recovery.',
    '  retirement-inventory  Capture Phase 4 evidence without assessing or changing retirement gates.',
    '               --target <provider> --target-env <MIGRATION_ENV> --manifest <file> --out <file>',
    '',
    'Flags:',
    '  --bundle <dir>                 Bundle directory (manifest.json + JSONL files).',
    '  --source <native|supabase>     Source provider for inspect/preflight.',
    '  --source-env <MIGRATION_ENV>   Env var holding the source connection string.',
    '  --target <native|supabase>     Target provider for inspect/preflight/plan.',
    '  --target-env <MIGRATION_ENV>   Env var holding the target connection string.',
    '  --auth-url-env <MIGRATION_ENV>        Supabase Auth URL env var (required for supabase targets).',
    '  --auth-service-key-env <MIGRATION_ENV> Supabase service-role key env var (required for supabase targets).',
    '  --target-app-version <version> Application release declared for the target; apply compares it against the reviewed plan.',
    '  --run-dir <dir>                Explicit run directory (must not exist).',
    '  --out <path>                   Artifact path for plan/resolve output (must not exist).',
    '  --manifest <path>              Versioned deployment declaration for retirement-inventory.',
    '  --plan <path>                  Reviewed plan JSON for resolve/apply/verify.',
    '  --decisions <path>             Operator decision file for resolve.',
    '  --expect-plan-digest <digest>  Reviewed plan digest required by apply.',
    '  --run-id <id>                  Recorded run id used by apply/verify and receipts.',
    '  --app-version <version>        Application release recorded in an exported bundle.',
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
  openWrite?: (target: ResolvedDatabaseTarget) => WriteSession
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

type FenceReleaseAuthorization =
  | { ok: true; restoredStatements: number }
  | { ok: false; issue: { code: string; message: string } }

/**
 * Fence release is a single critical section: lock the durable gate and the
 * artifact's receipt, decide whether this protocol path admits release, then
 * restore the grants before either lock is released.
 */
async function releaseFenceWithAuthorization(
  session: WriteSession,
  inventory: import('./providers/fence').FenceArtifact,
  targetNamespace: string,
  recovery: boolean
): Promise<FenceReleaseAuthorization> {
  try {
    return await session.transaction(async (tx) => {
    const gates = await tx.query<{
      state: string
      run_id: string | null
      fence_generation: string
      updated_at: string
    }>(
      `select state, run_id, fence_generation,
              to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as updated_at
         from public.migration_write_gate where id for update`
    )
    const gate = gates[0]
    if (!gate) {
      return {
        ok: false,
        issue: { code: 'E_FENCE_GATE_BINDING', message: 'The durable migration write gate row is missing; refusing to release provider privileges.' },
      }
    }
    const receipts = await tx.query<{ state: string }>(
      `select state from public.migration_runs
        where run_id = $1 and target_namespace = $2 for update`,
      [inventory.runId, targetNamespace]
    )
    if (recovery) {
      if (gate.state !== 'fenced' || gate.run_id !== inventory.runId || gate.updated_at !== inventory.gateUpdatedAt || gate.fence_generation !== inventory.gateGeneration) {
        return {
          ok: false,
          issue: {
            code: 'E_FENCE_GATE_BINDING',
            message: 'Recovery release requires the same fenced durable gate generation captured by this inventory artifact.',
          },
        }
      }
    } else if (gate.state !== 'open' || gate.run_id !== inventory.runId || gate.fence_generation !== inventory.gateGeneration || receipts[0]?.state !== 'writable') {
      return {
        ok: false,
        issue: {
          code: 'E_FENCE_RELEASE_GATED',
          message: 'Normal fence release requires this artifact\'s writable receipt and the same run\'s durable gate already open through publication.',
        },
      }
    }
    const restored = await restoreFenceGrants(tx, inventory)
      return { ok: true, restoredStatements: restored.restoredStatements }
    })
  } catch (error) {
    if ((error as { code?: string }).code === '42P01') {
      return {
        ok: false,
        issue: { code: 'E_FENCE_GATE_BINDING', message: 'The durable migration write gate table is missing; refusing to release provider privileges.' },
      }
    }
    throw error
  }
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
  const bundle = parsed.flags.get('bundle') ?? null
  const explicit = parsed.flags.get('run-dir')
  const runRoot = deps.runRoot ?? join(deps.cwd ?? process.cwd(), RUN_ROOT)
  if (bundle) {
    assertArtifactPathOutsideBundle(explicit ?? runRoot, bundle, '--run-dir/--runRoot')
  }
  const directory = explicit
    ? createExplicitRunDirectory(explicit)
    : createRunDirectory(runRoot, command, now())
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
      schemaFingerprint: computeSchemaFingerprint(logged.inspection.catalog, target.provider),
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

    const targetRelease = parsed.flags.get('target-app-version') ?? CURRENT_APPLICATION_RELEASE
    if (manifest.tool.applicationVersion !== manifest.source.applicationVersion) {
      checks.push({
        id: 'release-compatibility',
        status: 'fail',
        detail: `Bundle tool application release ${manifest.tool.applicationVersion} does not match its source declaration ${manifest.source.applicationVersion}.`,
      })
    } else if (
      !isSupportedApplicationTransition(manifest.source, { provider: targetPair.provider, applicationVersion: targetRelease })
    ) {
      checks.push({
        id: 'release-compatibility',
        status: 'fail',
        detail: `Unsupported application transition ${manifest.source.provider} ${manifest.source.applicationVersion} to ${targetPair.provider} ${targetRelease}.`,
      })
    } else {
      checks.push({
        id: 'release-compatibility',
        status: 'pass',
        detail: `Application release ${targetRelease} is compatible.`,
      })
    }

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
    if (manifest.source.namespace === logged.identity.namespace) {
      checks.push({
        id: 'bundle-distinct-instance',
        status: 'fail',
        detail: 'Bundle source namespace matches the target database instance; refusing a self-import.',
      })
    } else {
      checks.push({
        id: 'bundle-distinct-instance',
        status: 'pass',
        detail: 'Bundle source namespace is distinct from the target database instance.',
      })
    }

    const schemaIssues = checkEntitySchemaCompatibility(
      logged.inspection.catalog,
      manifest.transformations,
      { sourceProvider: manifest.source.provider, targetProvider: target.provider }
    )
    const targetFingerprint = computeSchemaFingerprint(logged.inspection.catalog, target.provider)
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
        detail: schemaIssues.map((issue) => `${issue.code}: ${issue.message}`).join(' | '),
      })
    } else if (!isSupportedSchemaFingerprint(targetFingerprint, target.provider)) {
      checks.push({
        id: 'target-schema',
        status: 'fail',
        detail: `Target schema fingerprint ${targetFingerprint.slice(0, 16)} is not supported for release ${targetRelease}.`,
      })
    } else if (!isSupportedSchemaFingerprint(manifest.source.schemaFingerprint, manifest.source.provider, 'source')) {
      checks.push({
        id: 'target-schema',
        status: 'fail',
        detail: `Bundle source schema fingerprint ${manifest.source.schemaFingerprint.slice(0, 16)} is not supported for release ${targetRelease}.`,
      })
    } else {
      checks.push({
        id: 'target-schema',
        status: 'pass',
        detail: `Target schema fingerprint ${targetFingerprint.slice(0, 16)} is compatible.`,
      })
    }

    const ledgerResult = checkMigrationLedger(target.provider, logged.inspection.appliedMigrations)
    if (!ledgerResult.ok) {
      checks.push({
        id: 'target-migrations',
        status: 'fail',
        detail: `Target migration ledger is incomplete; missing: ${ledgerResult.missing.join(', ')}.`,
      })
    } else {
      checks.push({
        id: 'target-migrations',
        status: 'pass',
        detail: `${logged.inspection.appliedMigrations.length} applied migrations recorded.`,
      })
      try {
        await readDestinationProvenanceReceipts(session, logged.identity.namespace, manifest.source.namespace)
        checks.push({
          id: 'migration-receipts',
          status: 'pass',
          detail: 'Destination migration receipt tables are readable.',
        })
      } catch (error) {
        if (!isMissingReceiptRelation(error)) throw error
        checks.push({
          id: 'migration-receipts',
          status: 'fail',
          detail: 'Destination migration receipt tables are missing; the supported receipt migration is not installed.',
        })
      }
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
      const sourceFingerprint = computeSchemaFingerprint(loggedSource.inspection.catalog, source.provider)
      if (!isSupportedSchemaFingerprint(sourceFingerprint, source.provider, 'source')) {
        checks.push({
          id: 'source-schema',
          status: 'fail',
          detail: `Source schema fingerprint ${sourceFingerprint.slice(0, 16)} is not supported for release ${targetRelease}.`,
        })
      } else {
        checks.push({
          id: 'source-schema',
          status: 'pass',
          detail: `Source schema fingerprint ${sourceFingerprint.slice(0, 16)} is compatible.`,
        })
      }
      const sourceLedgerResult = checkMigrationLedger(source.provider, loggedSource.inspection.appliedMigrations)
      if (!sourceLedgerResult.ok) {
        checks.push({
          id: 'source-migrations',
          status: 'fail',
          detail: `Source migration ledger is incomplete; missing: ${sourceLedgerResult.missing.join(', ')}.`,
        })
      } else {
        checks.push({
          id: 'source-migrations',
          status: 'pass',
          detail: `${loggedSource.inspection.appliedMigrations.length} source applied migrations recorded.`,
        })
      }
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
    const blocked = checks.filter((check) => check.status === 'blocked')
    const ok = failures.length === 0 && blocked.length === 0
    const code = !ok ? (failures.length > 0 ? EXIT_CODES.VALIDATION : EXIT_CODES.BLOCKED) : EXIT_CODES.OK

    const result = {
      command: 'preflight',
      ok,
      target: target.displayTarget,
      source: sourcePair ? sourcePair.provider : null,
      checks,
      blockers,
    }
    journal?.append('preflight', 'completed', { ok, failures: failures.length, blocked: blocked.length })
    if (code !== EXIT_CODES.OK) {
      throw new CliFailure(code, 'E_PREFLIGHT_FAILED', 'Preflight checks failed.', result)
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

function pathIsInside(parent: string, child: string): boolean {
  const parentResolved = resolve(parent)
  const childResolved = resolve(child)
  const relativePath = relative(parentResolved, childResolved)
  if (relativePath === '') return true
  const normalized = process.platform === 'win32' ? relativePath.toLowerCase() : relativePath
  return normalized !== '..' && !normalized.startsWith(`..${sep}`) && !isAbsolute(relativePath)
}

function realpathWithMissingTail(path: string): string {
  let cursor = resolve(path)
  const missingTail: string[] = []
  for (;;) {
    try {
      const existing = realpathSync(cursor)
      return missingTail.reduce((current, segment) => join(current, segment), existing)
    } catch {
      const parent = dirname(cursor)
      if (parent === cursor) return resolve(path)
      missingTail.unshift(basename(cursor))
      cursor = parent
    }
  }
}

/**
 * Compare resolved paths and the real output ancestor so `..` segments and
 * symlinked ancestors cannot bypass the source-bundle artifact boundary. The
 * output itself is intentionally absent when this check runs because the
 * writer creates it exclusively later.
 */
function assertArtifactPathOutsideBundle(path: string, bundle: string, flag: string): void {
  // validateBundleDirectory later rejects a symlink bundle root. Resolving its
  // real path here also keeps the guard correct when a caller supplies an
  // alias. The nearest existing output ancestor is resolved so a missing
  // child cannot hide an earlier symlink component.
  const realBundle = realpathWithMissingTail(bundle)
  const candidate = realpathWithMissingTail(path)
  if (pathIsInside(realBundle, candidate)) {
    throw new CliUsageError(`${flag} must not point inside the source bundle directory.`)
  }
}

function assertWritableArtifactPath(path: string, bundle: string | null): void {
  if (bundle) assertArtifactPathOutsideBundle(path, bundle, '--out')
}

function isMissingReceiptRelation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const candidate = error as { code?: unknown; message?: unknown }
  const code = typeof candidate.code === 'string' ? candidate.code : ''
  const message = typeof candidate.message === 'string' ? candidate.message : ''
  return code === '42P01' && /\b(?:migration_runs|migration_record_map)\b/i.test(message)
}

async function runPlan(parsed: ParsedCli, deps: CliDependencies): Promise<Record<string, unknown>> {
  const bundle = requireFlag(parsed, 'bundle')
  const out = requireFlag(parsed, 'out')
  assertWritableArtifactPath(out, bundle)
  const targetPair = connectionPair(parsed, 'target')
  const auth = authPair(parsed)
  const declaredTargetVersion = parsed.flags.get('target-app-version') ?? CURRENT_APPLICATION_RELEASE
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
  if (
    manifest.tool.applicationVersion !== manifest.source.applicationVersion
  ) {
    throw new CliFailure(
      EXIT_CODES.VALIDATION,
      'E_RELEASE_MISMATCH',
      `Bundle tool application release ${manifest.tool.applicationVersion} does not match its source declaration ${manifest.source.applicationVersion}.`,
      { command: 'plan', ok: false }
    )
  }
  if (!isSupportedApplicationTransition(manifest.source, { provider: targetPair.provider, applicationVersion: declaredTargetVersion })) {
    throw new CliFailure(
      EXIT_CODES.VALIDATION,
      'E_RELEASE_UNSUPPORTED',
      `Unsupported application transition ${manifest.source.provider} ${manifest.source.applicationVersion} to ${targetPair.provider} ${declaredTargetVersion}.`,
      { command: 'plan', ok: false }
    )
  }
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

    // The runtime fingerprint is built from server facts, so it catches a
    // same-instance source/target even when one connection could read the
    // privileged system identifier and the other (namespace) could not.
    const sameInstance =
      manifest.source.namespace === logged.identity.namespace ||
      (manifest.source.runtimeFingerprint !== undefined &&
        manifest.source.runtimeFingerprint === logged.identity.runtimeFingerprint)
    if (sameInstance) {
      throw new CliFailure(
        EXIT_CODES.VALIDATION,
        'E_SOURCE_TARGET_SAME_INSTANCE',
        'Bundle source and target resolve to the same database instance; refusing a self-import.',
        { command: 'plan', ok: false }
      )
    }

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

    const schemaIssues = checkEntitySchemaCompatibility(
      logged.inspection.catalog,
      manifest.transformations,
      { sourceProvider: manifest.source.provider, targetProvider: target.provider }
    )
    const targetFingerprint = computeSchemaFingerprint(logged.inspection.catalog, target.provider)
    if (
      logged.inspection.missingTables.length > 0 ||
      schemaIssues.length > 0 ||
      !isSupportedSchemaFingerprint(targetFingerprint, target.provider) ||
      !isSupportedSchemaFingerprint(manifest.source.schemaFingerprint, manifest.source.provider, 'source')
    ) {
      throw new CliFailure(EXIT_CODES.VALIDATION, 'E_TARGET_SCHEMA', 'Target schema is not compatible with this bundle.', {
        command: 'plan',
        ok: false,
        missingTables: logged.inspection.missingTables,
        issues: schemaIssues,
      })
    }

    const ledger = checkMigrationLedger(target.provider, logged.inspection.appliedMigrations)
    if (!ledger.ok) {
      throw new CliFailure(
        EXIT_CODES.VALIDATION,
        'E_MIGRATION_LEDGER',
        `Target migration ledger is missing required migrations: ${ledger.missing.join(', ')}.`,
        { command: 'plan', ok: false }
      )
    }

    const sourceRows = await loadBundleRows(bundle, manifest, { expectedBundleDigest: validation.bundleDigest })
    let snapshot: Awaited<ReturnType<typeof readDeploymentSnapshot>>
    try {
      snapshot = await session.withReadOnlyTransaction(() =>
        readDeploymentSnapshot(session!, manifest.source.namespace)
      )
    } catch (error) {
      if (!isMissingReceiptRelation(error)) throw error
      throw new CliFailure(
        EXIT_CODES.VALIDATION,
        'E_MIGRATION_RECEIPTS',
        'Destination migration receipt tables are missing; install the supported receipt migration before planning.',
        { command: 'plan', ok: false }
      )
    }
    const context: PlanningContext = {
      manifest,
      provenance: validation.aliases,
      sourceRows,
      sourceIdentities: validation.sourceIdentities,
      sourceRetryHistory: validation.sourceRetryHistory,
      retryHistoryCaptured: validation.retryHistoryCaptured,
      target: snapshot,
      trustedReceipts: snapshot.receipts ?? [],
      targetApplicationVersion: declaredTargetVersion,
      targetSchemaFingerprint: computeSchemaFingerprint(logged.inspection.catalog, target.provider),
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

function readJsonArtifact(path: string, label: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown
  } catch (error) {
    throw new CliFailure(EXIT_CODES.VALIDATION, 'E_ARTIFACT_UNREADABLE', `${label} could not be read: ${path}`, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

function loadResolvedPlan(path: string): ResolvedPlan {
  const parsed = resolvedPlanSchema.safeParse(readJsonArtifact(path, 'Resolved plan'))
  if (!parsed.success) {
    throw new CliFailure(EXIT_CODES.VALIDATION, 'E_RESOLVED_PLAN_SCHEMA', 'Resolved plan does not match the reviewed format.', {
      ok: false,
      issues: parsed.error.issues.slice(0, 20).map((issue) => issue.message),
    })
  }
  const resolved = parsed.data as unknown as ResolvedPlan
  const verification = verifyResolvedPlan(resolved)
  if (verification.length > 0) {
    throw new CliFailure(EXIT_CODES.VALIDATION, 'E_RESOLVED_PLAN_INVALID', 'Resolved plan failed its digest checks.', {
      ok: false,
      issues: verification,
    })
  }
  return resolved
}

async function runExport(parsed: ParsedCli, deps: CliDependencies): Promise<Record<string, unknown>> {
  const pair = connectionPair(parsed, 'source')
  const out = requireFlag(parsed, 'out')
  const env = deps.env ?? process.env
  const applicationVersion = parsed.flags.get('app-version') ?? CURRENT_APPLICATION_RELEASE
  if (!isSupportedApplicationRelease(applicationVersion)) {
    throw new CliFailure(
      EXIT_CODES.VALIDATION,
      'E_RELEASE_UNSUPPORTED',
      `Application release ${applicationVersion} is not supported. Supported releases: ${SUPPORTED_APPLICATION_RELEASES.join(', ')}.`,
      { ok: false }
    )
  }
  const source = resolveDatabaseTarget({
    provider: pair.provider,
    role: 'source',
    envName: pair.envName,
    env,
  })
  assertWritableArtifactPath(out, null)
  const runId = parsed.flags.get('run-id') ?? randomRunId()
  const journal = openJournal(deps, parsed, 'export', { provider: source.provider, role: 'source' })
  let session: DatabaseSession | null = null
  try {
    session = (deps.openSession ?? openReadOnlySession)(source)
    await session.assertReadOnly()
    const identity = await session.identity()
    const catalog = await session.inspectCatalog()
    const ledger = checkMigrationLedger(source.provider, await session.migrationLedger())
    if (!ledger.ok) {
      throw new CliFailure(
        EXIT_CODES.VALIDATION,
        'E_MIGRATION_LEDGER',
        `Source migration ledger is missing required migrations: ${ledger.missing.join(', ')}.`,
        { ok: false }
      )
    }
    const fingerprint = computeSchemaFingerprint(catalog, source.provider)
    if (!isSupportedSchemaFingerprint(fingerprint, source.provider, 'source')) {
      throw new CliFailure(
        EXIT_CODES.VALIDATION,
        'E_SOURCE_SCHEMA',
        `Source schema fingerprint ${fingerprint.slice(0, 16)} is not supported.`,
        { ok: false }
      )
    }

    const exported = await exportBundle(session, {
      directory: out,
      runId,
      bundleId: runId,
      applicationVersion,
      now: deps.now,
    })
    const result: Record<string, unknown> = {
      command: 'export',
      ok: true,
      out,
      runId,
      sourceNamespace: identity.namespace,
      bundleDigest: bundleDigestOf(exported.manifest),
      counts: exported.counts,
      aliases: exported.aliasCount,
      provenanceTableMissing: exported.provenanceTableMissing,
      batches: exported.entities.map((stats) => ({ entity: stats.entity, rows: stats.rowCount, batches: stats.batches })),
      diagnostics: exported.diagnostics,
      statementLimits: exported.statementLimits,
      journal: journal ? journal.directory : null,
    }
    journal?.append('export', 'bundle-written', {
      bundleDigest: result.bundleDigest,
      counts: exported.counts,
      diagnostics: exported.diagnostics,
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

async function runApply(parsed: ParsedCli, deps: CliDependencies): Promise<Record<string, unknown>> {
  const planPath = requireFlag(parsed, 'plan')
  const targetPair = connectionPair(parsed, 'target')
  const expectDigest = requireFlag(parsed, 'expect-plan-digest')
  const runId = requireFlag(parsed, 'run-id')
  const auth = authPair(parsed)
  const env = deps.env ?? process.env

  const resolved = loadResolvedPlan(planPath)
  const journal = openJournal(deps, parsed, 'apply', {
    provider: targetPair.provider,
    role: 'destination',
    bundleDigest: resolved.plan.bundleDigest,
  })
  let session: WriteSession | null = null
  try {
    const target = resolveDatabaseTarget({
      provider: targetPair.provider,
      role: 'destination',
      envName: targetPair.envName,
      env,
    })
    let authAdmin: AuthAdminPort | null = null
    if (target.provider === 'supabase') {
      if (!auth) {
        throw new CliFailure(
          EXIT_CODES.BLOCKED,
          'E_AUTH_REQUIRED',
          'A supabase destination requires --auth-url-env and --auth-service-key-env to provision new accounts.',
          { ok: false }
        )
      }
      const authTarget = resolveAuthTarget({ role: 'destination', ...auth, env })
      assertAuthDatabaseBinding(target, authTarget)
      authAdmin = (deps.openAuthAdmin ?? createSupabaseAuthAdmin)(authTarget)
    }

    session = (deps.openWrite ?? openWriteSession)(target)
    const outcome = await applyResolvedPlan({
      runId,
      resolvedPlan: resolved,
      session,
      auth: authAdmin,
      expectPlanDigest: expectDigest,
      expectedApplicationVersion: parsed.flags.get('target-app-version'),
      now: deps.now,
    })

    const result: Record<string, unknown> = {
      command: 'apply',
      ok: outcome.status !== 'failed',
      status: outcome.status,
      runId,
      counts: outcome.counts,
      identityProvisions: outcome.identityProvisions,
      identityDispositions: outcome.identityDispositions,
      receipt: outcome.receipt,
      issues: outcome.issues,
      // Reported, never overwritten: a completed run replayed after legitimate
      // later edits stays a no-op, and `migration verify` is the current-state
      // oracle the operator runs next.
      rowDriftIssues: outcome.rowDriftIssues ?? [],
      journal: journal ? journal.directory : null,
    }
    journal?.append('apply', outcome.status, { runId, counts: outcome.counts })

    if (outcome.status === 'failed') {
      finishJournal(journal, result)
      // Operator-actionable refusals (unfenced/gate-less/unledgered target)
      // exit BLOCKED so a scripted run can tell "fix the environment" from a
      // merge failure; everything else stays a validation failure.
      const refusalCode = outcome.issues.find((item) => BLOCKED_RUN_CODES.has(item.code))?.code
      if (refusalCode) {
        throw new CliFailure(
          EXIT_CODES.BLOCKED,
          refusalCode,
          'The apply was refused before any destination mutation.',
          result
        )
      }
      throw new CliFailure(EXIT_CODES.VALIDATION, 'E_APPLY_FAILED', 'The merge was not applied.', result)
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

async function runGate(parsed: ParsedCli, deps: CliDependencies): Promise<Record<string, unknown>> {
  const targetPair = connectionPair(parsed, 'target')
  const env = deps.env ?? process.env
  const target = resolveDatabaseTarget({
    provider: targetPair.provider,
    role: 'destination',
    envName: targetPair.envName,
    env,
  })
  const requested = parsed.flags.get('state') ?? null
  if (requested !== null && requested !== 'open' && requested !== 'fenced') {
    throw new CliFailure(EXIT_CODES.USAGE, 'E_GATE_STATE', '--state must be "open" or "fenced".')
  }
  const session = (deps.openWrite ?? openWriteSession)(target)
  try {
    const identity = await session.identity()
    if (requested === null) {
      const current = await readWriteGate(session)
      return {
        command: 'gate',
        ok: current !== null,
        target: identity.namespace,
        state: current?.state ?? null,
        runId: current?.runId ?? null,
        fenceGeneration: current?.fenceGeneration ?? null,
        reason: current?.reason ?? null,
        updatedAt: current?.updatedAt ?? null,
        updatedBy: current?.updatedBy ?? null,
        note: current === null ? 'This deployment has no write gate yet; writers are admitted.' : null,
      }
    }
    const reason = parsed.flags.get('reason') ?? null
    if (!reason) {
      throw new CliFailure(
        EXIT_CODES.USAGE,
        'E_GATE_REASON',
        'A write-gate transition requires --reason so the operator record explains it.'
      )
    }
    const recovery = parsed.booleans.has('recovery')
    if (requested === 'open' && !recovery) {
      return {
        command: 'gate', ok: false, target: identity.namespace, state: (await readWriteGate(session))?.state ?? null,
        issues: [{ code: 'E_PUBLICATION_REQUIRED', message: 'Normal writer admission must use `migration publish --phase admit --run-id …`; it atomically records the writable receipt and opens the current fenced gate. Use --recovery only after restoring the pre-publication baseline.' }],
      }
    }
    if (requested === 'open' && !parsed.flags.get('run-id')) {
      throw new CliFailure(EXIT_CODES.USAGE, 'E_RECOVERY_RUN', 'Recovery requires --run-id matching the currently fenced window.')
    }
    const change: WriteGateChange = {
      state: requested,
      reason: requested === 'open' ? `[recovery] ${reason}` : reason,
      actor: parsed.flags.get('actor') ?? deps.env?.MIGRATION_OPERATOR ?? 'unknown-operator',
      runId: parsed.flags.get('run-id') ?? null,
    }
    const gate = requested === 'open'
      ? await recoverWriteGate(session, { ...change, state: 'open', runId: change.runId as string })
      : await setWriteGate(session, change)
    return {
      command: 'gate',
      ok: true,
      target: identity.namespace,
      state: gate.state,
      runId: gate.runId,
      fenceGeneration: gate.fenceGeneration,
      reason: gate.reason,
      updatedAt: gate.updatedAt,
      updatedBy: gate.updatedBy,
      admission: requested === 'fenced' ? 'business writes are refused' : 'business writes are admitted',
    }
  } finally {
    await session.close()
  }
}

async function runFence(parsed: ParsedCli, deps: CliDependencies): Promise<Record<string, unknown>> {
  const targetPair = connectionPair(parsed, 'target')
  const env = deps.env ?? process.env
  const action = parsed.flags.get('action') ?? null
  if (action !== 'inventory' && action !== 'activate' && action !== 'verify' && action !== 'release') {
    throw new CliFailure(
      EXIT_CODES.USAGE,
      'E_FENCE_ACTION',
      '--action must be "inventory", "activate", "verify" or "release".'
    )
  }
  const target = resolveDatabaseTarget({
    provider: targetPair.provider,
    role: 'destination',
    envName: targetPair.envName,
    env,
  })
  const session = (deps.openWrite ?? openWriteSession)(target)
  try {
    const identity = await session.identity()
    const roles = parseFenceRoles(parsed.flags.get('role'), target.provider)

    if (action === 'inventory') {
      const inventory = await inventoryFence(session, target.provider, roles)
      return {
        command: 'fence',
        ok: true,
        action,
        target: identity.namespace,
        roles,
        grants: inventory.grants,
        note: 'Record this inventory; release restores the supported direct table-level grants in the activation artifact exactly.',
      }
    }

    if (action === 'activate') {
      // The inventory must be captured before the revocation and persisted to
      // an exclusive artifact: without it, release cannot restore the exact
      // supported direct table-level grant state.
      const outPath = requireFlag(parsed, 'out')
      const runId = requireFlag(parsed, 'run-id')
      const reason = requireFlag(parsed, 'reason')
      const actor = requireFlag(parsed, 'actor')
      // The gate binding, grant inventory, artifact and revocation are one
      // critical section. A concurrent gate transition cannot assign this
      // inventory to a different fenced generation before grants are revoked.
      const result = await session.transaction(async (tx) => {
        let gates: Array<{ state: string; run_id: string | null; fence_generation: string; updated_at: string }>
        try {
          gates = await tx.query<{ state: string; run_id: string | null; fence_generation: string; updated_at: string }>(
            `select state, run_id, fence_generation,
                    to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as updated_at
               from public.migration_write_gate where id for update`
          )
        } catch (error) {
          if ((error as { code?: string }).code !== '42P01') throw error
          throw new CliFailure(EXIT_CODES.VALIDATION, 'E_FENCE_GATE_BINDING', 'The durable migration write gate is missing; no grants were revoked.')
        }
        const gate = gates[0]
        if (gate?.state !== 'fenced' || gate.run_id !== runId || !gate.fence_generation) {
          throw new CliFailure(EXIT_CODES.VALIDATION, 'E_FENCE_GATE_BINDING', `The current fenced gate does not belong to run ${runId}; no grants were revoked.`)
        }
        const inventory = await inventoryFence(tx, target.provider, roles)
        const artifactRecord = parseFenceArtifact(createFenceArtifact(inventory, {
          capturedFor: identity.namespace,
          runId,
          gateUpdatedAt: gate.updated_at,
          gateGeneration: gate.fence_generation,
          reason,
          actor,
          capturedAt: new Date().toISOString(),
        }))
        let artifact: number
        try {
          artifact = openSync(outPath, 'wx')
        } catch {
          throw new CliFailure(
            EXIT_CODES.USAGE,
            'E_FENCE_ARTIFACT_EXISTS',
            `The inventory artifact ${outPath} already exists; choose an unused path so a previous fence is never overwritten.`
          )
        }
        try {
          writeSync(artifact, JSON.stringify(artifactRecord, null, 2))
        } finally {
          closeSync(artifact)
        }
        return activateFenceInTransaction(tx, roles)
      })
      return {
        command: 'fence',
        ok: true,
        action,
        target: identity.namespace,
        roles,
        revokedStatements: result.revokedStatements,
        inventoryArtifact: outPath,
        note: 'DML revoked from the writer roles. Verify with --action verify while the API is still running, then apply the ingress shutdown per the C08 runbook. Release needs this inventory artifact.',
      }
    }

    if (action === 'verify') {
      const { ok, checks } = await verifyFence(session, roles)
      return { command: 'fence', ok, action, target: identity.namespace, roles, checks }
    }

    const inventoryPath = requireFlag(parsed, 'inventory')
    let recorded
    try {
      recorded = parseFenceArtifact(JSON.parse(readFileSync(inventoryPath, 'utf8')))
    } catch (error) {
      if (error instanceof MigrationRunError) throw error
      throw new CliFailure(
        EXIT_CODES.USAGE,
        'E_FENCE_INVENTORY_READ',
        `The inventory artifact ${inventoryPath} could not be read: ${error instanceof Error ? error.message : String(error)}`
      )
    }
    if (recorded.provider !== target.provider || recorded.capturedFor !== identity.namespace || recorded.roles.join(',') !== roles.join(',')) {
      return {
        command: 'fence', ok: false, action, target: identity.namespace,
        issues: [{ code: 'E_FENCE_INVENTORY_MISMATCH', message: 'The inventory artifact provider, destination, or role set does not match this release.' }],
      }
    }

    // Normal release follows the publication successor (receipt writable and
    // gate open for this run). Recovery instead requires the exact original
    // fenced generation. Both authorization paths lock the gate and receipt
    // alongside the grant restoration below.
    const recovery = parsed.booleans.has('recovery')
    const reason = parsed.flags.get('reason') ?? null
    if (!reason) {
      throw new CliFailure(EXIT_CODES.USAGE, 'E_FENCE_REASON', 'A fence release requires --reason so the operator record explains it.')
    }
    const result = await releaseFenceWithAuthorization(session, recorded, identity.namespace, recovery)
    if (!result.ok) {
      return {
        command: 'fence',
        ok: false,
        action,
        target: identity.namespace,
        issues: [result.issue],
      }
    }
    // Prove the restoration: the live grant state must equal the recorded one.
    const restored = await inventoryFence(session, target.provider, recorded.roles)
    const matches =
      JSON.stringify(restored.grants) === JSON.stringify(recorded.grants) &&
      restored.roles.join(',') === recorded.roles.join(',')
    return {
      command: 'fence',
      ok: matches,
      action,
      target: identity.namespace,
      roles: recorded.roles,
      restoredStatements: result.restoredStatements,
      recovery,
      grantsRestoredExactly: matches,
      note: recovery
        ? `[recovery] Fence released without a published receipt; the recorded reason is: ${reason}`
        : 'Fence released after durable publication; the recorded reason is: ' + reason,
    }
  } finally {
    await session.close()
  }
}

async function runPublish(parsed: ParsedCli, deps: CliDependencies): Promise<Record<string, unknown>> {
  const targetPair = connectionPair(parsed, 'target')
  const env = deps.env ?? process.env
  const runId = requireFlag(parsed, 'run-id')
  const phase = parsed.flags.get('phase') ?? null
  if (phase !== 'intent' && phase !== 'admit') {
    throw new CliFailure(EXIT_CODES.USAGE, 'E_PUBLISH_PHASE', '--phase must be "intent" or "admit".')
  }
  const reason = parsed.flags.get('reason') ?? null
  if (!reason) {
    throw new CliFailure(
      EXIT_CODES.USAGE,
      'E_PUBLISH_REASON',
      'A publication transition requires --reason so the operator record explains it.'
    )
  }
  const actor = parsed.flags.get('actor') ?? env.MIGRATION_OPERATOR ?? 'unknown-operator'
  const target = resolveDatabaseTarget({
    provider: targetPair.provider,
    role: 'destination',
    envName: targetPair.envName,
    env,
  })
  const session = (deps.openWrite ?? openWriteSession)(target)
  try {
    const identity = await session.identity()
    const transition = { runId, actor, reason }
    const result =
      phase === 'intent'
        ? await recordPublicationIntent(session, transition)
        : await admitWriters(session, transition)
    if (result.targetNamespace !== identity.namespace) {
      return {
        command: 'publish',
        ok: false,
        phase,
        runId,
        issues: [
          {
            code: 'E_TARGET_MISMATCH',
            message: `Run ${runId} belongs to ${result.targetNamespace}, not to this connection.`,
          },
        ],
      }
    }
    return {
      command: 'publish',
      ok: true,
      phase,
      runId,
      state: result.state,
      target: identity.namespace,
      updatedBy: actor,
      reason,
      admission:
        phase === 'admit' ? 'business writes are admitted' : 'publication intent recorded; writers stay fenced',
    }
  } finally {
    await session.close()
  }
}

async function runVerify(parsed: ParsedCli, deps: CliDependencies): Promise<Record<string, unknown>> {
  const planPath = requireFlag(parsed, 'plan')
  const targetPair = connectionPair(parsed, 'target')
  const runId = requireFlag(parsed, 'run-id')
  const env = deps.env ?? process.env
  const resolved = loadResolvedPlan(planPath)
  const target = resolveDatabaseTarget({
    provider: targetPair.provider,
    role: 'destination',
    envName: targetPair.envName,
    env,
  })
  const session = (deps.openSession ?? openReadOnlySession)(target)
  try {
    const identity = await session.identity()
    if (identity.namespace !== resolved.plan.target.namespace) {
      return {
        command: 'verify',
        ok: false,
        runId,
        issues: [{ code: 'E_TARGET_MISMATCH', message: 'Connection does not resolve to the plan destination.' }],
      }
    }
    const receipts = await readDestinationProvenanceReceipts(session, identity.namespace)
    const receipt = receipts.find((entry) => entry.runId === runId) ?? null
    const issues = await reconcile(session as unknown as WriteSession, resolved)
    const result: Record<string, unknown> = {
      command: 'verify',
      ok: issues.length === 0 && receipt !== null,
      runId,
      receiptPresent: receipt !== null,
      issues,
    }
    // `--record` persists the verified state, so completion is durable rather
    // than a terminal line and publication intent has something to require. It
    // needs a write connection, so it is opt-in: verification stays read-only
    // unless the operator asks for the state to be recorded.
    if (parsed.booleans.has('record')) {
      if (!result.ok) {
        result.recorded = false
        result.recordNote = 'Verification did not pass; nothing was recorded.'
        return result
      }
      const record = (deps.openWrite ?? openWriteSession)(target)
      try {
        const reason = parsed.flags.get('reason') ?? 'verified by `migration verify --record`'
        const verified = await recordVerifiedState(record, {
          runId,
          actor: parsed.flags.get('actor') ?? env.MIGRATION_OPERATOR ?? 'unknown-operator',
          reason,
        })
        result.recorded = true
        result.state = verified.state
      } finally {
        await record.close()
      }
    }
    return result
  } finally {
    await session.close()
  }
}

async function runRetirementInventory(
  parsed: ParsedCli,
  deps: CliDependencies
): Promise<{ result: Record<string, unknown>; blocked: boolean }> {
  const allowedFlags = new Set(['target', 'target-env', 'manifest', 'out'])
  for (const flag of parsed.flags.keys()) {
    if (!allowedFlags.has(flag)) {
      throw new CliUsageError(`Flag --${flag} is not valid for retirement-inventory.`)
    }
  }
  for (const flag of parsed.booleans) {
    if (flag !== 'json') {
      throw new CliUsageError(`Flag --${flag} is not valid for retirement-inventory.`)
    }
  }

  const pair = connectionPair(parsed, 'target')
  const env = deps.env ?? process.env
  const target = resolveDatabaseTarget({
    provider: pair.provider,
    role: 'destination',
    envName: pair.envName,
    env,
  })
  const cwd = deps.cwd ?? process.cwd()
  const declarationPath = resolve(cwd, requireFlag(parsed, 'manifest'))
  const outPath = resolve(cwd, requireFlag(parsed, 'out'))
  if (declarationPath === outPath) {
    throw new CliUsageError('--manifest and --out must refer to different files.')
  }
  const declaration = parseRetirementDeclaration(
    readJsonArtifact(declarationPath, 'Retirement inventory declaration')
  )

  const session = (deps.openSession ?? openReadOnlySession)(target)
  const now = deps.now ?? (() => new Date())
  try {
    const captured = await captureRetirementEvidence(
      session,
      target.provider,
      declaration,
      now(),
      now
    )
    writeExclusiveFile(outPath, `${canonicalStringify(captured.artifact)}\n`)
    const artifact = captured.artifact as {
      artifactDigest: string
      unresolved: string[]
      capture: { snapshotAt: string }
    }
    return {
      blocked: captured.blocked,
      result: {
        command: 'retirement-inventory',
        ok: !captured.blocked,
        purpose: 'evidence-only',
        gateAssessment: 'not-performed',
        provider: target.provider,
        artifact: outPath,
        artifactDigest: artifact.artifactDigest,
        snapshotAt: artifact.capture.snapshotAt,
        unresolved: artifact.unresolved,
      },
    }
  } finally {
    await session.close()
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
    // Operational preconditions and security refusals are BLOCKED (5), not an
    // environment failure: a scripted operator must be able to tell "fix the
    // environment" from "this is refused until you act".
    return {
      exitCode: BLOCKED_RUN_CODES.has(error.code) ? EXIT_CODES.BLOCKED : EXIT_CODES.ENVIRONMENT,
      code: error.code,
      message: error.message,
    }
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
      case 'export': {
        emit(await runExport(parsed, deps))
        return EXIT_CODES.OK
      }
      case 'apply': {
        emit(await runApply(parsed, deps))
        return EXIT_CODES.OK
      }
      case 'verify': {
        const result = await runVerify(parsed, deps)
        emit(result)
        return result.ok === true ? EXIT_CODES.OK : EXIT_CODES.VALIDATION
      }
      case 'publish': {
        const result = await runPublish(parsed, deps)
        emit(result)
        return result.ok === true ? EXIT_CODES.OK : EXIT_CODES.VALIDATION
      }
      case 'gate': {
        const result = await runGate(parsed, deps)
        emit(result)
        return result.ok === true ? EXIT_CODES.OK : EXIT_CODES.VALIDATION
      }
      case 'fence': {
        const result = await runFence(parsed, deps)
        emit(result)
        return result.ok === true ? EXIT_CODES.OK : EXIT_CODES.VALIDATION
      }
      case 'retirement-inventory': {
        const captured = await runRetirementInventory(parsed, deps)
        emit(captured.result)
        return captured.blocked ? EXIT_CODES.BLOCKED : EXIT_CODES.OK
      }
      default: {
        err(`Unknown command "${parsed.command}".`)
        err(helpText())
        return EXIT_CODES.USAGE
      }
    }
  } catch (error) {
    if (error instanceof CliFailure) {
      emit(error.result ?? { ok: false, error: redactString(error.message) })
      err(`${error.code}: ${redactString(error.message)}`)
      return error.exitCode
    }
    const described = describeError(error)
    // Driver/library errors can embed a connection string or credential; the
    // catch-all must redact them like every other output path.
    const message = redactString(described.message)
    if (json) {
      out(JSON.stringify({ ok: false, code: described.code, error: message }, null, 2))
    } else {
      err(`${described.code}: ${message}`)
    }
    return described.exitCode
  }
}
