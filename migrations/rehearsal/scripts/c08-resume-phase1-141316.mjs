// Disposable C08 preparation and read-only export. Intentionally stops at preview.
import NextEnv from '@next/env'
import pg from 'pg'
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { runCli } from '../../tool/src/cli.ts'
import { canonicalStringify, sha256Hex, ENTITY_ORDER } from '../../tool/src/format.ts'
import { validateBundleDirectory } from '../../tool/src/validation.ts'
import { runMigrations } from './db/migrate-runner.mjs'

const root = process.cwd()
const artifacts = process.argv[2]
const oldArtifacts = 'C:\\Users\\kasku\\AppData\\Local\\Temp\\vsis-migration-dryrun-20261004-105004'
const stamp = '20261004_141316'
const database = `vsis_c08_resume_${stamp}`
const originalDatabase = 'vsis_migration_destination_20261003'
const runId = `resume-${stamp.replace('_', '-')}`
const docker = 'C:\\Users\\kasku\\AppData\\Local\\Programs\\DockerDesktop\\resources\\bin\\docker.exe'
const container = 'vsis-migration-native'
const bundle = join(artifacts, 'source-bundle')
const previewPath = join(artifacts, 'rehearsal-preview.json')
const report = { runId, status: 'preparing', sourceWrites: false, oldArtifactsModified: false,
  sourceRelease: '1.0.3', targetRelease: '1.1.6', artifacts, database,
  originalDatabase, preparationStartedAt: new Date().toISOString(), stages: [],
  protectedDirectoryCreatedAt: '2026-10-04T14:13:16Z',
  timingBudget: { normalMinutes: 45, abortRecoveryMinutes: 15, productionFreezeProven: false } }
let admin
let original
let target
let nativeEnv

function assert(ok, code) { if (!ok) throw Object.assign(new Error(code), { code }) }
function json(path) { return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, '')) }
function privateWrite(name, value) {
  writeFileSync(join(artifacts, name), `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' })
}
function save() {
  if (report.normalSequenceStartedAt) report.normalElapsedSeconds = (Date.now() - Date.parse(report.normalSequenceStartedAt)) / 1000
  writeFileSync(join(artifacts, 'phase1-safe-summary.json'), `${JSON.stringify(report, null, 2)}\n`)
  writeFileSync(join(root, 'migrations/rehearsal/local/c08-resume-progress.json'), `${JSON.stringify(report, null, 2)}\n`)
}
function powershell(script) {
  const result = spawnSync('C:\\Users\\kasku\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\native\\powershell\\pwsh.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { encoding: 'utf8', windowsHide: true })
  if (result.status !== 0) {
    appendFileSync(join(artifacts, 'private-errors.log'), `${result.stdout}\n${result.stderr}\n`)
    throw Object.assign(new Error('E_ACL_VERIFY'), { code: 'E_ACL_VERIFY' })
  }
  return JSON.parse(result.stdout.trim())
}
function verifyAcl() {
  const quoted = artifacts.replaceAll("'", "''")
  return powershell(`$ErrorActionPreference='Stop'; $taskRoot='${quoted}'; $taskSid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; $taskAllowed=@($taskSid,'S-1-5-18','S-1-5-32-544'); $taskRootAcl=Get-Acl -LiteralPath $taskRoot; if(-not $taskRootAcl.AreAccessRulesProtected){throw 'Root inheritance enabled'}; $taskItems=@(Get-Item -LiteralPath $taskRoot)+@(Get-ChildItem -LiteralPath $taskRoot -Recurse -Force); foreach($taskItem in $taskItems){if($taskItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint){throw 'Reparse point refused'}; $taskRules=(Get-Acl -LiteralPath $taskItem.FullName).GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier]); foreach($taskRule in $taskRules){if($taskRule.AccessControlType -eq 'Allow' -and $taskRule.IdentityReference.Value -notin $taskAllowed){throw 'Unexpected ACL principal'}}; if(@($taskRules | Where-Object {$_.AccessControlType -eq 'Allow'}).Count -ne 3){throw 'Expected three allowed principals'}}; @{rootInheritanceDisabled=$true;allowedPrincipals='current operator, SYSTEM, Administrators';filesChecked=@($taskItems | Where-Object {-not $_.PSIsContainer}).Count;directoriesChecked=@($taskItems | Where-Object {$_.PSIsContainer}).Count}|ConvertTo-Json -Compress`)
}
async function stage(name, category, fn) {
  const entry = { name, category, startedAt: new Date().toISOString() }
  report.stages.push(entry); save()
  try {
    const value = await fn()
    entry.status = 'passed'; return value
  } catch (error) {
    entry.status = 'failed'; entry.errorCode = String(error.code ?? 'E_STAGE_FAILURE')
    throw error
  } finally {
    entry.endedAt = new Date().toISOString()
    entry.seconds = (Date.parse(entry.endedAt) - Date.parse(entry.startedAt)) / 1000
    save()
    console.log(JSON.stringify({ stage: name, status: entry.status, seconds: entry.seconds }))
  }
}
function dockerRun(args, input) {
  const result = spawnSync(docker, args, { input, maxBuffer: 64 * 1024 * 1024, windowsHide: true })
  if (result.status !== 0) {
    appendFileSync(join(artifacts, 'private-errors.log'), result.stderr ?? '')
    throw Object.assign(new Error('E_DOCKER_COMMAND'), { code: 'E_DOCKER_COMMAND' })
  }
  return result.stdout
}
async function cli(name, args) {
  const output = []; const errors = []
  const code = await runCli([...args, '--json'], {
    cwd: join(root, 'migrations/tool'), runRoot: join(artifacts, 'journals'), env: nativeEnv,
    out: line => output.push(line), err: line => errors.push(line),
  })
  privateWrite(`${name}-private-cli.json`, { code, output, errors })
  report.acl = verifyAcl()
  assert(code === 0, `E_CLI_${name.toUpperCase()}_${code}`)
  const result = output.find(line => line.trim().startsWith('{'))
  return JSON.parse(result)
}
const equal = (a, b) => canonicalStringify(a) === canonicalStringify(b)
async function publicDigests(client) {
  await client.query('begin isolation level repeatable read read only')
  try {
    await client.query("set local timezone='UTC'")
    const tables = (await client.query("select tablename from pg_tables where schemaname='public' order by tablename")).rows
    const result = {}
    for (const { tablename } of tables) {
      assert(/^[a-z_][a-z0-9_]*$/.test(tablename), 'E_TABLE_IDENTIFIER')
      const rows = (await client.query(`select to_jsonb(t)::text as payload from public."${tablename}" t`)).rows.map(row => row.payload).sort()
      result[tablename] = { count: rows.length, digest: sha256Hex(canonicalStringify(rows)) }
    }
    await client.query('commit')
    return result
  } catch (error) { await client.query('rollback'); throw error }
}
function rowsDigest(rows) { return sha256Hex(canonicalStringify(rows.map(row => canonicalStringify(row)).sort())) }
function sourceSummary(inspected) {
  return { provider: inspected.provider, namespace: inspected.namespace, runtimeFingerprint: inspected.runtimeFingerprint,
    schemaFingerprint: inspected.schemaFingerprint, appliedMigrations: inspected.appliedMigrations,
    counts: inspected.counts, missingTables: inspected.missingTables }
}

try {
  assert(artifacts && resolve(artifacts).startsWith('C:\\Users\\kasku\\AppData\\Local\\Temp\\vsis-migration-resume-'), 'E_ARTIFACT_SCOPE')
  report.acl = verifyAcl(); save()
  await stage('protected-local-binding', 'preparation', async () => {
    NextEnv.loadEnvConfig(root)
    const source = new URL(process.env.MIGRATION_SOURCE_DB)
    assert(`${source.hostname} ${source.username}`.includes('bcsdqkjzobllocejfcdz'), 'E_SOURCE_BINDING')
    const metadata = JSON.parse(dockerRun(['inspect', container]).toString('utf8'))[0]
    assert(metadata.Name === `/${container}` && metadata.State.Running, 'E_CONTAINER_BINDING')
    const ports = metadata.NetworkSettings.Ports['5432/tcp']
    assert(ports.length === 1 && ports[0].HostIp === '127.0.0.1' && ports[0].HostPort === '5432', 'E_LOOPBACK_BINDING')
    const vars = Object.fromEntries(metadata.Config.Env.map(entry => { const i = entry.indexOf('='); return [entry.slice(0, i), entry.slice(i + 1)] }))
    const nativeUser = vars.POSTGRES_USER ?? 'postgres'
    assert(vars.POSTGRES_PASSWORD || (metadata.Config.Image === 'postgres:16-alpine' && vars.POSTGRES_HOST_AUTH_METHOD === 'trust' && nativeUser === 'postgres'), 'E_NATIVE_METADATA')
    const url = new URL('postgresql://127.0.0.1:5432/postgres')
    url.username = nativeUser; if (vars.POSTGRES_PASSWORD) url.password = vars.POSTGRES_PASSWORD
    admin = new pg.Client({ connectionString: url.href }); await admin.connect()
    const binding = (await admin.query('select current_database() as db, current_user as actor, inet_server_port() as port')).rows[0]
    assert(binding.port === 5432 && binding.db === 'postgres' && binding.actor === nativeUser, 'E_NATIVE_PORT')
    const baselineUrl = new URL(url); baselineUrl.pathname = `/${originalDatabase}`
    original = new pg.Client({ connectionString: baselineUrl.href, options: '-c default_transaction_read_only=on' }); await original.connect()
    assert((await original.query('select current_database() as db')).rows[0].db === originalDatabase, 'E_BASELINE_BINDING')
    const newUrl = new URL(url); newUrl.pathname = `/${database}`
    nativeEnv = { ...process.env, MIGRATION_NATIVE_DB: newUrl.href }
    delete nativeEnv.MIGRATION_DESTINATION_DB
    delete nativeEnv.DATABASE_URL
    report.nativeBinding = { container, host: '127.0.0.1', port: 5432, database, originalDatabase, newDisposableOnly: true, authentication: vars.POSTGRES_PASSWORD ? 'container-metadata' : 'existing-loopback-trust' }
    report.operatorCodeHead = spawnSync('git', ['-c', 'core.fsmonitor=false', 'rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true }).stdout.trim()
    report.artifactToolVersion = '1.0.0'
    report.cliPackageVersion = json(join(root, 'migrations/tool/package.json')).version
  })
  let baselineBefore
  await stage('fresh-baseline-backup-restore', 'preparation', async () => {
    baselineBefore = await publicDigests(original)
    privateWrite('baseline-before-row-digests.json', baselineBefore)
    assert(Object.keys(baselineBefore).length === 24, 'E_BASELINE_TABLE_COUNT')
    const metadata = JSON.parse(dockerRun(['inspect', container]).toString('utf8'))[0]
    const userSetting = metadata.Config.Env.find(entry => entry.startsWith('POSTGRES_USER='))
    const user = userSetting ? userSetting.slice('POSTGRES_USER='.length) : 'postgres'
    const dump = dockerRun(['exec', container, 'pg_dump', '-U', user, '-d', originalDatabase, '-Fc', '--no-owner', '--no-acl'])
    writeFileSync(join(artifacts, 'native-seeded-baseline.dump'), dump, { flag: 'wx' })
    report.baselineDumpDigest = sha256Hex(dump)
    assert(/^[a-z0-9_]+$/.test(database) && database !== originalDatabase, 'E_CLONE_NAME')
    assert((await admin.query('select 1 from pg_database where datname=$1', [database])).rowCount === 0, 'E_CLONE_EXISTS')
    await admin.query(`create database "${database}" template template0`)
    dockerRun(['exec', '-i', container, 'pg_restore', '-U', user, '-d', database, '--exit-on-error', '--no-owner', '--no-acl'], dump)
    target = new pg.Client({ connectionString: nativeEnv.MIGRATION_NATIVE_DB }); await target.connect()
    assert((await target.query('select current_database() as db')).rows[0].db === database, 'E_CLONE_BINDING')
    const restored = await publicDigests(target)
    privateWrite('clone-restored-row-digests.json', restored)
    assert(equal(baselineBefore, restored), 'E_RESTORE_PARITY')
    report.baselineRestore = { exactMatch: true, publicTables: 24, digestAlgorithm: 'sha256 of canonical sorted PostgreSQL jsonb row texts', aggregateDigest: sha256Hex(canonicalStringify(restored)), counts: Object.fromEntries(Object.entries(restored).map(([table, v]) => [table, v.count])) }
    report.acl = verifyAcl()
  })
  await stage('canonical-clone-migrations', 'preparation', async () => {
    const pool = new pg.Pool({ connectionString: nativeEnv.MIGRATION_NATIVE_DB })
    try { report.cloneMigrationsApplied = await runMigrations(pool, join(root, 'db/migrations')) } finally { await pool.end() }
    const ledger = await target.query('select name from public.schema_migrations order by name')
    assert(ledger.rows.some(row => row.name === '0038_timesheet_list_sort_index.sql'), 'E_0038_LEDGER')
    const index = (await target.query("select indexdef from pg_indexes where schemaname='public' and tablename='timesheets' and indexname='idx_timesheets_logdate_created'")).rows
    assert(index.length === 1 && /log_date DESC, created_at DESC, id DESC/.test(index[0].indexdef), 'E_0038_INDEX')
    const migrated = await publicDigests(target)
    const changed = Object.keys(migrated).filter(table => !equal(migrated[table], baselineBefore[table]))
    assert(equal(changed, ['schema_migrations']), 'E_MIGRATION_ROW_DRIFT')
    privateWrite('clone-migrated-row-digests.json', migrated)
    report.index0038 = { ledgerPresent: true, indexPresent: true, definition: index[0].indexdef, changedPublicTables: changed }
    const inspected = await cli('inspect-native', ['inspect', '--target', 'native', '--target-env', 'MIGRATION_NATIVE_DB'])
    report.targetInspection = sourceSummary(inspected)
    assert(inspected.database === database && inspected.missingTables.length === 0, 'E_NATIVE_INSPECT')
  })
  await stage('source-before-readonly-inspect', 'preparation', async () => {
    const inspected = await cli('inspect-source-before', ['inspect', '--source', 'supabase', '--source-env', 'MIGRATION_SOURCE_DB'])
    report.sourceBefore = sourceSummary(inspected)
    assert(inspected.schemaFingerprint === '486a9ab877a2c48e5de8b15e9f26a981f58ddc188c25b9c129c31f721763e94b', 'E_SOURCE_FINGERPRINT')
    assert(inspected.appliedMigrations.includes('20261006000000'), 'E_SOURCE_LEDGER')
    assert(inspected.counts.profiles === 23 && inspected.counts.timesheets === 854 && inspected.counts.projects === 43, 'E_SOURCE_COUNTS')
  })
  report.preparationEndedAt = new Date().toISOString()
  report.normalSequenceStartedAt = report.preparationEndedAt
  await stage('simulated-isolated-stop-and-drain', 'normal-sequence', async () => {
    await cli('fence-clone', ['gate', '--target', 'native', '--target-env', 'MIGRATION_NATIVE_DB', '--state', 'fenced', '--run-id', runId, '--reason', 'isolated disposable rehearsal stop/drain', '--actor', 'C08-local-operator'])
    const before = await publicDigests(target)
    const observe = async () => ({ timestamp: new Date().toISOString(), activeOtherTransactions: Number((await target.query("select count(*) as count from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid() and xact_start is not null")).rows[0].count) })
    const observations = [await observe()]
    await new Promise(resolveWait => setTimeout(resolveWait, 30000))
    observations.push(await observe())
    assert(observations.every(row => row.activeOtherTransactions === 0), 'E_DRAIN_ACTIVE')
    assert(equal(before, await publicDigests(target)), 'E_DRAIN_ROW_DRIFT')
    report.drain = { observations, observationSeconds: 30, allPublicRowsUnchanged: true, scope: 'isolated new native clone only; production source stop/drain not exercised' }
  })
  const exported = await stage('fresh-final-readonly-source-export', 'normal-sequence', () => cli('export', ['export', '--source', 'supabase', '--source-env', 'MIGRATION_SOURCE_DB', '--app-version', '1.0.3', '--out', bundle, '--run-id', runId]))
  report.bundleDigest = exported.bundleDigest; report.exportCounts = exported.counts
  await stage('bundle-validation-and-canonical-comparison', 'normal-sequence', async () => {
    const validation = await cli('validate', ['validate', '--bundle', bundle])
    report.validation = { ok: validation.ok, bundleDigest: validation.bundleDigest }
    const freshManifest = json(join(bundle, 'manifest.json'))
    const oldManifest = json(join(oldArtifacts, 'source-bundle/manifest.json'))
    assert(freshManifest.source.applicationVersion === '1.0.3' && freshManifest.tool.applicationVersion === '1.0.3', 'E_SOURCE_RELEASE_TRUTH')
    assert(freshManifest.tool.version === oldManifest.tool.version, 'E_TOOL_VERSION_DRIFT')
    const oldValidation = await validateBundleDirectory(join(oldArtifacts, 'source-bundle'))
    assert(oldValidation.ok, 'E_OLD_BUNDLE_INVALID')
    const delta = freshManifest.entities.map(entity => {
      const old = oldManifest.entities.find(row => row.entity === entity.entity)
      return { entity: entity.entity, oldRows: old.rowCount, freshRows: entity.rowCount, rowCountDelta: entity.rowCount - old.rowCount, canonicalDigestUnchanged: old.sha256 === entity.sha256, digest: entity.sha256 }
    })
    report.canonicalComparison = { oldBundleDigest: oldValidation.bundleDigest, changedEntities: delta.filter(row => !row.canonicalDigestUnchanged).map(row => row.entity), entities: delta }
  })
  await stage('native-116-preflight', 'normal-sequence', async () => {
    const result = await cli('preflight', ['preflight', '--bundle', bundle, '--target', 'native', '--target-env', 'MIGRATION_NATIVE_DB', '--target-app-version', '1.1.6'])
    report.preflight = { ok: result.ok, checks: result.checks.map(row => ({ id: row.id, status: row.status })) }
  })
  await stage('fresh-native-116-preview', 'normal-sequence', async () => {
    const result = await cli('preview', ['plan', '--bundle', bundle, '--target', 'native', '--target-env', 'MIGRATION_NATIVE_DB', '--target-app-version', '1.1.6', '--out', previewPath, '--operator', 'C08-local-operator'])
    report.preview = { planDigest: result.planDigest, bundleDigest: result.bundleDigest, targetNamespace: result.targetNamespace, unresolvedCount: result.unresolvedCount, counts: result.counts, path: previewPath }
    report.rootReviewStartedAt = new Date().toISOString()
  })
  await stage('aggregate-prior-decision-parity', 'normal-sequence', async () => {
    const plan = json(previewPath)
    const oldResolved = json(join(oldArtifacts, 'rehearsal-resolved-closure.json'))
    const oldPlan = oldResolved.plan
    const oldDecisions = json(join(oldArtifacts, 'rehearsal-decisions.json'))
    const byKey = records => new Map(records.map(row => [`${row.entity}:${row.sourceId}`, row]))
    const decisions = byKey(oldDecisions.decisions)
    const oldConflicts = byKey(oldPlan.unresolved)
    const conflictCounts = {}; const decisionsByEntity = {}; const fieldsByEntity = {}
    let equivalentConflicts = 0; let priorDecisionCoverage = 0; let priorMappingsMatch = 0
    for (const conflict of plan.unresolved) {
      const key = `${conflict.entity}:${conflict.sourceId}`
      conflictCounts[`${conflict.entity}:${conflict.kind}`] = (conflictCounts[`${conflict.entity}:${conflict.kind}`] ?? 0) + 1
      if (equal(conflict, oldConflicts.get(key) ?? null)) equivalentConflicts++
      const decision = decisions.get(key)
      if (!decision) continue
      priorDecisionCoverage++
      decisionsByEntity[`${decision.entity}:${decision.action}`] = (decisionsByEntity[`${decision.entity}:${decision.action}`] ?? 0) + 1
      for (const [field, side] of Object.entries(decision.fields ?? {})) {
        const label = `${decision.entity}:${field}:${side}`
        fieldsByEntity[label] = (fieldsByEntity[label] ?? 0) + 1
      }
      if (decision.action === 'map' && oldResolved.idMap[decision.entity]?.[decision.sourceId] === decision.destinationId && decision.destinationId === conflict.destinationId) priorMappingsMatch++
    }
    const canonicalParity = Object.fromEntries(ENTITY_ORDER.map(entity => [entity, {
      sourceRowsUnchanged: rowsDigest(plan.snapshot.sourceRows[entity]) === rowsDigest(oldPlan.snapshot.sourceRows[entity]),
      destinationRowsUnchanged: rowsDigest(plan.snapshot.targetRows[entity]) === rowsDigest(oldPlan.snapshot.targetRows[entity]),
    }]))
    const destinationOnlyRetained = plan.entries.filter(row => row.action === 'retain')
    const oldRetained = oldPlan.entries.filter(row => row.action === 'retain')
    report.parity = { conflictCounts, equivalentConflicts, priorDecisionCoverage, priorMappingsMatch,
      countsUnchanged: equal(plan.counts, oldPlan.counts), entriesUnchanged: equal(plan.entries, oldPlan.entries),
      canonicalParity, sourceAssuranceUnchanged: equal(plan.snapshot.sourceIdentities, oldPlan.snapshot.sourceIdentities),
      retryHistoryUnchanged: equal(plan.snapshot.retryHistory, oldPlan.snapshot.retryHistory),
      destinationIdentitiesUnchanged: equal(plan.snapshot.identities, oldPlan.snapshot.identities),
      decisionsByEntity, fieldsByEntity, priorSecurityChoiceCount: oldDecisions.security?.length ?? 0,
      priorSettingsChoiceCount: Object.keys(oldDecisions.settings ?? {}).length,
      retainedDestinationOnlyCount: destinationOnlyRetained.length, retainedEntriesUnchanged: equal(destinationOnlyRetained, oldRetained),
      priorExpectedResultDigest: oldResolved.expectedResultDigest, priorResolutionDigest: oldResolved.resolutionDigest,
      priorExpectedCounts: Object.fromEntries(ENTITY_ORDER.map(entity => [entity, oldResolved.expectedResult[entity].length])),
      status: 'suggested prior choices only; fresh preview unresolved; no resolution performed' }
    report.parity.requiresChangedConflictReview = plan.unresolved.length !== 53 || equivalentConflicts !== 53 || !report.parity.entriesUnchanged || report.canonicalComparison.changedEntities.length > 0
    privateWrite('prior-decisions-protected-copy.json', oldDecisions)
  })
  await stage('source-and-original-baseline-after-audit', 'normal-sequence', async () => {
    const after = await cli('inspect-source-after', ['inspect', '--source', 'supabase', '--source-env', 'MIGRATION_SOURCE_DB'])
    report.sourceAfter = sourceSummary(after)
    report.sourceInspectionUnchanged = equal(report.sourceBefore, report.sourceAfter)
    assert(report.sourceInspectionUnchanged, 'E_SOURCE_INSPECTION_DRIFT')
    const baselineAfter = await publicDigests(original)
    privateWrite('baseline-after-row-digests.json', baselineAfter)
    report.originalBaselineUnchanged = equal(baselineBefore, baselineAfter)
    assert(report.originalBaselineUnchanged, 'E_ORIGINAL_BASELINE_DRIFT')
    report.gate = (await target.query('select state, run_id, fence_generation from public.migration_write_gate')).rows.map(row => ({ state: row.state, runId: row.run_id, generation: row.fence_generation }))
    assert(report.gate.length === 1 && report.gate[0].state === 'fenced' && report.gate[0].runId === runId, 'E_GATE_BINDING')
    report.importReceiptCount = Number((await target.query('select count(*) as count from public.migration_runs')).rows[0].count)
    assert(report.importReceiptCount === 0, 'E_UNEXPECTED_RECEIPT')
    report.acl = verifyAcl()
  })
  report.status = 'preview-ready-awaiting-root-review'
  report.phase1CompletedAt = new Date().toISOString()
  report.rootReviewElapsedSecondsAtReturn = (Date.now() - Date.parse(report.rootReviewStartedAt)) / 1000
  save(); report.acl = verifyAcl(); save()
  console.log(JSON.stringify({ status: report.status, artifacts, runId, database, planDigest: report.preview.planDigest, bundleDigest: report.bundleDigest, conflicts: report.preview.unresolvedCount, changedCanonicalEntities: report.canonicalComparison.changedEntities, normalElapsedSeconds: report.normalElapsedSeconds, originalBaselineUnchanged: report.originalBaselineUnchanged, sourceInspectionUnchanged: report.sourceInspectionUnchanged, requiresChangedConflictReview: report.parity.requiresChangedConflictReview }))
} catch (error) {
  report.status = 'stopped-on-error'; report.errorCode = String(error.code ?? 'E_PHASE1_FAILURE')
  try { appendFileSync(join(artifacts, 'private-errors.log'), `${error.stack ?? error}\n`); save() } catch {}
  console.log(JSON.stringify({ status: report.status, errorCode: report.errorCode, artifacts, database }))
  process.exitCode = 1
} finally {
  for (const client of [target, original, admin]) { try { if (client) await client.end() } catch {} }
}
