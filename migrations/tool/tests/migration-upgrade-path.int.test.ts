// tests/migration-upgrade-path.int.test.ts
// C07: a supported deployed-schema upgrade path, not only a fresh installation.
//
// The test materializes the migration set from an earlier commit, applies it to
// a disposable database, seeds representative rows, and then upgrades with the
// current set. What must hold: only the new migrations run, the seeded rows and
// the pre-existing receipt survive, and the objects the new migrations create
// are present and bootstrapped.
//
// Gate: MIGRATION_TEST_NATIVE_ADMIN_URL + MIGRATION_TEST_NATIVE_UPGRADE_URL
// (disposable database name). MIGRATION_TEST_REQUIRE=1 fails setup when absent.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client, Pool } from 'pg'
import { loadMigrations, runMigrations } from '@/lib/db/migrate'
import { parsePostgresUrl } from '@vsis/migration-tool/connections'

const REQUIRED_ENV = ['MIGRATION_TEST_NATIVE_ADMIN_URL', 'MIGRATION_TEST_NATIVE_UPGRADE_URL'] as const
const missing = REQUIRED_ENV.filter((name) => !process.env[name])
const REQUIRE = process.env.MIGRATION_TEST_REQUIRE === '1'
const ALLOW_REMOTE = process.env.MIGRATION_TEST_ALLOW_REMOTE === '1'
const DISPOSABLE_DB_PATTERN = /^vsis_migration_upgrade_[a-z0-9_]+$/
/** Deployed schema to upgrade from: the release that predates the newest batch. */
const BASE_REF = process.env.MIGRATION_TEST_UPGRADE_BASE_REF || '3964600'
/** Migrations the upgrade is expected to add. */
const EXPECTED_NEW = [
  '0033_migration_write_gate.sql',
  '0034_migration_record_dispositions.sql',
  '0035_migration_retry_history.sql',
  '0036_migration_write_gate_generation.sql',
  '0037_migration_fresh_keys.sql',
  '0038_timesheet_list_sort_index.sql',
  '0039_timesheet_classification.sql',
  '0040_classification_reporting.sql',
  '0041_global_reminder_banner.sql',
]
const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url))

if (missing.length > 0 && REQUIRE) {
  throw new Error(`MIGRATION_TEST_REQUIRE=1 but the upgrade gate is missing: ${missing.join(', ')}.`)
}
if (missing.length === 0) {
  const parsed = parsePostgresUrl(process.env.MIGRATION_TEST_NATIVE_UPGRADE_URL as string)
  if (!ALLOW_REMOTE && !parsed.loopback) throw new Error(`upgrade URL must be loopback: ${parsed.hostname}`)
  if (!DISPOSABLE_DB_PATTERN.test(parsed.database)) {
    throw new Error(`Refusing a non-disposable database: ${parsed.database}`)
  }
}

const suite = missing.length === 0 ? describe : describe.skip
const workspace = mkdtempSync(join(tmpdir(), 'vsis-upgrade-'))

async function withClient<T>(url: string, fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: url })
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end()
  }
}

/**
 * The migration files as they existed at a commit, written to a temporary
 * directory the shared runner can consume.
 */
function migrationsAt(ref: string): string {
  const directory = join(workspace, `at-${ref.replace(/[^a-z0-9]/gi, '')}`)
  mkdirSync(directory, { recursive: true })
  const listing = execFileSync('git', ['ls-tree', '-r', '--name-only', ref, 'db/migrations'], {
    encoding: 'utf8',
  })
  const names = listing.split('\n').map((line) => line.trim()).filter((line) => line.endsWith('.sql'))
  expect(names.length).toBeGreaterThan(0)
  for (const path of names) {
    const sql = execFileSync('git', ['show', `${ref}:${path}`], { encoding: 'utf8' })
    writeFileSync(join(directory, path.replace(/^db\/migrations\//, '')), sql)
  }
  return directory
}

suite('migration upgrade path (live, disposable database)', () => {
  let baseDir = ''
  let headDir = ''

  beforeAll(() => {
    const adminUrl = process.env.MIGRATION_TEST_NATIVE_ADMIN_URL as string
    const url = process.env.MIGRATION_TEST_NATIVE_UPGRADE_URL as string
    const database = parsePostgresUrl(url).database
    return (async () => {
      await withClient(adminUrl, async (client) => {
        await client.query(
          'select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()',
          [database]
        )
        await client.query(`drop database if exists "${database}"`)
        await client.query(`create database "${database}"`)
      })
      baseDir = migrationsAt(BASE_REF)
      // Materialize the current set the same way: the working tree may differ in
      // line endings, and the runner's checksums are byte-exact.
      headDir = migrationsAt('HEAD')
      // New migrations may still be untracked while this branch is under
      // review. Include only additive working-tree files; preserve the HEAD
      // bytes of already-applied migrations so their checksums remain stable.
      const workingDir = join(REPOSITORY_ROOT, 'db', 'migrations')
      for (const name of readdirSync(workingDir).filter((file) => file.endsWith('.sql'))) {
        const destination = join(headDir, name)
        if (!existsSync(destination)) writeFileSync(destination, readFileSync(join(workingDir, name)))
      }
    })()
  }, 300_000)

  afterAll(async () => {
    rmSync(workspace, { recursive: true, force: true })
    if (process.env.MIGRATION_TEST_KEEP === '1') return
    const adminUrl = process.env.MIGRATION_TEST_NATIVE_ADMIN_URL as string
    const database = parsePostgresUrl(process.env.MIGRATION_TEST_NATIVE_UPGRADE_URL as string).database
    await withClient(adminUrl, async (client) => {
      await client.query(
        'select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()',
        [database]
      )
      await client.query(`drop database if exists "${database}"`)
    })
  }, 180_000)

  it('upgrades a deployed schema without losing data and adds only the new migrations', async () => {
    const url = process.env.MIGRATION_TEST_NATIVE_UPGRADE_URL as string
    const baseMigrations = loadMigrations(baseDir).map((migration) => migration.name)
    const currentMigrations = loadMigrations(headDir).map((migration) => migration.name)
    const pending = currentMigrations.filter((name) => !baseMigrations.includes(name))
    expect(pending.sort()).toEqual([...EXPECTED_NEW].sort())

    const pool = new Pool({ connectionString: url, max: 2 })
    try {
      // 1. Deploy the older schema (a real, supported release).
      const appliedBase = await runMigrations(pool, baseDir)
      expect(appliedBase.sort()).toEqual([...baseMigrations].sort())

      // 2. Seed representative data that must survive the upgrade, including a
      //    durable receipt written under the older schema.
      await withClient(url, async (client) => {
        await client.query(
          `insert into public.projects (name, so_number, telegram_no) values ('Upgrade keeper', 'SO-UP-1', 95001)`
        )
        await client.query(
          `insert into public.profiles (email, name, role, permission_role, hierarchy_role, is_active)
           values ('upgrade@path.test', 'Upgrade Person', 'user', 'user', 'engineer', true)`
        )
        await client.query(
          `insert into public.migration_runs (
             run_id, bundle_id, bundle_digest, plan_digest, resolution_digest, expected_result_digest,
             source_namespace, target_namespace, application_version, schema_fingerprint, state, counts, committed_at
           ) values ('upgrade-run-0001','bundle-upgrade',$1,$2,$3,$4,'native:source','native:target','1.0.2',$5,'data-committed','{}'::jsonb, now())`,
          ['b'.repeat(64), 'p'.repeat(64), 'r'.repeat(64), 'e'.repeat(64), 'f'.repeat(64)]
        )
      })

      // 3. Upgrade with the current set: only the pending migrations run.
      const applied = await runMigrations(pool, headDir)
      expect(applied.sort()).toEqual([...EXPECTED_NEW].sort())

      // 4. The seeded rows and the receipt are untouched.
      await withClient(url, async (client) => {
        const project = await client.query<{ count: string }>(
          "select count(*)::text as count from public.projects where name = 'Upgrade keeper'"
        )
        const profile = await client.query<{ count: string }>(
          "select count(*)::text as count from public.profiles where email = 'upgrade@path.test'"
        )
        const receipt = await client.query<{ state: string }>(
          "select state from public.migration_runs where run_id = 'upgrade-run-0001'"
        )
        expect(project.rows[0].count).toBe('1')
        expect(profile.rows[0].count).toBe('1')
        expect(receipt.rows[0]?.state).toBe('data-committed')

        // 5. The new objects exist, are usable and are bootstrapped.
        const gate = await client.query<{ state: string; updated_by: string; fence_generation: string }>(
          'select state, updated_by, fence_generation::text as fence_generation from public.migration_write_gate where id'
        )
        expect(gate.rows[0]).toMatchObject({ state: 'open', updated_by: 'bootstrap' })
        expect(gate.rows[0]?.fence_generation).toMatch(/^[0-9a-f-]{36}$/)
        const dispositions = await client.query<{ count: string }>(
          "select count(*)::text as count from public.migration_record_dispositions where run_id = 'upgrade-run-0001'"
        )
        const retry = await client.query<{ count: string }>(
          "select count(*)::text as count from public.migration_retry_history where run_id = 'upgrade-run-0001'"
        )
        const freshKeys = await client.query<{ count: string }>(
          'select count(*)::text as count from public.migration_fresh_keys'
        )
        // The new surfaces exist, are empty for the upgraded receipt and enforce
        // their own constraints; their row shape is covered by the suites that
        // write them, so this test does not duplicate that.
        expect(dispositions.rows[0].count).toBe('0')
        expect(retry.rows[0].count).toBe('0')
        expect(freshKeys.rows[0].count).toBe('0')
      })

      // 6. Re-running the current set changes nothing (idempotent upgrade).
      const again = await runMigrations(pool, headDir)
      expect(again).toEqual([])
    } finally {
      await pool.end()
    }
  }, 600_000)
})
// migrations/tool/tests/migration-upgrade-path.int.test.ts
