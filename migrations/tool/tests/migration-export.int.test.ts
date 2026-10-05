// tests/migration-export.int.test.ts
// C03/V4 export evidence against a disposable native database: volume beyond
// the legacy caps, special characters, value boundaries, equal-looking rows,
// a concurrent writer outside the held snapshot, and interrupted output.
//
// Gate: MIGRATION_TEST_NATIVE_ADMIN_URL + MIGRATION_TEST_NATIVE_SOURCE_URL
// (disposable names only, loopback unless MIGRATION_TEST_ALLOW_REMOTE=1).
// MIGRATION_TEST_REQUIRE=1 turns a missing prerequisite into a failure.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client, Pool } from 'pg'
import { exportBundle } from '@vsis/migration-tool/export'
import { isWriteGateFenced, readWriteGate, recoverWriteGate, resetWriteGateCache, setWriteGate } from '@vsis/migration-tool/gate'
import { runMigrations } from '@/lib/db/migrate'
import { parsePostgresUrl } from '@vsis/migration-tool/connections'
import { openReadOnlySession, openWriteSession, type DatabaseSession } from '@vsis/migration-tool/providers/session'
import { readEntityRows } from '@vsis/migration-tool/providers/read'
import { validateBundleDirectory } from '@vsis/migration-tool/validation'
import { ENTITY_ORDER, canonicalRowLine, sha256Hex } from '@vsis/migration-tool/format'

const REQUIRED_ENV = ['MIGRATION_TEST_NATIVE_ADMIN_URL', 'MIGRATION_TEST_NATIVE_SOURCE_URL'] as const
const missing = REQUIRED_ENV.filter((name) => !process.env[name])
const REQUIRE = process.env.MIGRATION_TEST_REQUIRE === '1'
const ALLOW_REMOTE = process.env.MIGRATION_TEST_ALLOW_REMOTE === '1'
const DISPOSABLE_DB_PATTERN = /^vsis_migration_c03_[a-z0-9_]+$/

if (missing.length > 0 && REQUIRE) {
  throw new Error(`MIGRATION_TEST_REQUIRE=1 but the live C03 gate is missing: ${missing.join(', ')}.`)
}

if (missing.length === 0) {
  const parsed = parsePostgresUrl(process.env.MIGRATION_TEST_NATIVE_SOURCE_URL as string)
  if (!ALLOW_REMOTE && !parsed.loopback) {
    throw new Error(`MIGRATION_TEST_NATIVE_SOURCE_URL must be loopback: ${parsed.hostname}`)
  }
  if (!DISPOSABLE_DB_PATTERN.test(parsed.database)) {
    throw new Error(`Refusing a non-disposable database: ${parsed.database}`)
  }
}

const suite = missing.length === 0 ? describe : describe.skip
const workspace = mkdtempSync(join(tmpdir(), 'vsis-export-int-'))

const PROJECTS = 1001
const USERS = 60
const DATES = 87

async function withClient<T>(url: string, fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: url })
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end()
  }
}

function readSession(): DatabaseSession {
  return openReadOnlySession({
    provider: 'native',
    role: 'source',
    envName: 'MIGRATION_TEST',
    connectionString: process.env.MIGRATION_TEST_NATIVE_SOURCE_URL as string,
    displayTarget: 'test',
    loopback: true,
    projectRef: null,
    applicationName: 'vsis-migration-export-test',
  })
}

suite('C03 exporter against a disposable database', () => {
  beforeAll(async () => {
    const adminUrl = process.env.MIGRATION_TEST_NATIVE_ADMIN_URL as string
    const url = process.env.MIGRATION_TEST_NATIVE_SOURCE_URL as string
    const database = parsePostgresUrl(url).database
    await withClient(adminUrl, async (client) => {
      await client.query(
        'select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()',
        [database]
      )
      await client.query(`drop database if exists "${database}"`)
      await client.query(`create database "${database}"`)
    })
    const pool = new Pool({ connectionString: url, max: 2 })
    try {
      await runMigrations(pool)
    } finally {
      await pool.end()
    }

    await withClient(url, async (client) => {
      // 1,001 projects: one row past the legacy 1,000-row export cap. Telegram
      // numbers are offset so they cannot collide with the seeded bootstrap rows.
      await client.query(
        `insert into public.projects (name, so_number, telegram_no)
         select 'Bulk project ' || g, case when g % 3 = 0 then null else 'SO-' || g end,
                case when g % 5 = 0 then null else g + 100000 end
         from generate_series(1, $1) as g`,
        [PROJECTS]
      )
      // Special characters and value boundaries.
      await client.query(
        `insert into public.projects (name, so_number, telegram_no) values
           ($1, $2, null)`,
        ['Ünicode 😀 "quoted" \\backslash', 'SO-\nnewline']
      )
      await client.query(
        `insert into public.profiles (email, name, department, title, role, permission_role, hierarchy_role, is_active, dashboard_layout)
         values ($1, $2, '', '', 'user', 'user', 'engineer', true, $3)`,
        [
          'edge+case@example.com',
          'Edge 😀\nName',
          '{"z": 1.10, "a": [1, {"n": 123456789012345678901234567890}]}',
        ]
      )
      // 60 users × 87 days = 5,220 timesheets, past the legacy 5,000 cap.
      await client.query(
        `insert into public.profiles (email, name, role, permission_role, hierarchy_role, is_active)
         select 'bulk' || g || '@example.com', 'Bulk User ' || g, 'user', 'user', 'engineer', true
         from generate_series(1, $1) as g`,
        [USERS]
      )
      const projectId = (await client.query<{ id: string }>('select id from public.projects order by id limit 1')).rows[0].id
      await client.query(
        `insert into public.timesheets (user_id, project_id, log_date, hours_worked, work_done)
         select p.id, $1, date '2026-01-01' + (d % $2)::int, '7.50'::numeric, 'Bulk entry'
         from public.profiles p, generate_series(1, $3) as d
         where p.email like 'bulk%@example.com'`,
        [projectId, DATES, DATES]
      )
      // Boundary values and equal-looking rows.
      const bulkUser = (
        await client.query<{ id: string }>("select id from public.profiles where email = 'bulk1@example.com'")
      ).rows[0].id
      await client.query(
        `insert into public.timesheets (user_id, project_id, log_date, hours_worked, work_done, created_at) values
           ($1, $2, '2026-06-01', '0.01', $3, '2026-06-01T00:00:00.000001Z'),
           ($1, $2, '2026-06-02', '24.00', $3, '2026-06-02T23:59:59.999999Z'),
           ($1, $2, '2026-06-03', '7.50', 'Identical text', '2026-06-03T10:00:00.000000Z'),
           ($1, $2, '2026-06-04', '7.50', 'Identical text', '2026-06-03T10:00:00.000000Z')`,
        [bulkUser, projectId, 'Edge 😀\nvalue "quoted"']
      )
    })
  }, 300_000)

  afterAll(async () => {
    rmSync(workspace, { recursive: true, force: true })
    if (process.env.MIGRATION_TEST_KEEP === '1') return
    const adminUrl = process.env.MIGRATION_TEST_NATIVE_ADMIN_URL as string
    const database = parsePostgresUrl(process.env.MIGRATION_TEST_NATIVE_SOURCE_URL as string).database
    await withClient(adminUrl, async (client) => {
      await client.query(
        'select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()',
        [database]
      )
      await client.query(`drop database if exists "${database}"`)
    })
  }, 180_000)

  it('exports past the legacy row caps with bounded batches and a validating bundle', async () => {
    const session = readSession()
    const directory = join(workspace, 'volume')
    try {
      const result = await exportBundle(session, {
        directory,
        runId: 'c03-run-volume',
        bundleId: 'c03-run-volume',
        applicationVersion: '1.0.3',
        batchSize: 500,
      })
      expect(result.counts.projects).toBeGreaterThanOrEqual(PROJECTS + 1)
      expect(result.counts.timesheets).toBeGreaterThan(5000)
      expect(result.counts.timesheets).toBe(USERS * DATES + 4)
      const timesheetStats = result.entities.find((stats) => stats.entity === 'timesheets')
      expect(timesheetStats?.batches).toBeGreaterThan(5)
      // Snapshot provenance is recorded for the bundle.
      expect(result.manifest.snapshot.transactionId).toBeTruthy()

      const validation = await validateBundleDirectory(directory)
      expect(validation.errors).toEqual([])
      expect(validation.entities.find((entity) => entity.entity === 'timesheets')?.rowCount).toBe(
        result.counts.timesheets
      )
      // Compare every file against a separate full-table source read. Sorting
      // canonical lines makes the digest independent of the export cursor order
      // while preserving equal-looking records as separate rows.
      for (const entity of ENTITY_ORDER) {
        const [{ count }] = await session.query<{ count: string }>(
          `select count(*)::text as count from public.${entity}`
        )
        const sourceLines = (await readEntityRows(session, entity)).map((row) => canonicalRowLine(entity, row)).sort()
        const bundleLines = readFileSync(join(directory, `${entity}.jsonl`), 'utf8').split('\n').filter(Boolean).sort()
        expect(result.counts[entity]).toBe(Number(count))
        expect(sha256Hex(`${bundleLines.join('\n')}${bundleLines.length ? '\n' : ''}`)).toBe(
          sha256Hex(`${sourceLines.join('\n')}${sourceLines.length ? '\n' : ''}`)
        )
      }
    } finally {
      await session.close()
    }
  }, 300_000)

  it('preserves special characters, boundaries and equal-looking rows exactly', async () => {
    const session = readSession()
    const directory = join(workspace, 'values')
    try {
      await exportBundle(session, {
        directory,
        runId: 'c03-run-values',
        bundleId: 'c03-run-values',
        applicationVersion: '1.0.3',
      })
      const projects = readFileSync(join(directory, 'projects.jsonl'), 'utf8')
      const profiles = readFileSync(join(directory, 'profiles.jsonl'), 'utf8')
      const timesheets = readFileSync(join(directory, 'timesheets.jsonl'), 'utf8')
      expect(projects).toContain('Ünicode 😀')
      expect(projects).toContain('SO-\\nnewline')
      expect(profiles).toContain('edge+case@example.com')
      expect(profiles).toContain('Edge 😀\\nName')
      // jsonb numeric literals survive canonicalization.
      expect(profiles).toContain('123456789012345678901234567890')
      expect(profiles).toContain('1.10')
      expect(timesheets).toContain('"hours_worked":"0.01"')
      expect(timesheets).toContain('"hours_worked":"24.00"')
      expect(timesheets).toContain('2026-06-01T00:00:00.000001Z')
      expect(timesheets).toContain('2026-06-02T23:59:59.999999Z')
      expect(timesheets).toContain('Edge 😀\\nvalue \\"quoted\\"')

      // Equal-looking rows stay two distinct records.
      const identical = timesheets
        .split('\n')
        .filter((line) => line.includes('Identical text'))
      expect(identical).toHaveLength(2)
      expect(identical[0]).not.toBe(identical[1])
      expect(ENTITY_ORDER).toContain('timesheets')
    } finally {
      await session.close()
    }
  }, 300_000)

  it('does not see rows written after the snapshot was taken', async () => {
    const url = process.env.MIGRATION_TEST_NATIVE_SOURCE_URL as string
    const session = readSession()
    let injected = false
    const wrapped = new Proxy(session, {
      get(target, property, receiver) {
        if (property !== 'query') return Reflect.get(target, property, receiver)
        return async (text: string, params?: unknown[]) => {
          const rows = await (target.query as (text: string, params?: unknown[]) => Promise<unknown[]>)(text, params)
          if (!injected && /from public\.projects/.test(text)) {
            injected = true
            // A concurrent writer commits while the export holds its snapshot.
            await withClient(url, async (client) => {
              await client.query("insert into public.projects (name, so_number, telegram_no) values ('Concurrent row', null, null)")
            })
          }
          return rows
        }
      },
    }) as DatabaseSession

    const directory = join(workspace, 'snapshot')
    try {
      const result = await exportBundle(wrapped, {
        directory,
        runId: 'c03-run-snapshot',
        bundleId: 'c03-run-snapshot',
        applicationVersion: '1.0.3',
        batchSize: 200,
      })
      expect(injected).toBe(true)
      expect(readFileSync(join(directory, 'projects.jsonl'), 'utf8')).not.toContain('Concurrent row')
      expect(result.counts.projects).toBeGreaterThanOrEqual(PROJECTS + 1)
      await withClient(url, async (client) => {
        await client.query("delete from public.projects where name = 'Concurrent row'")
      })
    } finally {
      await session.close()
    }
  }, 300_000)

  it('leaves no importable bundle when the connection drops mid-export', async () => {
    const session = readSession()
    let batches = 0
    const failing = new Proxy(session, {
      get(target, property, receiver) {
        if (property !== 'query') return Reflect.get(target, property, receiver)
        return async (text: string, params?: unknown[]) => {
          if (/from public\.timesheets/.test(text)) {
            batches += 1
            if (batches === 2) throw new Error('simulated connection loss')
          }
          return (target.query as (text: string, params?: unknown[]) => Promise<unknown[]>)(text, params)
        }
      },
    }) as DatabaseSession

    const directory = join(workspace, 'interrupted')
    try {
      await expect(
        exportBundle(failing, {
          directory,
          runId: 'c03-run-interrupted',
          bundleId: 'c03-run-interrupted',
          applicationVersion: '1.0.3',
          batchSize: 500,
        })
      ).rejects.toThrow(/incomplete/)
      expect(existsSync(join(directory, 'manifest.json'))).toBe(false)
      const validation = await validateBundleDirectory(directory)
      expect(validation.ok).toBe(false)
      expect(validation.errors.map((issue) => issue.code)).toContain('E_MANIFEST_MISSING')
    } finally {
      await session.close()
    }
  }, 300_000)

  it('writes nothing to the source and reports diagnostics for the deployment', async () => {
    const session = readSession()
    const directory = join(workspace, 'diagnostics')
    try {
      await session.assertReadOnly()
      const result = await exportBundle(session, {
        directory,
        runId: 'c03-run-diagnostics',
        bundleId: 'c03-run-diagnostics',
        applicationVersion: '1.0.3',
      })
      // Provider-internal columns are understood, not drift.
      expect(result.diagnostics.unmappedColumns).toEqual([])
      expect(result.diagnostics.missingColumns).toEqual([])
      expect(result.diagnostics.providerDeltaColumns).toContain('titles.id:text')
      expect(result.diagnostics.zeroRowEntities).toContain('audit_logs')
    } finally {
      await session.close()
    }
  }, 300_000)

  it('persists a write-gate transition durably in the destination', async () => {
    const gateSession = openWriteSession({
      provider: 'native',
      role: 'destination',
      envName: 'MIGRATION_TEST',
      connectionString: process.env.MIGRATION_TEST_NATIVE_SOURCE_URL as string,
      displayTarget: 'test',
      loopback: true,
      projectRef: null,
      applicationName: 'vsis-migration-export-test',
    })
    try {
      expect((await readWriteGate(gateSession))?.state).toBe('open')
      await setWriteGate(gateSession, {
        state: 'fenced',
        reason: 'C06B live durability check',
        actor: 'c03-test-operator',
        runId: 'c06b-run-1',
      })
      // A fresh read proves the state came from the database, not from memory.
      resetWriteGateCache()
      const fenced = await readWriteGate(gateSession)
      expect(fenced).toMatchObject({ state: 'fenced', runId: 'c06b-run-1', updatedBy: 'c03-test-operator' })
      expect(fenced?.reason).toContain('durability check')
      expect(await isWriteGateFenced(gateSession)).toBe(true)

      await recoverWriteGate(gateSession, { state: 'open', runId: 'c06b-run-1', reason: '[recovery] check complete', actor: 'c03-test-operator' })
      resetWriteGateCache()
      expect((await readWriteGate(gateSession))?.state).toBe('open')
    } finally {
      await gateSession.close()
    }
  }, 120_000)

  it('refuses to open a write session for a source connection', () => {
    let code: string | null = null
    try {
      openWriteSession({
        provider: 'native',
        role: 'source',
        envName: 'MIGRATION_TEST',
        connectionString: process.env.MIGRATION_TEST_NATIVE_SOURCE_URL as string,
        displayTarget: 'test',
        loopback: true,
        projectRef: null,
        applicationName: 'vsis-migration-export-test',
      })
    } catch (error) {
      code = (error as { code?: string }).code ?? null
    }
    expect(code).toBe('E_WRITE_ROLE')
  }, 60_000)
})
// migrations/tool/tests/migration-export.int.test.ts
