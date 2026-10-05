// Authorized disposable-only C08 phase2. Secrets and record bodies never go to stdout.
import NextEnv from '@next/env'
import pg from 'pg'
import { SignJWT } from 'jose'
import { randomBytes, randomUUID } from 'node:crypto'
import net from 'node:net'
import { spawn, spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, appendFileSync, openSync, closeSync } from 'node:fs'
import { join } from 'node:path'
import { runCli } from '../../tool/src/cli.ts'
import { canonicalStringify, sha256Hex } from '../../tool/src/format.ts'
import { verifyResolvedPlan } from '../../tool/src/resolutions.ts'
import { assertPlanFresh } from '../../tool/src/merge-plan.ts'
import { computeSchemaFingerprint, checkMigrationLedger } from '../../tool/src/schema.ts'
import { openReadOnlySession } from '../../tool/src/providers/session.ts'
import { resolveDatabaseTarget } from '../../tool/src/connections.ts'
import { readDeploymentSnapshot } from '../../tool/src/providers/read.ts'

const root = process.cwd()
const artifacts = 'C:\\Users\\kasku\\AppData\\Local\\Temp\\vsis-migration-resume-20261004-141316'
const database = 'vsis_c08_resume_20261004_141316'
const originalDatabase = 'vsis_migration_destination_20261003'
const restoreDatabase = 'vsis_c08_restore_20261004_141316'
const abortDatabase = 'vsis_c08_abort_resume_20261004_141316'
const runId = 'resume-20261004-141316'
const container = 'vsis-migration-native'
const docker = 'C:\\Users\\kasku\\AppData\\Local\\Programs\\DockerDesktop\\resources\\bin\\docker.exe'
const resolvedPath = join(artifacts, 'rehearsal-resolved.json')
const pinned = { plan: '1c3f17257f818b6271b9fdfb200c61bd5afb4e2645dd005d2e9e492cfb7f5aa5', resolution: 'bdd9ee30b25ce12f9099b113cf19b2e69cd8fad218014505cf6aea1f23c5fe39', expected: 'aff9274b4abc44921625980451c54fc66a6da3bbfdf27d1f6661521fdea8344e', namespace: 'native:71e51abbe184be0f16598b45d83cca72', runtime: '3ca751118ee8d5a4a93aa855816d398e' }
const origin = 'http://127.0.0.1:4027'
const smtpPort = 5027
const report = { status: 'phase2-preparing', runId, database, artifacts, startedAt: new Date().toISOString(), normalSequenceStartedAt: '2026-10-04T14:20:40.857Z', stages: [], productionWrites: false, productionFence: false, sourceAuthOperations: false, normalBudgetMinutes: 45, recoveryReserveMinutes: 15 }
let env; let url; let nativeUser; let admin; let target; let original; let runtime; let smtp; let runtimeFd; let selected; let cookie; let baselineBefore; let mergedDigests
const mailMessages = []
const json = path => JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''))
const equal = (a, b) => canonicalStringify(a) === canonicalStringify(b)
const assert = (ok, code) => { if (!ok) throw Object.assign(new Error(code), { code }) }
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const writeNew = (name, value) => writeFileSync(join(artifacts, name), `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' })
function save() {
  report.normalElapsedSeconds = (Date.now() - Date.parse(report.normalSequenceStartedAt)) / 1000
  report.normalWithin45Minutes = report.normalElapsedSeconds <= 2700
  writeFileSync(join(root, 'migrations/rehearsal/local/c08-phase2-progress.json'), `${JSON.stringify(report, null, 2)}\n`)
  writeFileSync(join(artifacts, 'phase2-safe-progress.json'), `${JSON.stringify(report, null, 2)}\n`)
}
function acl() {
  const script = `$ErrorActionPreference='Stop'; $taskRoot='${artifacts}'; $taskSid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; $taskAllowed=@($taskSid,'S-1-5-18','S-1-5-32-544'); if(-not (Get-Acl -LiteralPath $taskRoot).AreAccessRulesProtected){throw 'Root inheritance enabled'}; $taskItems=@(Get-Item -LiteralPath $taskRoot)+@(Get-ChildItem -LiteralPath $taskRoot -Recurse -Force); foreach($taskItem in $taskItems){if($taskItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint){throw 'Reparse point refused'}; $taskRules=(Get-Acl -LiteralPath $taskItem.FullName).GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier]); foreach($taskRule in $taskRules){if($taskRule.AccessControlType -eq 'Allow' -and $taskRule.IdentityReference.Value -notin $taskAllowed){throw 'Unexpected ACL principal'}}; if(@($taskRules | Where-Object {$_.AccessControlType -eq 'Allow'}).Count -ne 3){throw 'Expected three principals'}}; @{inheritanceDisabled=$true;allowedPrincipals='current operator, SYSTEM, Administrators';filesChecked=@($taskItems | Where-Object {-not $_.PSIsContainer}).Count}|ConvertTo-Json -Compress`
  const result = spawnSync('C:\\Users\\kasku\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\native\\powershell\\pwsh.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { encoding: 'utf8', windowsHide: true })
  assert(result.status === 0, 'E_ACL_VERIFY'); return JSON.parse(result.stdout.trim())
}
async function stage(name, fn) {
  const entry = { name, startedAt: new Date().toISOString() }; report.stages.push(entry); save()
  try { const result = await fn(); entry.status = 'passed'; return result }
  catch (error) { entry.status = 'failed'; entry.errorCode = String(error.code ?? 'E_STAGE_FAILURE'); throw error }
  finally { entry.endedAt = new Date().toISOString(); entry.seconds = (Date.parse(entry.endedAt) - Date.parse(entry.startedAt)) / 1000; save(); console.log(JSON.stringify({ stage: name, status: entry.status, seconds: entry.seconds })) }
}
function dockerRun(args, input) {
  const result = spawnSync(docker, args, { input, maxBuffer: 64 * 1024 * 1024, windowsHide: true })
  if (result.status !== 0) { appendFileSync(join(artifacts, 'phase2-private-errors.log'), result.stderr ?? ''); throw Object.assign(new Error('E_DOCKER'), { code: 'E_DOCKER' }) }
  return result.stdout
}
async function cli(name, args) {
  const output = []; const errors = []
  const code = await runCli([...args, '--json'], { env, cwd: join(root, 'migrations/tool'), runRoot: join(artifacts, 'journals-phase2'), out: line => output.push(line), err: line => errors.push(line) })
  writeNew(`${name}-private-cli.json`, { code, output, errors }); report.acl = acl()
  assert(code === 0, `E_CLI_${name.toUpperCase()}_${code}`)
  return JSON.parse(output.find(line => line.trim().startsWith('{')))
}
async function digests(client) {
  await client.query('begin isolation level repeatable read read only')
  try {
    await client.query("set local timezone='UTC'")
    const result = {}; const tables = (await client.query("select tablename from pg_tables where schemaname='public' order by tablename")).rows
    for (const { tablename } of tables) {
      assert(/^[a-z0-9_]+$/.test(tablename), 'E_TABLE_IDENTIFIER')
      const rows = (await client.query(`select to_jsonb(t)::text as payload from public."${tablename}" t`)).rows.map(row => row.payload).sort()
      result[tablename] = { count: rows.length, digest: sha256Hex(canonicalStringify(rows)) }
    }
    await client.query('commit'); return result
  } catch (error) { await client.query('rollback'); throw error }
}
function forDatabase(name) { const result = new URL(url); result.pathname = `/${name}`; return result.href }
async function restoredClone(name, dump) {
  assert([restoreDatabase, abortDatabase].includes(name), 'E_RESTORE_SCOPE')
  assert((await admin.query('select 1 from pg_database where datname=$1', [name])).rowCount === 0, 'E_RESTORE_EXISTS')
  await admin.query(`create database "${name}" template template0`)
  dockerRun(['exec', '-i', container, 'pg_restore', '-U', nativeUser, '-d', name, '--exit-on-error', '--no-owner', '--no-acl'], dump)
  const client = new pg.Client({ connectionString: forDatabase(name) }); await client.connect()
  assert((await client.query('select current_database() as db')).rows[0].db === name, 'E_RESTORE_BINDING')
  return client
}
async function http(name, path, options = {}) {
  assert(path.startsWith('/'), 'E_HTTP_PATH')
  const response = await fetch(`${origin}${path}`, { ...options, redirect: 'manual', signal: AbortSignal.timeout(20000), headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers } })
  const text = await response.text(); let body; try { body = JSON.parse(text) } catch { body = null }
  writeNew(`http-${name}-private.json`, { status: response.status, body, text: body ? undefined : text, setCookie: response.headers.get('set-cookie') })
  return { status: response.status, body, cookie: response.headers.get('set-cookie') }
}
function startSmtp() {
  smtp = net.createServer(socket => {
    socket.setEncoding('utf8'); socket.write('220 localhost C08 loopback sink\r\n')
    let buffer = ''; let dataMode = false; let message = ''
    socket.on('data', chunk => {
      buffer += chunk
      while (buffer.includes('\r\n')) {
        const i = buffer.indexOf('\r\n'); const line = buffer.slice(0, i); buffer = buffer.slice(i + 2)
        if (dataMode) {
          if (line === '.') { dataMode = false; mailMessages.push(message); writeFileSync(join(artifacts, `smtp-loopback-private-${mailMessages.length}.eml`), message, { flag: 'wx' }); message = ''; socket.write('250 captured locally\r\n') }
          else message += `${line}\r\n`
          continue
        }
        if (/^(EHLO|HELO)\b/i.test(line)) socket.write('250-localhost\r\n250 8BITMIME\r\n')
        else if (/^DATA\b/i.test(line)) { dataMode = true; socket.write('354 End with dot\r\n') }
        else if (/^QUIT\b/i.test(line)) { socket.end('221 Bye\r\n') }
        else socket.write('250 OK\r\n')
      }
    })
    socket.on('error', () => {})
  })
  return new Promise((resolve, reject) => { smtp.once('error', reject); smtp.listen(smtpPort, '127.0.0.1', resolve) })
}
async function shutdownRuntime() {
  if (runtime && runtime.exitCode === null) {
    runtime.kill()
    await Promise.race([new Promise(resolve => runtime.once('exit', resolve)), sleep(5000)])
    assert(runtime.exitCode !== null, 'E_RUNTIME_STOP')
  }
  if (runtimeFd !== undefined) { closeSync(runtimeFd); runtimeFd = undefined }
  if (smtp) { await new Promise(resolve => smtp.close(resolve)); smtp = undefined }
}

try {
  report.acl = acl(); save()
  const resolved = json(resolvedPath)
  await stage('pinned-artifact-live-binding-fence-baseline', async () => {
    const approval = json(join(root, 'migrations/rehearsal/local/c08-root-review.json'))
    assert(approval.applyAuthorized && approval.resolutionDigest === pinned.resolution && approval.planDigest === pinned.plan, 'E_ROOT_APPLY_APPROVAL')
    assert(verifyResolvedPlan(resolved).length === 0 && resolved.plan.planDigest === pinned.plan && resolved.resolutionDigest === pinned.resolution && resolved.expectedResultDigest === pinned.expected, 'E_PINNED_ARTIFACT')
    NextEnv.loadEnvConfig(root)
    const metadata = JSON.parse(dockerRun(['inspect', container]).toString('utf8'))[0]
    const ports = metadata.NetworkSettings.Ports['5432/tcp']
    assert(metadata.Name === `/${container}` && metadata.State.Running && ports.length === 1 && ports[0].HostIp === '127.0.0.1' && ports[0].HostPort === '5432', 'E_LOOPBACK_CONTAINER')
    const vars = Object.fromEntries(metadata.Config.Env.map(entry => { const i = entry.indexOf('='); return [entry.slice(0, i), entry.slice(i + 1)] }))
    nativeUser = vars.POSTGRES_USER ?? 'postgres'
    assert(vars.POSTGRES_PASSWORD || (metadata.Config.Image === 'postgres:16-alpine' && vars.POSTGRES_HOST_AUTH_METHOD === 'trust' && nativeUser === 'postgres'), 'E_NATIVE_CONFIGURATION')
    url = new URL('postgresql://127.0.0.1:5432/postgres'); url.username = nativeUser; if (vars.POSTGRES_PASSWORD) url.password = vars.POSTGRES_PASSWORD
    admin = new pg.Client({ connectionString: url.href }); await admin.connect()
    target = new pg.Client({ connectionString: forDatabase(database) }); await target.connect()
    const binding = (await target.query('select current_database() as db, inet_server_port() as port')).rows[0]
    assert(binding.db === database && binding.port === 5432, 'E_TARGET_DATABASE')
    env = { ...process.env, MIGRATION_NATIVE_DB: forDatabase(database) }; delete env.MIGRATION_DESTINATION_DB; delete env.DATABASE_URL
    const session = openReadOnlySession(resolveDatabaseTarget({ provider: 'native', role: 'destination', envName: 'MIGRATION_NATIVE_DB', env }))
    try {
      await session.assertReadOnly(); const identity = await session.identity()
      assert(identity.namespace === pinned.namespace && identity.runtimeFingerprint === pinned.runtime && identity.database === database, 'E_TARGET_IDENTITY')
      const schema = computeSchemaFingerprint(await session.inspectCatalog(), 'native')
      assert(checkMigrationLedger('native', await session.migrationLedger()).ok, 'E_TARGET_LEDGER')
      const snapshot = await session.withReadOnlyTransaction(() => readDeploymentSnapshot(session, resolved.plan.sourceInstance.namespace))
      assertPlanFresh(resolved.plan, snapshot, { schemaFingerprint: schema, applicationVersion: '1.1.6' })
      report.targetBinding = { host: '127.0.0.1', port: 5432, database, namespace: identity.namespace, runtimeFingerprint: identity.runtimeFingerprint, schemaFingerprint: schema }
    } finally { await session.close() }
    const gate = (await target.query('select state, run_id from public.migration_write_gate')).rows[0]
    assert(gate.state === 'fenced' && gate.run_id === runId, 'E_FENCED_RUN')
    assert(Number((await target.query('select count(*) as count from public.migration_runs')).rows[0].count) === 0, 'E_UNEXPECTED_RECEIPT')
    const sqlChecksum = sha256Hex(readFileSync(join(root, 'db/migrations/0038_timesheet_list_sort_index.sql'), 'utf8'))
    const ledger = (await target.query('select checksum from public.schema_migrations where name=$1', ['0038_timesheet_list_sort_index.sql'])).rows
    const index = (await target.query("select indexdef from pg_indexes where schemaname='public' and indexname='idx_timesheets_logdate_created'")).rows
    assert(ledger.length === 1 && ledger[0].checksum === sqlChecksum && index.length === 1 && /log_date DESC, created_at DESC, id DESC/.test(index[0].indexdef), 'E_0038_PROOF')
    report.index0038 = { checksum: sqlChecksum, checksumMatch: true, ledgerPresent: true, indexPresent: true }
    original = new pg.Client({ connectionString: forDatabase(originalDatabase), options: '-c default_transaction_read_only=on' }); await original.connect()
    baselineBefore = await digests(original)
    assert(equal(baselineBefore, json(join(artifacts, 'baseline-before-row-digests.json'))), 'E_ORIGINAL_BASELINE')
  })
  const applyArgs = ['apply', '--target', 'native', '--target-env', 'MIGRATION_NATIVE_DB', '--target-app-version', '1.1.6', '--plan', resolvedPath, '--expect-plan-digest', pinned.plan, '--run-id', runId]
  const verifyArgs = ['verify', '--target', 'native', '--target-env', 'MIGRATION_NATIVE_DB', '--plan', resolvedPath, '--run-id', runId]
  await stage('transactional-apply', async () => {
    const result = await cli('apply', applyArgs)
    assert(result.status === 'committed' && result.issues.length === 0, 'E_APPLY_OUTCOME')
    report.apply = { status: result.status, counts: result.counts, issueCount: result.issues.length, resolutionDigest: pinned.resolution, expectedResultDigest: pinned.expected }
  })
  await stage('complete-reconciliation-and-recorded-verification', async () => {
    const result = await cli('verify-record', [...verifyArgs, '--record', '--reason', 'C08 merged rows mappings dispositions retries reconciled', '--actor', 'C08-local-operator'])
    assert(result.ok && (result.issues ?? []).length === 0, 'E_VERIFY_RESULT')
    report.verification = { ok: result.ok, issueCount: (result.issues ?? []).length, recorded: true }
  })
  await stage('apply-replay-and-zero-row-drift', async () => {
    const before = await digests(target)
    const result = await cli('apply-replay', applyArgs)
    assert(result.status === 'no-op' && result.issues.length === 0 && Array.isArray(result.rowDriftIssues) && result.rowDriftIssues.length === 0, 'E_REPLAY_RESULT')
    assert(equal(before, await digests(target)), 'E_REPLAY_PUBLIC_ROW_DRIFT')
    report.replay = { status: 'no-op', issueCount: 0, rowDriftIssueCount: 0, allPublicRowsUnchanged: true }
  })
  await stage('fresh-116-runtime-and-fenced-business-denial', async () => {
    const evidence = json(join(root, 'migrations/rehearsal/local/c08-116-build-evidence.json'))
    const serverPath = join(root, '.next/standalone/server.js')
    assert(evidence.applicationVersion === '1.1.6' && evidence.backend === 'native' && sha256Hex(readFileSync(serverPath)) === evidence.serverEntrySha256, 'E_BUILD_BINDING')
    await startSmtp()
    const localSecret = randomBytes(48).toString('hex')
    const runtimeEnv = { ...process.env, NODE_ENV: 'production', HOSTNAME: '127.0.0.1', PORT: '4027', DATABASE_URL: forDatabase(database), AUTH_SECRET: localSecret, NEXT_PUBLIC_BACKEND: 'native', SMTP_HOST: '127.0.0.1', SMTP_PORT: String(smtpPort), SMTP_SECURE: 'false', SMTP_USER: '', SMTP_PASSWORD: '', SMTP_FROM: 'C08 rehearsal <no-reply@localhost.invalid>', APP_BASE_URL: origin, APP_URL: origin, NEXT_PUBLIC_APP_URL: origin, NEXT_PUBLIC_SITE_URL: origin, HEALTH_DEBUG: 'true', NEXT_TELEMETRY_DISABLED: '1', NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:9', NEXT_PUBLIC_SUPABASE_ANON_KEY: '', SUPABASE_SERVICE_ROLE_KEY: '', TELEGRAM_BOT_TOKEN: '', TELEGRAM_CHAT_ID: '', CRON_SECRET: randomBytes(32).toString('hex') }
    delete runtimeEnv.MIGRATION_SOURCE_DB; delete runtimeEnv.MIGRATION_DESTINATION_DB
    runtimeFd = openSync(join(artifacts, 'native-116-runtime-private.log'), 'wx')
    runtime = spawn(process.execPath, ['server.js'], { cwd: join(root, '.next/standalone'), env: runtimeEnv, stdio: ['ignore', runtimeFd, runtimeFd], windowsHide: true })
    report.ownedRuntimePid = runtime.pid
    let health
    for (let n = 0; n < 60; n++) {
      assert(runtime.exitCode === null, 'E_RUNTIME_EXIT')
      try { const response = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(2000) }); if (response.status === 200) { health = await response.json(); break } } catch {}
      await sleep(1000)
    }
    assert(health?.backend === 'native' && health.version === '1.1.6', 'E_RUNTIME_HEALTH')
    selected = (await target.query("select id,email,session_version,password_hash from public.profiles where is_active and email is not null order by (permission_role='admin') desc,id limit 1")).rows[0]
    assert(selected && !selected.password_hash, 'E_NATIVE_ENROLLMENT_EXPECTATION')
    const token = await new SignJWT({ email: selected.email, sv: Number(selected.session_version ?? 0) }).setProtectedHeader({ alg: 'HS256' }).setSubject(selected.id).setIssuedAt().setExpirationTime('5m').sign(new TextEncoder().encode(localSecret))
    cookie = `vsis_session=${token}`
    const before = await digests(target)
    const read = await http('fenced-read', '/api/v1/timesheets?limit=1&includeCount=false')
    assert(read.status === 200, 'E_FENCED_READ')
    const refusal = await http('fenced-write', '/api/v1/timesheets', { method: 'POST', body: JSON.stringify({}) })
    assert(refusal.status === 503 && (refusal.body?.error?.code ?? refusal.body?.code) === 'WRITERS_FENCED', 'E_FENCED_BUSINESS_DENIAL')
    assert(equal(before, await digests(target)), 'E_FENCED_DENIAL_MUTATION')
    report.runtime = { applicationVersion: '1.1.6', buildId: evidence.buildId, serverEntryDigestMatch: true, source: 'root fresh build including existing dirty tree; not immutable production proof', databaseOverride: database, SMTP: '127.0.0.1:5027 only', health: 'passed', ownedPid: runtime.pid }
    report.fencedBusiness = { readsAllowed: true, writeStatus: refusal.status, code: 'WRITERS_FENCED', allPublicRowsUnchanged: true, session: 'short-lived local test session; fresh login tested after admission' }
  })
  await stage('protected-merged-backup-and-independent-restore', async () => {
    mergedDigests = await digests(target); writeNew('merged-before-publication-row-digests.json', mergedDigests)
    const dump = dockerRun(['exec', container, 'pg_dump', '-U', nativeUser, '-d', database, '-Fc', '--no-owner', '--no-acl'])
    writeFileSync(join(artifacts, 'merged-before-publication.dump'), dump, { flag: 'wx' })
    const restored = await restoredClone(restoreDatabase, dump)
    try { assert(equal(mergedDigests, await digests(restored)), 'E_MERGED_RESTORE_PARITY') } finally { await restored.end() }
    report.mergedRestore = { database: restoreDatabase, publicTables: Object.keys(mergedDigests).length, exactAllTableParity: true, backupDigest: sha256Hex(dump) }
    report.acl = acl()
  })
  await stage('pre-intent-abort-to-seeded-baseline', async () => {
    const recoveryStart = Date.now()
    const mergedDump = readFileSync(join(artifacts, 'merged-before-publication.dump'))
    const abort = await restoredClone(abortDatabase, mergedDump)
    try {
      assert(equal(mergedDigests, await digests(abort)), 'E_ABORT_MERGED_START')
      const baselineDump = readFileSync(join(artifacts, 'native-seeded-baseline.dump'))
      assert((await abort.query('select current_database() as db')).rows[0].db === abortDatabase, 'E_ABORT_ONLY_OWNED_CLONE')
      dockerRun(['exec', '-i', container, 'pg_restore', '-U', nativeUser, '-d', abortDatabase, '--clean', '--if-exists', '--exit-on-error', '--no-owner', '--no-acl'], baselineDump)
      const restored = await digests(abort); assert(equal(restored, baselineBefore), 'E_ABORT_BASELINE_PARITY')
      writeNew('abort-restored-baseline-row-digests.json', restored)
      report.abortRecovery = { database: abortDatabase, mergedStateInitiallyMatched: true, restoredBaselineExact: true, publicTables: 24, seconds: (Date.now() - recoveryStart) / 1000, within15MinuteAllowance: Date.now() - recoveryStart <= 900000, scope: 'isolated pre-intent native recovery; production provider recovery not exercised' }
    } finally { await abort.end() }
  })
  await stage('pre-publication-reconciliation-and-original-audit', async () => {
    const result = await cli('verify-before-intent', verifyArgs)
    assert(result.ok && (result.issues ?? []).length === 0 && equal(mergedDigests, await digests(target)), 'E_PRE_INTENT_DRIFT')
    assert(equal(baselineBefore, await digests(original)), 'E_ORIGINAL_BEFORE_INTENT')
  })
  await stage('local-publication-intent', async () => {
    const result = await cli('publish-intent', ['publish', '--target', 'native', '--target-env', 'MIGRATION_NATIVE_DB', '--phase', 'intent', '--run-id', runId, '--reason', 'C08 verified disposable publication', '--actor', 'C08-local-operator'])
    assert(result.ok, 'E_INTENT_RESULT'); report.publicationIntent = { ok: true }
  })
  await stage('local-publication-admission', async () => {
    const result = await cli('publish-admit', ['publish', '--target', 'native', '--target-env', 'MIGRATION_NATIVE_DB', '--phase', 'admit', '--run-id', runId, '--reason', 'C08 verified disposable admit', '--actor', 'C08-local-operator'])
    assert(result.ok, 'E_ADMIT_RESULT')
    const gate = (await target.query('select state,run_id from public.migration_write_gate')).rows[0]
    const receipt = (await target.query('select state,plan_digest,resolution_digest,expected_result_digest from public.migration_runs where run_id=$1', [runId])).rows[0]
    assert(gate.state === 'open' && gate.run_id === runId && receipt.state === 'writable' && receipt.resolution_digest === pinned.resolution && receipt.expected_result_digest === pinned.expected, 'E_ADMISSION_RECEIPT')
    report.publication = { gateState: gate.state, receiptState: receipt.state, runId, planDigest: receipt.plan_digest, resolutionDigest: receipt.resolution_digest, expectedResultDigest: receipt.expected_result_digest }
  })
  report.status = 'published-awaiting-application-smoke'; save()
  // Smoke remains in this owned runtime with loopback-only mail and clone binding.
  await stage('native-enrollment-and-fresh-login', async () => {
    cookie = undefined
    const password = `C08!${randomBytes(24).toString('base64url')}aA9`
    const unenrolled = await http('unenrolled-login', '/api/auth/login', { method: 'POST', body: JSON.stringify({ email: selected.email, password }) })
    assert(unenrolled.status === 401, 'E_UNENROLLED_LOGIN')
    const request = await http('forgot-password', '/api/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email: selected.email }) })
    assert(request.status === 200, 'E_FORGOT_PASSWORD')
    for (let n = 0; n < 50 && mailMessages.length === 0; n++) await sleep(100)
    assert(mailMessages.length === 1, 'E_LOOPBACK_MAIL_CAPTURE')
    const mail = mailMessages[0].replace(/=\r?\n/g, '').replace(/=3D/g, '=')
    assert(mail.includes(origin), 'E_RESET_LINK_BINDING')
    const token = /token=([A-Za-z0-9_-]{32,256})/.exec(mail)?.[1]
    assert(token, 'E_RESET_TOKEN_CAPTURE')
    const reset = await http('reset-password', '/api/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, newPassword: password }) })
    assert(reset.status === 200, 'E_PASSWORD_RESET')
    const reused = await http('reset-token-reuse', '/api/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, newPassword: password }) })
    assert(reused.status === 400, 'E_RESET_TOKEN_REUSE')
    const login = await http('fresh-login', '/api/auth/login', { method: 'POST', body: JSON.stringify({ email: selected.email, password }) })
    assert(login.status === 200 && login.cookie?.includes('vsis_session='), 'E_FRESH_LOGIN')
    cookie = login.cookie.split(';')[0]
    const me = await http('fresh-session', '/api/auth/me')
    assert(me.status === 200 && me.body?.user?.id === selected.id, 'E_FRESH_SESSION')
    report.enrollment = { uninitializedLoginRefused: true, resetRequested: true, loopbackMessages: mailMessages.length, resetLinkLocal: true, passwordEnrollment: true, resetTokenReuseStatus: reused.status, freshLogin: true, freshCookieSession: true, externalMailDelivery: false }
  })
  await stage('cookie-business-smoke-retry-edit-report-refusal-cleanup', async () => {
    await sleep(5100) // let this runtime observe the admitted gate after its bounded cache
    const project = (await target.query('select id from public.projects order by id limit 1')).rows[0]
    const activity = (await target.query('select id from public.activity_types where is_active order by id limit 1')).rows[0]
    const logDate = '1999-12-30'; const marker = `C08-disposable-smoke-${runId}-${randomUUID()}`
    assert(Number((await target.query('select count(*) as count from public.timesheets where user_id=$1 and log_date=$2', [selected.id, logDate])).rows[0].count) === 0, 'E_SMOKE_DATE_EMPTY')
    const countBefore = Number((await target.query('select count(*) as count from public.timesheets')).rows[0].count)
    const body = { projectId: project.id, activityTypeId: activity.id, logDate, hoursWorked: 1, workDone: marker }
    const key = randomUUID()
    const created = await http('create-timesheet', '/api/v1/timesheets', { method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify(body) })
    assert(created.status === 201, 'E_SMOKE_CREATE')
    const owned = (await target.query('select id,hours_worked from public.timesheets where user_id=$1 and work_done=$2', [selected.id, marker])).rows
    assert(owned.length === 1, 'E_SMOKE_OWNERSHIP')
    const id = owned[0].id
    const replay = await http('create-replay', '/api/v1/timesheets', { method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify(body) })
    assert(replay.status === 201 && Number((await target.query('select count(*) as count from public.timesheets where work_done=$1', [marker])).rows[0].count) === 1, 'E_SMOKE_CREATE_REPLAY')
    const queued = await http('queued-keyed-edit-refusal', `/api/v1/timesheets/${id}`, { method: 'PUT', headers: { 'Idempotency-Key': randomUUID() }, body: JSON.stringify({ ...body, hoursWorked: 2 }) })
    assert(queued.status === 409 && queued.body?.error?.code === 'IDEMPOTENCY_REVIEW_REQUIRED', 'E_QUEUED_REVIEW_REFUSAL')
    assert(Number((await target.query('select hours_worked from public.timesheets where id=$1', [id])).rows[0].hours_worked) === 1, 'E_QUEUED_REFUSAL_MUTATION')
    const edited = await http('immediate-cookie-edit', `/api/v1/timesheets/${id}`, { method: 'PUT', body: JSON.stringify({ ...body, hoursWorked: 2 }) })
    assert(edited.status === 200 && Number((await target.query('select hours_worked from public.timesheets where id=$1', [id])).rows[0].hours_worked) === 2, 'E_SMOKE_EDIT')
    const totals = await http('report-totals', `/api/v1/reports?from=${logDate}&to=${logDate}&userId=${selected.id}&groupBy=user`)
    assert(totals.status === 200, 'E_SMOKE_REPORT')
    writeNew('report-response-shape-safe.json', { topKeys: Object.keys(totals.body ?? {}), dataKeys: Object.keys(totals.body?.data ?? {}) })
    const totalValue = totals.body?.data?.grandTotal ?? totals.body?.data?.totalHours ?? totals.body?.data?.total
    assert(Number(totalValue) === 2, 'E_SMOKE_REPORT_TOTAL')
    const invalid = await http('invalid-hours-refusal', '/api/v1/timesheets', { method: 'POST', body: JSON.stringify({ ...body, hoursWorked: 25 }) })
    assert(invalid.status === 400 && Number((await target.query('select count(*) as count from public.timesheets')).rows[0].count) === countBefore + 1, 'E_INVALID_HOURS_MUTATION')
    const deleted = await http('smoke-cleanup', `/api/v1/timesheets/${id}`, { method: 'DELETE' })
    assert(deleted.status === 200 && Number((await target.query('select count(*) as count from public.timesheets')).rows[0].count) === countBefore, 'E_SMOKE_CLEANUP')
    const restoredTotals = await http('report-totals-after-cleanup', `/api/v1/reports?from=${logDate}&to=${logDate}&userId=${selected.id}&groupBy=user`)
    const afterValue = restoredTotals.body?.data?.grandTotal ?? restoredTotals.body?.data?.totalHours ?? restoredTotals.body?.data?.total
    assert(restoredTotals.status === 200 && Number(afterValue) === 0, 'E_SMOKE_REPORT_CLEANUP')
    report.smoke = { create: true, createReplay: true, queuedKeyedEditStatus: 409, queuedKeyedEditCode: 'IDEMPOTENCY_REVIEW_REQUIRED', queuedRefusalNoMutation: true, queuedReplayCertified: false, immediateCookieEdit: true, reportHours: 2, invalidHoursStatus: 400, invalidRefusalNoMutation: true, ownedSmokeRowCleaned: true, reportHoursAfterCleanup: 0 }
  })
  await stage('final-source-original-baseline-and-disposable-audit', async () => {
    const inspected = await cli('source-final-inspect', ['inspect', '--source', 'supabase', '--source-env', 'MIGRATION_SOURCE_DB'])
    const phase1 = json(join(artifacts, 'phase1-safe-summary.json'))
    assert(inspected.schemaFingerprint === phase1.sourceBefore.schemaFingerprint && equal(inspected.counts, phase1.sourceBefore.counts) && equal(inspected.appliedMigrations, phase1.sourceBefore.appliedMigrations), 'E_FINAL_SOURCE_DRIFT')
    assert(equal(baselineBefore, await digests(original)), 'E_FINAL_ORIGINAL_BASELINE')
    const audited = await digests(target); writeNew('final-disposable-row-digests.json', audited)
    assert(audited.profiles.count === 23 && audited.timesheets.count === 854 && audited.projects.count === 47, 'E_FINAL_COUNTS')
    report.finalAudit = { sourceInspectionUnchanged: true, originalBaselineAll24TablesUnchanged: true, oldSuccessfulCloneUntouched: true, profiles: audited.profiles.count, timesheets: audited.timesheets.count, projects: audited.projects.count, smokeRowsRemaining: 0, postSmokeImportReconciliationClaim: false, note: 'verification recorded before smoke; local enrollment, audit and retry effects remain on disposable only' }
  })
  await stage('owned-runtime-and-mail-sink-stop', async () => { await shutdownRuntime(); report.runtimeStopped = true; report.mailSinkStopped = true })
  report.status = 'phase2-complete'; report.completedAt = new Date().toISOString(); save()
  report.timingAssessment = { normalElapsedSeconds: report.normalElapsedSeconds, plus15MinuteReserveSeconds: report.normalElapsedSeconds + 900, accepted60MinuteFit: report.normalElapsedSeconds + 900 <= 3600, recoveryActualSeconds: report.abortRecovery.seconds, productionFreezeProven: false }
  report.acl = acl(); save(); writeNew('phase2-final-safe-summary.json', report)
  console.log(JSON.stringify({ status: report.status, artifacts, database, runId, apply: report.apply, verification: report.verification, replay: report.replay, publication: report.publication, timing: report.timingAssessment, smoke: report.smoke, finalAudit: report.finalAudit }))
} catch (error) {
  report.status = 'phase2-stopped-on-guard'; report.errorCode = String(error.code ?? 'E_PHASE2_FAILURE')
  try { appendFileSync(join(artifacts, 'phase2-private-errors.log'), `${error.stack ?? error}\n`); save() } catch {}
  console.log(JSON.stringify({ status: report.status, errorCode: report.errorCode, database, artifacts, normalElapsedSeconds: report.normalElapsedSeconds })); process.exitCode = 1
} finally {
  try { await shutdownRuntime() } catch (error) { report.cleanupError = String(error.code ?? 'E_CLEANUP'); try { save() } catch {} }
  for (const client of [target, original, admin]) { try { if (client) await client.end() } catch {} }
}
