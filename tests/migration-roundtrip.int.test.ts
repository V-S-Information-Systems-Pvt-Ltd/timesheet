// tests/migration-roundtrip.int.test.ts
// C02/V4: one complete slice across real boundaries.
//
// This suite is DISPOSABLE-ONLY and fails closed:
//   * every connection comes from an explicit MIGRATION_TEST_* variable;
//   * hosts must be loopback unless MIGRATION_TEST_ALLOW_REMOTE=1;
//   * the native database names must match the disposable allowlist pattern;
//   * the Supabase database additionally requires an explicit
//     MIGRATION_TEST_ALLOW_REMOTE_SUPABASE=1 to run against a remote host;
//   * when a prerequisite is missing the suite skips with the missing names —
//     unless MIGRATION_TEST_REQUIRE=1, which fails the run instead.
//
// Required:
//   MIGRATION_TEST_NATIVE_ADMIN_URL     maintenance connection (create/drop DBs)
//   MIGRATION_TEST_NATIVE_SOURCE_URL    disposable native database (source)
//   MIGRATION_TEST_NATIVE_TARGET_URL    disposable native database (target)
//   MIGRATION_TEST_SUPABASE_DB_URL      disposable Supabase database
//   MIGRATION_TEST_SUPABASE_AUTH_URL    its Auth endpoint
//   MIGRATION_TEST_SUPABASE_SERVICE_KEY service-role/secret key (admin API)
//   MIGRATION_TEST_SUPABASE_ANON_KEY    anon/publishable key (password sign-in proof)

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client, Pool } from 'pg'
import { createClient } from '@supabase/supabase-js'
import { runCli, EXIT_CODES } from '@/lib/migration/cli'
import { runMigrations } from '@/lib/db/migrate'
import { hashPassword } from '@/lib/auth/password'
import { ENTITY_ORDER, type MigrationEntity } from '@/lib/migration/format'
import { parsePostgresUrl, resolveAuthTarget } from '@/lib/migration/connections'
import { openReadOnlySession, openWriteSession } from '@/lib/migration/providers/session'
import { readDeploymentSnapshot } from '@/lib/migration/providers/read'
import { cleanupRunIdentities } from '@/lib/migration/identity'
import { createSupabaseAuthAdmin } from '@/lib/migration/providers/supabase'

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

const REQUIRED_ENV = [
  'MIGRATION_TEST_NATIVE_ADMIN_URL',
  'MIGRATION_TEST_NATIVE_SOURCE_URL',
  'MIGRATION_TEST_NATIVE_TARGET_URL',
  'MIGRATION_TEST_SUPABASE_DB_URL',
  'MIGRATION_TEST_SUPABASE_AUTH_URL',
  'MIGRATION_TEST_SUPABASE_SERVICE_KEY',
  'MIGRATION_TEST_SUPABASE_ANON_KEY',
] as const

const missing = REQUIRED_ENV.filter((name) => !process.env[name])
const REQUIRE = process.env.MIGRATION_TEST_REQUIRE === '1'
const ALLOW_REMOTE = process.env.MIGRATION_TEST_ALLOW_REMOTE === '1'
// The generic remote opt-in must not silently unlock the Supabase target:
// releasing that database needs its own explicit decision.
const ALLOW_REMOTE_SUPABASE = process.env.MIGRATION_TEST_ALLOW_REMOTE_SUPABASE === '1'
const DISPOSABLE_DB_PATTERN = /^vsis_migration_c02_[a-z0-9_]+$/

if (missing.length > 0 && REQUIRE) {
  throw new Error(
    `MIGRATION_TEST_REQUIRE=1 but the live C02 gate is missing: ${missing.join(', ')}. ` +
      'Provide disposable native databases and a disposable Supabase stack, or unset the flag to skip.'
  )
}

function assertDisposable(urlValue: string, label: string, expectDatabase: boolean): void {
  const parsed = parsePostgresUrl(urlValue)
  if (!ALLOW_REMOTE && !parsed.loopback) {
    throw new Error(`${label} must be a loopback address (or set MIGRATION_TEST_ALLOW_REMOTE=1): ${parsed.hostname}`)
  }
  if (expectDatabase && !DISPOSABLE_DB_PATTERN.test(parsed.database)) {
    throw new Error(`${label} must name a disposable database matching ${DISPOSABLE_DB_PATTERN}: ${parsed.database}`)
  }
}

if (missing.length === 0) {
  assertDisposable(process.env.MIGRATION_TEST_NATIVE_SOURCE_URL as string, 'MIGRATION_TEST_NATIVE_SOURCE_URL', true)
  assertDisposable(process.env.MIGRATION_TEST_NATIVE_TARGET_URL as string, 'MIGRATION_TEST_NATIVE_TARGET_URL', true)
  assertDisposable(process.env.MIGRATION_TEST_SUPABASE_DB_URL as string, 'MIGRATION_TEST_SUPABASE_DB_URL', false)
  const supabaseTarget = parsePostgresUrl(process.env.MIGRATION_TEST_SUPABASE_DB_URL as string)
  if (!ALLOW_REMOTE_SUPABASE && !supabaseTarget.loopback) {
    throw new Error(
      `MIGRATION_TEST_SUPABASE_DB_URL must be a loopback address (or set MIGRATION_TEST_ALLOW_REMOTE_SUPABASE=1 explicitly): ${supabaseTarget.hostname}`
    )
  }
}

const suite = missing.length === 0 ? describe : describe.skip

const RUN_ID = 'c02-run-0001'
const EXISTING_EMAIL = 'c02-existing@c02.test'
const EXISTING_PASSWORD = 'C02-existing-passw0rd!'
const EXISTING_ID = 'c0200000-0000-4000-8000-00000000000a'
const SOURCE_MATCH_ID = 'c0200000-0000-4000-8000-0000000000b1'
const SOURCE_NEW_ID = 'c0200000-0000-4000-8000-0000000000b2'
const DESTINATION_PROJECT_ID = 'c0200000-0000-4000-8000-0000000000c0'
const SOURCE_PROJECT_MATCH_ID = 'c0200000-0000-4000-8000-0000000000c1'
const SOURCE_PROJECT_NEW_ID = 'c0200000-0000-4000-8000-0000000000c2'
const SOURCE_TIMESHEET_A = 'c0200000-0000-4000-8000-0000000000d1'
const SOURCE_TIMESHEET_B = 'c0200000-0000-4000-8000-0000000000d2'
const COLLIDING_TIMESHEET_ID = 'c0200000-0000-4000-8000-0000000000d3'
const LATER_TIMESHEET_ID = 'c0200000-0000-4000-8000-0000000000d4'
const DESTINATION_TIMESHEET_ID = 'c0200000-0000-4000-8000-0000000000e0'

const RUN_IDS = [RUN_ID, 'c02-run-0002', 'c02-run-0003', 'c02-run-0004', 'c02-run-rollback']
const FIXTURE_PROFILE_IDS = [EXISTING_ID, SOURCE_MATCH_ID, SOURCE_NEW_ID]
const FIXTURE_PROJECT_IDS = [DESTINATION_PROJECT_ID, SOURCE_PROJECT_MATCH_ID, SOURCE_PROJECT_NEW_ID]
const FIXTURE_TIMESHEET_IDS = [
  DESTINATION_TIMESHEET_ID,
  SOURCE_TIMESHEET_A,
  SOURCE_TIMESHEET_B,
  COLLIDING_TIMESHEET_ID,
  LATER_TIMESHEET_ID,
]

let workspace = ''
const createdAuthUsers: string[] = []
const createdReceiptRuns: string[] = []

/**
 * Remove every fixture this suite can create, in dependency-safe order, so an
 * interrupted previous run cannot make the next one fail.
 */
async function resetDestinationFixtures(): Promise<void> {
  const seedAdmin = createClient(
    process.env.MIGRATION_TEST_SUPABASE_AUTH_URL as string,
    process.env.MIGRATION_TEST_SUPABASE_SERVICE_KEY as string,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
  const sourceSession = readSession(process.env.MIGRATION_TEST_NATIVE_SOURCE_URL as string, 'native', 'source')
  let sourceNamespace = ''
  try {
    sourceNamespace = (await sourceSession.identity()).namespace
  } finally {
    await sourceSession.close()
  }
  const listed = await seedAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 })
  for (const user of listed.data.users) {
    const email = (user.email ?? '').toLowerCase()
    if (email === EXISTING_EMAIL || email === 'brand.new@c02.test') {
      await seedAdmin.auth.admin.deleteUser(user.id).catch(() => undefined)
    }
  }
  await withClient(process.env.MIGRATION_TEST_SUPABASE_DB_URL as string, async (client) => {
    await client.query('delete from public.migration_record_map where run_id = any($1) or source_namespace = $2', [
      RUN_IDS,
      sourceNamespace,
    ])
    await client.query(
      'delete from public.migration_record_dispositions where run_id = any($1) or source_namespace = $2',
      [RUN_IDS, sourceNamespace]
    )
    await client.query('delete from public.migration_retry_history where run_id = any($1) or source_namespace = $2', [
      RUN_IDS,
      sourceNamespace,
    ])
    await client.query('delete from public.migration_runs where run_id = any($1)', [RUN_IDS])
    await client.query('delete from public.timesheets where id = any($1)', [FIXTURE_TIMESHEET_IDS])
    await client.query('delete from public.projects where id = any($1)', [FIXTURE_PROJECT_IDS])
    await client.query('delete from public.profiles where id = any($1)', [FIXTURE_PROFILE_IDS])
    await client.query('delete from public.whitelisted_domains where domain = $1', ['c02.test'])
  })
}

function env(): Record<string, string | undefined> {
  return process.env
}

function cliDependencies(extra: Record<string, unknown> = {}) {
  const out: string[] = []
  const err: string[] = []
  return {
    captured: { out, err },
    deps: {
      env: env(),
      runRoot: join(workspace, 'runs'),
      out: (line: string) => out.push(line),
      err: (line: string) => err.push(line),
      ...extra,
    },
  }
}

async function withClient<T>(url: string, fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: url })
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end()
  }
}

async function resetNativeDatabase(adminUrl: string, url: string): Promise<void> {
  const database = parsePostgresUrl(url).database
  if (!DISPOSABLE_DB_PATTERN.test(database)) {
    throw new Error(`Refusing to reset a non-disposable database: ${database}`)
  }
  await withClient(adminUrl, async (client) => {
    await client.query(
      `select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()`,
      [database]
    )
    await client.query(`drop database if exists "${database}"`)
    await client.query(`create database "${database}"`)
  })
  // The migration runner holds its advisory-lock connection while applying
  // each migration on a second connection, so the pool needs at least two.
  const pool = new Pool({ connectionString: url, max: 2 })
  try {
    await runMigrations(pool)
  } finally {
    await pool.end()
  }
}

function readSession(url: string, provider: 'native' | 'supabase', role: 'source' | 'destination') {
  return openReadOnlySession({
    provider,
    role,
    envName: 'MIGRATION_TEST',
    connectionString: url,
    displayTarget: 'test',
    loopback: true,
    projectRef: null,
    applicationName: `vsis-migration-test-${role}`,
  })
}

function writeSession(url: string, provider: 'native' | 'supabase') {
  return openWriteSession({
    provider,
    role: 'destination',
    envName: 'MIGRATION_TEST',
    connectionString: url,
    displayTarget: 'test',
    loopback: true,
    projectRef: null,
    applicationName: 'vsis-migration-test-writer',
  })
}

async function supabaseAdmin() {
  const target = resolveAuthTarget({
    role: 'destination',
    urlEnvName: 'MIGRATION_TEST_SUPABASE_AUTH_URL',
    keyEnvName: 'MIGRATION_TEST_SUPABASE_SERVICE_KEY',
    env: env(),
  })
  return createSupabaseAuthAdmin(target)
}

async function supabasePasswordSignIn(email: string, password: string): Promise<{ ok: boolean; error: string | null }> {
  const client = createClient(
    process.env.MIGRATION_TEST_SUPABASE_AUTH_URL as string,
    process.env.MIGRATION_TEST_SUPABASE_ANON_KEY as string,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
  const { error } = await client.auth.signInWithPassword({ email, password })
  return { ok: !error, error: error?.message ?? null }
}

suite('C02 migration round trip (live, disposable)', () => {
  beforeAll(async () => {
    workspace = mkdtempSync(join(tmpdir(), 'vsis-c02-'))
    const adminUrl = process.env.MIGRATION_TEST_NATIVE_ADMIN_URL as string
    await resetNativeDatabase(adminUrl, process.env.MIGRATION_TEST_NATIVE_SOURCE_URL as string)
    await resetNativeDatabase(adminUrl, process.env.MIGRATION_TEST_NATIVE_TARGET_URL as string)
    await resetDestinationFixtures()

    // --- source (native): two accounts, two projects, equal-looking timesheets ---
    const sourcePasswordHash = await hashPassword('native-source-passw0rd!')
    await withClient(process.env.MIGRATION_TEST_NATIVE_SOURCE_URL as string, async (client) => {
      await client.query(
        `insert into public.profiles (id, email, name, department, title, role, permission_role, hierarchy_role, is_active, password_hash)
         values ($1,$2,'Existing Person','Engineering','Engineer','user','user','engineer',true,$3),
                ($4,'brand.new@c02.test','Brand New','Engineering','Engineer','user','user','engineer',true,$3)`,
        [SOURCE_MATCH_ID, EXISTING_EMAIL, sourcePasswordHash, SOURCE_NEW_ID]
      )
      await client.query(
        `insert into public.projects (id, name, so_number, telegram_no) values
           ($1,'C02 Shared Project','SO-C02-1',9401),
           ($2,'C02 Source Only Project','SO-C02-2',9402)`,
        [SOURCE_PROJECT_MATCH_ID, SOURCE_PROJECT_NEW_ID]
      )
      await client.query(
        `insert into public.timesheets (id, user_id, project_id, log_date, hours_worked, work_done) values
           ($1,$2,$3,'2026-09-10','7.50','Equal value entry A'),
           ($4,$2,$3,'2026-09-11','7.50','Equal value entry A'),
           ($5,$2,$6,'2026-09-12','7.50','Colliding id entry')`,
        [SOURCE_TIMESHEET_A, SOURCE_MATCH_ID, SOURCE_PROJECT_MATCH_ID, SOURCE_TIMESHEET_B, COLLIDING_TIMESHEET_ID, SOURCE_PROJECT_NEW_ID]
      )
    })

    // --- destination (Supabase): existing account + destination-only data ---
    // Seeding uses the provider SDK directly: the migration port deliberately
    // cannot set passwords, so the known-credential account is created outside it.
    const seedAdmin = createClient(
      process.env.MIGRATION_TEST_SUPABASE_AUTH_URL as string,
      process.env.MIGRATION_TEST_SUPABASE_SERVICE_KEY as string,
      { auth: { persistSession: false, autoRefreshToken: false } }
    )
    await withClient(process.env.MIGRATION_TEST_SUPABASE_DB_URL as string, async (client) => {
      await client.query(
        `insert into public.whitelisted_domains (domain, auto_activate) values ('c02.test', false)
         on conflict (domain) do nothing`
      )
    })
    const seeded = await seedAdmin.auth.admin.createUser({
      id: EXISTING_ID,
      email: EXISTING_EMAIL,
      password: EXISTING_PASSWORD,
      email_confirm: true,
    })
    if (seeded.error || !seeded.data.user) {
      throw new Error(`Could not seed the destination account: ${seeded.error?.message ?? 'unknown error'}`)
    }
    createdAuthUsers.push(seeded.data.user.id)
    await withClient(process.env.MIGRATION_TEST_SUPABASE_DB_URL as string, async (client) => {
      await client.query(
        `update public.profiles set department='Engineering', title='Engineer', permission_role='user',
           hierarchy_role='engineer', is_active=true where id = $1`,
        [EXISTING_ID]
      )
      await client.query(
        `insert into public.projects (id, name, so_number, telegram_no) values ($1,'C02 Shared Project','SO-C02-1',9401)`,
        [DESTINATION_PROJECT_ID]
      )
      await client.query(
        `insert into public.timesheets (id, user_id, project_id, log_date, hours_worked, work_done) values
           ($1,$2,$3,'2026-09-01','8.00','Destination-only entry'),
           ($4,$2,$3,'2026-09-15','4.00','Destination row holding the colliding id')`,
        [DESTINATION_TIMESHEET_ID, EXISTING_ID, DESTINATION_PROJECT_ID, COLLIDING_TIMESHEET_ID]
      )
    })
    // The password proof must work before the migration touches anything.
    expect(await supabasePasswordSignIn(EXISTING_EMAIL, EXISTING_PASSWORD)).toEqual({ ok: true, error: null })

    // Fence both destinations for the migration window (C06A/C06B): apply
    // refuses to run against an open gate, and every application write path
    // refuses while the gate is closed. Fixture seeding above used SQL directly,
    // exactly as an operator's pre-fence preparation does.
    for (const [target, envName] of [
      ['supabase', 'MIGRATION_TEST_SUPABASE_DB_URL'],
      ['native', 'MIGRATION_TEST_NATIVE_TARGET_URL'],
    ] as const) {
      const gateRunId = target === 'supabase' ? RUN_ID : 'c02-run-0004'
      const fence = cliDependencies()
      const code = await runCli(
        [
          'gate',
          '--target',
          target,
          '--target-env',
          envName,
          '--state',
          'fenced',
          '--run-id',
          gateRunId,
          '--reason',
          'C02 live run: fenced for the final planning/apply window',
          '--actor',
          'c02-test-operator',
          '--json',
        ],
        fence.deps
      )
      expect(`${target}:${code}`).toBe(`${target}:0`)
    }
  }, 180_000)

  afterAll(async () => {
    if (process.env.MIGRATION_TEST_KEEP === '1') return
    try {
      const admin = await supabaseAdmin()
      const session = writeSession(process.env.MIGRATION_TEST_SUPABASE_DB_URL as string, 'supabase')
      try {
        // Remove exactly what this suite created, dependents first.
        const mapped = await session.query<{ entity: MigrationEntity; destination_id: string }>(
          'select entity, destination_id from public.migration_record_map where run_id = any($1)',
          [createdReceiptRuns]
        )
        for (const entity of [...ENTITY_ORDER].reverse()) {
          const ids = mapped.filter((row) => row.entity === entity).map((row) => row.destination_id)
          if (ids.length === 0) continue
          await session
            .transaction(async (tx) => {
              await tx.query(`delete from public.${entity} where id = any($1)`, [ids])
            })
            .catch(() => undefined)
        }
        for (const runId of createdReceiptRuns) {
          await cleanupRunIdentities({ runId, session, auth: admin }).catch(() => undefined)
        }
      } finally {
        await session.close()
      }
      // Complete the publication sequence on the shared local destination:
      // record the intent, then admit writers (which opens the gate). An
      // abandoned run would deliberately stay fenced (C06B rollback), but this
      // suite finishes cleanly, so leaving the deployment closed would break
      // everything after it. The receipt must still exist here, so publication
      // runs before the fixture cleanup below removes the run rows.
      const publish = cliDependencies()
      for (const phase of ['intent', 'admit'] as const) {
        const code = await runCli(
          [
            'publish',
            '--target',
            'supabase',
            '--target-env',
            'MIGRATION_TEST_SUPABASE_DB_URL',
            '--run-id',
            RUN_ID,
            '--phase',
            phase,
            '--reason',
            'C02 live run complete: publishing the merged destination',
            '--actor',
            'c02-test-operator',
            '--json',
          ],
          publish.deps
        )
        // Asserted, not swallowed: a publish that fails here would leave the
        // shared destination fenced for every later suite.
        expect(`${phase}:${code}`).toBe(`${phase}:0`)
      }
      await resetDestinationFixtures()
      const gateState = await withClient(process.env.MIGRATION_TEST_SUPABASE_DB_URL as string, async (client) => {
        const result = await client.query<{ state: string }>('select state from public.migration_write_gate')
        return result.rows[0]?.state ?? 'missing'
      })
      if (gateState !== 'open') {
        throw new Error(`The publication sequence did not reopen the destination gate (state=${gateState}).`)
      }
      for (const userId of createdAuthUsers) await admin.deleteUser(userId).catch(() => undefined)

      const adminUrl = process.env.MIGRATION_TEST_NATIVE_ADMIN_URL as string
      await withClient(adminUrl, async (client) => {
        for (const name of [
          parsePostgresUrl(process.env.MIGRATION_TEST_NATIVE_SOURCE_URL as string).database,
          parsePostgresUrl(process.env.MIGRATION_TEST_NATIVE_TARGET_URL as string).database,
        ]) {
          await client.query(
            `select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()`,
            [name]
          )
          await client.query(`drop database if exists "${name}"`)
        }
      })
    } finally {
      rmSync(workspace, { recursive: true, force: true })
    }
  }, 180_000)

  it('exports the native source and applies the reviewed merge into Supabase', async () => {
    const bundleDir = join(workspace, 'bundle-a')
    const planPath = join(workspace, 'plan-a.json')
    const resolvedPath = join(workspace, 'resolved-a.json')

    // --- export (read-only source) ---
    const exported = cliDependencies()
    const exportCode = await runCli(
      [
        'export',
        '--source',
        'native',
        '--source-env',
        'MIGRATION_TEST_NATIVE_SOURCE_URL',
        '--out',
        bundleDir,
        '--app-version',
        '1.0.3',
        '--run-id',
        RUN_ID,
        '--json',
      ],
      exported.deps
    )
    expect(exported.captured.err.join('\n')).toBe('')
    expect(exportCode).toBe(0)

    // The export captures the source's assurance facts, so an OAuth or MFA
    // source account can never be silently re-created as a password account.
    const inventory = readJson<{ identities: Array<{ id: string; hasCredential: boolean | null }> }>(
      join(bundleDir, 'identities.json')
    )
    expect(inventory.identities.map((entry) => entry.id)).toEqual([SOURCE_MATCH_ID, SOURCE_NEW_ID])
    expect(inventory.identities.every((entry) => entry.hasCredential === true)).toBe(true)

    // --- plan against the populated Supabase destination ---
    const planned = cliDependencies()
    const planCode = await runCli(
      [
        'plan',
        '--bundle',
        bundleDir,
        '--target',
        'supabase',
        '--target-env',
        'MIGRATION_TEST_SUPABASE_DB_URL',
        '--auth-url-env',
        'MIGRATION_TEST_SUPABASE_AUTH_URL',
        '--auth-service-key-env',
        'MIGRATION_TEST_SUPABASE_SERVICE_KEY',
        '--target-app-version',
        '1.0.3',
        '--operator',
        'c02-test',
        '--out',
        planPath,
        '--json',
      ],
      planned.deps
    )
    expect(planned.captured.err.join('\n')).toBe('')
    expect(planCode).toBe(0)

    const plan = readJson<{
      unresolved: Array<{ entity: string; sourceId: string; kind: string; destinationId: string | null }>
      counts: Record<string, { create: number; map: number; retain: number; unresolved: number }>
      planDigest: string
    }>(planPath)
    const kinds = plan.unresolved.map((conflict) => conflict.kind)
    expect(kinds).toContain('account-candidate') // existing email, different id
    expect(kinds).toContain('reference-candidate') // shared project name
    expect(kinds).toContain('uuid-collision') // colliding timesheet id
    expect(plan.counts.timesheets.create).toBe(2) // the equal-looking pair
    expect(plan.counts.timesheets.retain).toBe(1) // the destination-only entry

    // --- resolve: one reviewed decision per conflict ---
    const decisions = {
      format: 'vsis-data-migration-resolutions',
      formatVersion: 1,
      planDigest: plan.planDigest,
      operator: { name: 'c02-test', at: '2026-09-19T10:00:00.000000Z' },
      decisions: plan.unresolved.map((conflict) => {
        if (conflict.entity === 'app_settings') {
          return {
            entity: conflict.entity,
            sourceId: conflict.sourceId,
            action: 'map',
            destinationId: conflict.destinationId ?? '1',
            reason: 'reviewed: keep the destination workspace settings unchanged',
          }
        }
        if (conflict.entity === 'profiles') {
          return {
            entity: conflict.entity,
            sourceId: conflict.sourceId,
            action: 'map',
            destinationId: conflict.destinationId ?? EXISTING_ID,
            reason: 'reviewed: same person, destination identity and credentials survive',
          }
        }
        if (conflict.kind === 'reference-candidate') {
          return {
            entity: conflict.entity,
            sourceId: conflict.sourceId,
            action: 'map',
            destinationId: conflict.destinationId,
            reason: 'reviewed: same project',
          }
        }
        return {
          entity: conflict.entity,
          sourceId: conflict.sourceId,
          action: 'create',
          reason: 'reviewed: distinct record reusing a UUID',
        }
      }),
    }
    writeFileSync(join(workspace, 'decisions-a.json'), JSON.stringify(decisions, null, 2))

    const resolved = cliDependencies()
    const resolveCode = await runCli(
      [
        'resolve',
        '--plan',
        planPath,
        '--decisions',
        join(workspace, 'decisions-a.json'),
        '--out',
        resolvedPath,
        '--json',
      ],
      resolved.deps
    )
    expect(resolved.captured.err.join('\n')).toBe('')
    expect(resolveCode).toBe(0)

    // --- apply: one transaction on the destination ---
    const applied = cliDependencies()
    const applyCode = await runCli(
      [
        'apply',
        '--target',
        'supabase',
        '--target-env',
        'MIGRATION_TEST_SUPABASE_DB_URL',
        '--auth-url-env',
        'MIGRATION_TEST_SUPABASE_AUTH_URL',
        '--auth-service-key-env',
        'MIGRATION_TEST_SUPABASE_SERVICE_KEY',
        '--plan',
        resolvedPath,
        '--expect-plan-digest',
        plan.planDigest,
        '--run-id',
        RUN_ID,
        '--json',
      ],
      applied.deps
    )
    expect(applied.captured.err.join('\n')).toBe('')
    expect(applyCode).toBe(0)
    createdReceiptRuns.push(RUN_ID)

    const applyResult = JSON.parse(applied.captured.out.join('\n')) as {
      status: string
      counts: Record<string, number>
      identityDispositions: {
        counts: Record<string, number>
        enrollments: Record<string, number>
        provisioned: string[]
        historical: string[]
      } | null
    }
    expect(applyResult.status).toBe('committed')
    expect(applyResult.counts.created).toBeGreaterThan(0)

    // Enrolment status is recorded separately from the data import: one matched
    // account keeps its credential, the approved new account enrolls on the
    // destination, and nothing else is touched.
    expect(applyResult.identityDispositions?.counts).toMatchObject({ mapped: 1, provision: 1, historical: 0 })
    expect(applyResult.identityDispositions?.enrollments).toMatchObject({
      'existing-account': 1,
      'enroll-on-destination': 1,
    })
    expect(applyResult.identityDispositions?.provisioned).toEqual([SOURCE_NEW_ID])
    expect(applyResult.identityDispositions?.historical).toEqual([])

    // --- the approved merged result is what the destination now holds ---
    const verified = cliDependencies()
    const verifyCode = await runCli(
      [
        'verify',
        '--target',
        'supabase',
        '--target-env',
        'MIGRATION_TEST_SUPABASE_DB_URL',
        '--plan',
        resolvedPath,
        '--run-id',
        RUN_ID,
        // Recording makes completion durable and is what publication intent
        // requires; without it this run could never be published.
        '--record',
        '--actor',
        'c02-test-operator',
        '--reason',
        'C02 live run: merged result reconciled',
        '--json',
      ],
      verified.deps
    )
    expect(`${verifyCode}:${verified.captured.err.join('|')}`).toBe('0:')
    const verifyResult = JSON.parse(verified.captured.out.join('\n')) as {
      ok: boolean
      recorded?: boolean
      state?: string
    }
    expect(verifyResult.ok).toBe(true)
    expect(verifyResult.recorded).toBe(true)
    expect(verifyResult.state).toBe('verified')
  }, 300_000)

  it('keeps destination identities, credentials and destination-only rows intact', async () => {
    const session = readSession(process.env.MIGRATION_TEST_SUPABASE_DB_URL as string, 'supabase', 'destination')
    try {
      const snapshot = await readDeploymentSnapshot(session)
      const existing = snapshot.rows.profiles.find((row) => String(row.email) === EXISTING_EMAIL)
      expect(existing?.id).toBe(EXISTING_ID)
      const destinationOnly = snapshot.rows.timesheets.find((row) => String(row.id) === DESTINATION_TIMESHEET_ID)
      expect(destinationOnly?.work_done).toBe('Destination-only entry')
      const newAccount = snapshot.rows.profiles.find((row) => String(row.email) === 'brand.new@c02.test')
      expect(newAccount).toBeDefined()
      // imported timesheets reference the mapped destination ids
      const imported = snapshot.rows.timesheets.find((row) => String(row.id) === SOURCE_TIMESHEET_A)
      expect(imported?.user_id).toBe(EXISTING_ID)
      expect(imported?.project_id).toBe(DESTINATION_PROJECT_ID)
      // the colliding id was reallocated for the incoming record; the
      // destination row that already owned that id is untouched
      const destinationRow = snapshot.rows.timesheets.find((row) => String(row.id) === COLLIDING_TIMESHEET_ID)
      expect(destinationRow?.work_done).toBe('Destination row holding the colliding id')
      const importedCollidingEntry = snapshot.rows.timesheets.find(
        (row) => String(row.work_done) === 'Colliding id entry'
      )
      expect(importedCollidingEntry).toBeDefined()
      expect(importedCollidingEntry?.id).not.toBe(COLLIDING_TIMESHEET_ID)
    } finally {
      await session.close()
    }

    // Existing credentials still work, and the new account can enroll.
    expect(await supabasePasswordSignIn(EXISTING_EMAIL, EXISTING_PASSWORD)).toEqual({ ok: true, error: null })
    const admin = await supabaseAdmin()
    const users = await admin.findUserByEmail('brand.new@c02.test')
    expect(users).not.toBeNull()
    if (users) createdAuthUsers.push(users.id)
    const ownership = await withClient(process.env.MIGRATION_TEST_SUPABASE_DB_URL as string, async (client) =>
      client.query<{ run_id: string | null }>(
        "select raw_app_meta_data ->> 'vsis_migration_run_id' as run_id from auth.users where id = $1::uuid",
        [users?.id]
      )
    )
    expect(ownership.rows[0]?.run_id).toBe(RUN_ID)
    const failedSignIn = await supabasePasswordSignIn('brand.new@c02.test', 'never-set-by-the-migration')
    expect(failedSignIn.ok).toBe(false)

    // The legacy `role` column is maintained by the destination's own trigger,
    // so an imported profile cannot carry a role that disagrees with its
    // permission/hierarchy axes. The whitelist gate stays a destination
    // decision: the reviewed active state is applied, nothing is auto-activated.
    const triggerState = await withClient(process.env.MIGRATION_TEST_SUPABASE_DB_URL as string, async (client) =>
      client.query<{ email: string; role: string; permission_role: string; hierarchy_role: string; is_active: boolean }>(
        `select email, role, permission_role, hierarchy_role, is_active
           from public.profiles where email = any($1::text[]) order by email`,
        [['c02-existing@c02.test', 'brand.new@c02.test']]
      )
    )
    expect(triggerState.rows).toHaveLength(2)
    for (const row of triggerState.rows) {
      const expectedLegacyRole =
        row.permission_role === 'admin'
          ? 'admin'
          : row.permission_role === 'pm'
            ? 'pm'
            : row.permission_role === 'co'
              ? 'co'
              : row.hierarchy_role === 'manager'
                ? 'manager'
                : row.hierarchy_role === 'team_lead'
                  ? 'team_lead'
                  : 'user'
      expect(`${row.email}:${row.role}`).toBe(`${row.email}:${expectedLegacyRole}`)
    }
    const whitelisted = await withClient(process.env.MIGRATION_TEST_SUPABASE_DB_URL as string, async (client) =>
      client.query<{ domain: string; auto_activate: boolean }>(
        "select domain, auto_activate from public.whitelisted_domains where domain = 'c02.test'"
      )
    )
    expect(whitelisted.rows).toEqual([{ domain: 'c02.test', auto_activate: false }])

    // Exercise destination enrollment without sending mail: the disposable
    // Auth service issues a recovery link, which the new user redeems before
    // choosing a destination-only password.
    const service = createClient(
      process.env.MIGRATION_TEST_SUPABASE_AUTH_URL as string,
      process.env.MIGRATION_TEST_SUPABASE_SERVICE_KEY as string,
      { auth: { persistSession: false, autoRefreshToken: false } }
    )
    const { data: link, error: linkError } = await service.auth.admin.generateLink({
      type: 'recovery',
      email: 'brand.new@c02.test',
    })
    expect(linkError).toBeNull()
    if (!link.properties) throw new Error('Disposable Auth did not return a recovery link')
    const enrollment = createClient(
      process.env.MIGRATION_TEST_SUPABASE_AUTH_URL as string,
      process.env.MIGRATION_TEST_SUPABASE_ANON_KEY as string,
      { auth: { persistSession: false, autoRefreshToken: false } }
    )
    const { data: recovered, error: recoveryError } = await enrollment.auth.verifyOtp({
      type: 'recovery',
      token_hash: link.properties.hashed_token,
    })
    expect(recoveryError).toBeNull()
    expect(recovered.user?.id).toBe(users?.id)
    const enrolledPassword = 'C02-destination-enrolled-passw0rd!'
    const { error: updateError } = await enrollment.auth.updateUser({ password: enrolledPassword })
    expect(updateError).toBeNull()
    expect(await supabasePasswordSignIn('brand.new@c02.test', enrolledPassword)).toEqual({ ok: true, error: null })
  }, 120_000)

  it('treats a repeat of the completed run as a no-op without overwriting later edits', async () => {
    // A user edits a merged row after the migration. Re-running the completed
    // run must neither apply updates again nor reconcile this edit away.
    const edits = await withClient(process.env.MIGRATION_TEST_SUPABASE_DB_URL as string, async (client) =>
      client.query<{ id: string; work_done: string }>(
        `update public.timesheets set work_done = 'Edited after the migration'
           where work_done = 'Equal value entry A' returning id::text as id, work_done`
      )
    )
    try {
      expect(edits.rowCount).toBeGreaterThan(0)
      const editedId = edits.rows[0].id

      const applied = cliDependencies()
      const code = await runCli(
        [
          'apply',
          '--target',
          'supabase',
          '--target-env',
          'MIGRATION_TEST_SUPABASE_DB_URL',
          '--auth-url-env',
          'MIGRATION_TEST_SUPABASE_AUTH_URL',
          '--auth-service-key-env',
          'MIGRATION_TEST_SUPABASE_SERVICE_KEY',
          '--plan',
          join(workspace, 'resolved-a.json'),
          '--expect-plan-digest',
          readJson<{ planDigest: string }>(join(workspace, 'plan-a.json')).planDigest,
          '--run-id',
          RUN_ID,
          '--json',
        ],
        applied.deps
      )
      const result = JSON.parse(applied.captured.out.join('\n')) as {
        status: string
        issues: Array<{ code: string; message: string }>
        rowDriftIssues?: Array<{ code: string; message: string }>
      }
      // A verified receipt replays read-only: later edits are reported as
      // drift, not overwritten or mistaken for a failed import.
      expect(code).toBe(EXIT_CODES.OK)
      expect(result.status).toBe('no-op')
      expect(result.issues).toEqual([])
      expect(result.rowDriftIssues?.length).toBeGreaterThan(0)

      const survivors = await withClient(process.env.MIGRATION_TEST_SUPABASE_DB_URL as string, async (client) =>
        client.query<{ id: string; work_done: string }>(
          'select id::text as id, work_done from public.timesheets where id = $1::uuid',
          [editedId]
        )
      )
      expect(survivors.rows).toEqual([{ id: editedId, work_done: 'Edited after the migration' }])
    } finally {
      // Put the fixture back even if an assertion failed: the update matched
      // every equal-looking row, and later cases in this suite import and count
      // that text. Leaving it edited would poison the rest of the run.
      await withClient(process.env.MIGRATION_TEST_SUPABASE_DB_URL as string, async (client) => {
        await client.query(
          "update public.timesheets set work_done = 'Equal value entry A' where id = any($1::uuid[])",
          [edits.rows.map((row) => row.id)]
        )
      })
    }
  }, 120_000)

  it('maps a later source change against the destination receipts instead of recreating records', async () => {
    await withClient(process.env.MIGRATION_TEST_NATIVE_SOURCE_URL as string, async (client) => {
      await client.query(
        `insert into public.timesheets (id, user_id, project_id, log_date, hours_worked, work_done)
         values ($1,$2,$3,'2026-09-13','6.00','Later entry')`,
        [LATER_TIMESHEET_ID, SOURCE_MATCH_ID, SOURCE_PROJECT_MATCH_ID]
      )
    })

    const bundleDir = join(workspace, 'bundle-b')
    const planPath = join(workspace, 'plan-b.json')
    const runB = 'c02-run-0002'
    const exported = cliDependencies()
    expect(
      await runCli(
        ['export', '--source', 'native', '--source-env', 'MIGRATION_TEST_NATIVE_SOURCE_URL', '--out', bundleDir, '--app-version', '1.0.3', '--run-id', runB, '--json'],
        exported.deps
      )
    ).toBe(0)

    const planned = cliDependencies()
    expect(
      await runCli(
        [
          'plan', '--bundle', bundleDir, '--target', 'supabase', '--target-env', 'MIGRATION_TEST_SUPABASE_DB_URL',
          '--auth-url-env', 'MIGRATION_TEST_SUPABASE_AUTH_URL', '--auth-service-key-env', 'MIGRATION_TEST_SUPABASE_SERVICE_KEY',
          '--target-app-version', '1.0.3', '--out', planPath, '--json',
        ],
        planned.deps
      )
    ).toBe(0)

    const plan = readJson<{
      counts: Record<string, { create: number; map: number; unresolved: number }>
      unresolved: Array<{ kind: string }>
    }>(planPath)
    // Previously imported work records are mapped through the stored provenance.
    expect(plan.counts.timesheets.create).toBe(1)
    expect(plan.counts.timesheets.map).toBeGreaterThanOrEqual(2)
  }, 300_000)

  it('re-exports the destination and reverses without duplicating records', async () => {
    const bundleDir = join(workspace, 'bundle-c')
    const planPath = join(workspace, 'plan-c.json')
    const runC = 'c02-run-0003'
    const exported = cliDependencies()
    const code = await runCli(
      ['export', '--source', 'supabase', '--source-env', 'MIGRATION_TEST_SUPABASE_DB_URL', '--out', bundleDir, '--app-version', '1.0.3', '--run-id', runC, '--json'],
      exported.deps
    )
    expect(exported.captured.err.join('\n')).toBe('')
    expect(code).toBe(0)

    const planned = cliDependencies()
    const planCode = await runCli(
      [
        'plan', '--bundle', bundleDir, '--target', 'native', '--target-env', 'MIGRATION_TEST_NATIVE_SOURCE_URL',
        '--target-app-version', '1.0.3', '--out', planPath, '--json',
      ],
      planned.deps
    )
    expect(planned.captured.err.join('\n')).toBe('')
    expect(planCode).toBe(0)

    const plan = readJson<{
      planDigest: string
      counts: Record<string, { create: number; map: number; unresolved: number }>
      unresolved: Array<{
        entity: string
        sourceId: string
        destinationId: string | null
        kind: string
        evidence: string[]
        allowedActions: string[]
      }>
    }>(planPath)
    // A bundle alias without a destination receipt is a review item, never an
    // automatic mapping: previously imported records must not be recreated, but
    // they are also not linked without an explicit decision.
    expect(plan.counts.timesheets.create).toBe(1)
    const reviewedTimesheets = plan.unresolved.filter((conflict) => conflict.entity === 'timesheets')
    expect(reviewedTimesheets.length).toBeGreaterThanOrEqual(3)
    expect(reviewedTimesheets.some((conflict) => conflict.evidence.includes('untrusted-provenance'))).toBe(true)
    expect(reviewedTimesheets.every((conflict) => conflict.destinationId !== null)).toBe(true)

    // Reviewing those conflicts maps the records back onto the native rows
    // instead of duplicating them.
    const decisions = {
      format: 'vsis-data-migration-resolutions',
      formatVersion: 1,
      planDigest: plan.planDigest,
      operator: { name: 'c02-test', at: '2026-09-19T10:00:00.000000Z' },
      decisions: plan.unresolved.map((conflict) => {
        const action = conflict.allowedActions.includes('map') ? 'map' : conflict.allowedActions[0]
        return {
          entity: conflict.entity,
          sourceId: conflict.sourceId,
          action,
          ...(action === 'map' && conflict.destinationId ? { destinationId: conflict.destinationId } : {}),
          reason:
            action === 'map'
              ? 'reviewed: provenance matches the record this instance originally exported'
              : 'reviewed: the destination row is already claimed by another source record, so this one is excluded',
        }
      }),
    }
    writeFileSync(join(workspace, 'decisions-c.json'), JSON.stringify(decisions, null, 2))
    const resolvedPath = join(workspace, 'resolved-c.json')
    const resolved = cliDependencies()
    const resolveCode = await runCli(
      ['resolve', '--plan', planPath, '--decisions', join(workspace, 'decisions-c.json'), '--out', resolvedPath, '--json'],
      resolved.deps
    )
    expect(`${resolveCode}:${resolved.captured.err.join('|')}`).toBe('0:')
    const resolvedPlan = readJson<{
      expectedResult: { timesheets: Array<Record<string, unknown>> }
      entries: Array<{ entity: string; sourceId: string | null; action: string }>
    }>(resolvedPath)
    const nativeRowIds = new Set([SOURCE_TIMESHEET_A, SOURCE_TIMESHEET_B, COLLIDING_TIMESHEET_ID, LATER_TIMESHEET_ID])
    // No source record is created twice, and every pre-existing native row survives.
    const createdTimesheets = resolvedPlan.entries.filter(
      (entry) => entry.entity === 'timesheets' && entry.action === 'create'
    )
    expect(createdTimesheets).toHaveLength(1)
    for (const id of nativeRowIds) {
      expect(resolvedPlan.expectedResult.timesheets.some((row) => String(row.id) === id)).toBe(true)
    }

    // Apply the reverse direction into the empty native target: the plan must be
    // reviewed against that destination (applying a plan reviewed for another
    // destination is refused), and no credentials are fabricated.
    const emptyTargetPlan = join(workspace, 'plan-c-target.json')
    const emptyTargetResolved = join(workspace, 'resolved-c-target.json')
    const plannedEmpty = cliDependencies()
    const emptyPlanCode = await runCli(
      [
        'plan', '--bundle', bundleDir, '--target', 'native', '--target-env', 'MIGRATION_TEST_NATIVE_TARGET_URL',
        '--target-app-version', '1.0.3', '--out', emptyTargetPlan, '--json',
      ],
      plannedEmpty.deps
    )
    expect(`${emptyPlanCode}:${plannedEmpty.captured.err.join('|')}`).toBe('0:')
    const emptyPlan = readJson<{
      planDigest: string
      unresolved: Array<{ entity: string; sourceId: string; destinationId: string | null; kind: string }>
    }>(emptyTargetPlan)
    // Both providers bootstrap the same reference data, so even a "fresh"
    // native target presents name collisions that must be reviewed, never
    // silently coalesced.
    expect(emptyPlan.unresolved.length).toBeGreaterThan(0)
    expect(emptyPlan.unresolved.every((conflict) => conflict.destinationId !== null)).toBe(true)
    const emptyDecisions = join(workspace, 'decisions-c-target.json')
    writeFileSync(
      emptyDecisions,
      JSON.stringify({
        format: 'vsis-data-migration-resolutions',
        formatVersion: 1,
        planDigest: emptyPlan.planDigest,
        operator: { name: 'c02-test', at: '2026-09-19T10:00:00.000000Z' },
        decisions: emptyPlan.unresolved.map((conflict) => ({
          entity: conflict.entity,
          sourceId: conflict.sourceId,
          action: 'map',
          destinationId: conflict.destinationId as string,
          reason: 'reviewed: the destination already bootstraps this reference row',
        })),
      })
    )
    const resolvedEmpty = cliDependencies()
    expect(
      await runCli(
        ['resolve', '--plan', emptyTargetPlan, '--decisions', emptyDecisions, '--out', emptyTargetResolved, '--json'],
        resolvedEmpty.deps
      )
    ).toBe(0)

    const runReverse = 'c02-run-0004'
    const applied = cliDependencies()
    const applyCode = await runCli(
      [
        'apply', '--target', 'native', '--target-env', 'MIGRATION_TEST_NATIVE_TARGET_URL',
        '--plan', emptyTargetResolved, '--expect-plan-digest', emptyPlan.planDigest, '--run-id', runReverse, '--json',
      ],
      applied.deps
    )
    expect(`${applyCode}:${applied.captured.err.join('|')}`).toBe('0:')
    createdReceiptRuns.push(runReverse)
    const verified = cliDependencies()
    const verifyCode = await runCli(
      [
        'verify', '--target', 'native', '--target-env', 'MIGRATION_TEST_NATIVE_TARGET_URL',
        '--plan', emptyTargetResolved, '--run-id', runReverse, '--json',
      ],
      verified.deps
    )
    expect(`${verifyCode}:${verified.captured.err.join('|')}`).toBe('0:')

    const targetClient = new Client({ connectionString: process.env.MIGRATION_TEST_NATIVE_TARGET_URL as string })
    await targetClient.connect()
    try {
      const credentials = await targetClient.query<{ total: string; with_password: string }>(
        'select count(*)::text as total, count(password_hash)::text as with_password from public.profiles'
      )
      expect(Number(credentials.rows[0].total)).toBeGreaterThan(0)
      expect(credentials.rows[0].with_password).toBe('0')
      const imported = await targetClient.query<{ count: string }>(
        'select count(*)::text as count from public.timesheets where id = any($1)',
        [[SOURCE_TIMESHEET_A, SOURCE_TIMESHEET_B, COLLIDING_TIMESHEET_ID]]
      )
      expect(imported.rows[0].count).toBe('3')
      const totalTimesheets = await targetClient.query<{ count: string }>(
        'select count(*)::text as count from public.timesheets'
      )
      // d1, d2, the destination-only entry, the reallocated collision row and
      // the destination row that owned the colliding id.
      expect(totalTimesheets.rows[0].count).toBe('5')
    } finally {
      await targetClient.end()
    }
  }, 300_000)

  it('rolls back every change when a late statement fails mid-merge', async () => {
    const bundleDir = join(workspace, 'bundle-rollback')
    const planPath = join(workspace, 'plan-rollback.json')
    const resolvedPath = join(workspace, 'resolved-rollback.json')
    const runId = 'c02-run-rollback'

    const exported = cliDependencies()
    expect(
      await runCli(
        ['export', '--source', 'native', '--source-env', 'MIGRATION_TEST_NATIVE_SOURCE_URL', '--out', bundleDir, '--app-version', '1.0.3', '--run-id', runId, '--json'],
        exported.deps
      )
    ).toBe(0)

    const planned = cliDependencies()
    expect(
      await runCli(
        [
          'plan', '--bundle', bundleDir, '--target', 'supabase', '--target-env', 'MIGRATION_TEST_SUPABASE_DB_URL',
          '--auth-url-env', 'MIGRATION_TEST_SUPABASE_AUTH_URL', '--auth-service-key-env', 'MIGRATION_TEST_SUPABASE_SERVICE_KEY',
          '--target-app-version', '1.0.3', '--out', planPath, '--json',
        ],
        planned.deps
      )
    ).toBe(0)
    const plan = readJson<{
      planDigest: string
      unresolved: Array<{ entity: string; sourceId: string; destinationId: string | null; kind: string }>
    }>(planPath)

    const decisions = {
      format: 'vsis-data-migration-resolutions',
      formatVersion: 1,
      planDigest: plan.planDigest,
      operator: { name: 'c02-test', at: '2026-09-19T10:00:00.000000Z' },
      decisions: plan.unresolved.map((conflict) => ({
        entity: conflict.entity,
        sourceId: conflict.sourceId,
        action: 'map',
        destinationId: conflict.destinationId as string,
        reason: 'reviewed for the rollback proof',
      })),
    }
    writeFileSync(join(workspace, 'decisions-rollback.json'), JSON.stringify(decisions, null, 2))
    const resolved = cliDependencies()
    expect(
      await runCli(
        [
          'resolve', '--plan', planPath, '--decisions', join(workspace, 'decisions-rollback.json'),
          '--out', resolvedPath, '--json',
        ],
        resolved.deps
      )
    ).toBe(0)

    // Capture the destination's app-data state before the failing apply so the
    // rollback proof can assert rows, not only receipts/mappings.
    const countsBefore = await (async () => {
      const session = writeSession(process.env.MIGRATION_TEST_SUPABASE_DB_URL as string, 'supabase')
      try {
        const counts: Record<string, string> = {}
        for (const entity of ENTITY_ORDER) {
          const rows = await session.query<{ count: string }>(`select count(*)::text as count from public.${entity}`)
          counts[entity] = rows[0]?.count ?? '0'
        }
        return counts
      } finally {
        await session.close()
      }
    })()

    // Inject a failure at the very last statement of the merge: the receipt
    // insert. Every row change and mapping written before it must roll back.
    const applied = cliDependencies({
      openWrite: (target: Parameters<typeof openWriteSession>[0]) => {
        const real = openWriteSession(target)
        return {
          ...real,
          transaction: (fn: Parameters<typeof real.transaction>[0]) =>
            real.transaction((tx) =>
              fn({
                query: async <T extends Record<string, unknown>>(text: string, params?: unknown[]) => {
                  if (/insert into public\.migration_runs/i.test(text)) {
                    throw new Error('injected late failure')
                  }
                  return tx.query<T>(text, params)
                },
              })
            ),
        }
      },
    })
    const code = await runCli(
      [
        'apply', '--target', 'supabase', '--target-env', 'MIGRATION_TEST_SUPABASE_DB_URL',
        '--auth-url-env', 'MIGRATION_TEST_SUPABASE_AUTH_URL', '--auth-service-key-env', 'MIGRATION_TEST_SUPABASE_SERVICE_KEY',
        '--plan', resolvedPath, '--expect-plan-digest', plan.planDigest, '--run-id', runId, '--json',
      ],
      applied.deps
    )
    expect(code).toBe(EXIT_CODES.VALIDATION)
    const result = JSON.parse(applied.captured.out.join('\n')) as { status: string; issues: Array<{ message: string }> }
    expect(result.status).toBe('failed')
    expect(result.issues.map((issue) => issue.message).join(' ')).toContain('injected late failure')

    // Nothing survives: no receipt, no mappings, no provisioned account.
    const session = writeSession(process.env.MIGRATION_TEST_SUPABASE_DB_URL as string, 'supabase')
    try {
      const receipts = await session.query<{ count: string }>(
        'select count(*)::text as count from public.migration_runs where run_id = $1',
        [runId]
      )
      expect(receipts[0]?.count).toBe('0')
      const mappings = await session.query<{ count: string }>(
        'select count(*)::text as count from public.migration_record_map where run_id = $1',
        [runId]
      )
      expect(mappings[0]?.count).toBe('0')
      // The app-data rows themselves are gone: every entity count equals the
      // pre-apply state (both new rows and changes to existing rows rolled back).
      for (const entity of ENTITY_ORDER) {
        const rows = await session.query<{ count: string }>(`select count(*)::text as count from public.${entity}`)
        expect(rows[0]?.count ?? '0', `${entity} must be unchanged after rollback`).toBe(countsBefore[entity])
      }
    } finally {
      await session.close()
    }
    const admin = await supabaseAdmin()
    // The account from the earlier successful run is adopted, not run-created,
    // so cleanup must leave it exactly where it is.
    const adoptedAccount = await admin.findUserByEmail('brand.new@c02.test')
    expect(adoptedAccount).not.toBeNull()
    const journal = await (async () => {
      const session = writeSession(process.env.MIGRATION_TEST_SUPABASE_DB_URL as string, 'supabase')
      try {
        return await session.query<{ action: string }>(
          'select action from public.migration_identity_journal where run_id = $1',
          [runId]
        )
      } finally {
        await session.close()
      }
    })()
    expect(journal.every((row) => row.action === 'adopted')).toBe(true)
  }, 300_000)
})
