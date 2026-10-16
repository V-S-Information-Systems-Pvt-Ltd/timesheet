import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { Pool, type PoolClient } from 'pg'
import { canonicalEffectPayload } from '@/lib/idempotency-effect'

const sql = (file: string) => readFileSync(path.join(process.cwd(), file), 'utf8')
const native = sql('db/migrations/0039_timesheet_classification.sql')
const previous = sql('db/migrations/0035_migration_retry_history.sql')
const url = process.env.TEST_DATABASE_URL
const userId = '11111111-1111-4111-8111-111111111111'
const projectId = '22222222-2222-4222-8222-222222222222'

// Exercise the real migration expressions in transaction-local tables/functions,
// without changing the shared database's rows, function definitions or grants.
describe.skipIf(!url)('classification SQL constraints and effect fingerprint parity', () => {
  let pool: Pool
  let client: PoolClient
  beforeAll(() => { pool = new Pool({ connectionString: url }) })
  afterAll(async () => { await pool.end() })
  beforeEach(async () => {
    client = await pool.connect()
    await client.query('begin')
    for (const [name, source] of [['native', native]] as const) {
      await client.query(`create temporary table ${name}_probe (project_id uuid, activity_type_id uuid, entry_type text, activity_code text, ticket_number text, activity_other text)`)
      const constraint = source.match(/add constraint timesheets_classification_valid[\s\S]*?\) is true\);/i)![0]
      await client.query(`alter table ${name}_probe ${constraint}`)
    }
    for (const [name, source] of [['native', native], ['legacy', previous]] as const) {
      const definition = source.match(/create or replace function public\.idempotency_effect_fingerprint[\s\S]*?\$\$;/i)![0]
      await client.query(definition.replace('public.idempotency_effect_fingerprint', `pg_temp.${name}_fingerprint`))
    }
  })
  afterEach(async () => { await client.query('rollback'); client.release() })

  async function insert(row: Record<string, unknown>, succeeds: boolean) {
    for (const backend of ['native']) {
      await client.query('savepoint row_check')
      const columns = Object.keys(row)
      const result = client.query(`insert into ${backend}_probe (${columns.join(',')}) values (${columns.map((_, i) => `$${i + 1}`).join(',')})`, Object.values(row))
      if (succeeds) await expect(result).resolves.toMatchObject({ rowCount: 1 })
      else await expect(result).rejects.toMatchObject({ code: '23514' })
      await client.query('rollback to savepoint row_check')
    }
  }

  it('accepts historical rows unchanged and every valid new-format branch', async () => {
    await insert({ project_id: projectId, activity_type_id: projectId }, true)
    for (const activity_code of ['planning', 'implementation', 'testing', 'research_development']) {
      await insert({ entry_type: 'project', activity_code, project_id: projectId }, true)
    }
    await insert({ entry_type: 'support', activity_code: 'internal_it' }, true)
    await insert({ entry_type: 'support', activity_code: 'customers', ticket_number: '001-a:B' }, true)
    for (const activity_code of ['research_development', 'meetings', 'certifications', 'poc', 'presales_support']) {
      await insert({ entry_type: 'internal', activity_code }, true)
    }
    await insert({ entry_type: 'internal', activity_code: 'other', activity_other: 'Architecture review' }, true)
  })

  it('fails closed on SQL NULL activity holes, legacy references in v2 and stale branch details', async () => {
    for (const entry_type of ['project', 'support', 'internal']) {
      await insert({ entry_type, project_id: entry_type === 'project' ? projectId : null }, false)
    }
    await insert({ entry_type: 'support', activity_code: 'internal_it', activity_type_id: projectId }, false)
    await insert({ entry_type: 'internal', activity_code: 'meetings', activity_type_id: projectId }, false)
    await insert({ entry_type: 'project', activity_code: 'planning', project_id: projectId, activity_type_id: projectId }, false)
    await insert({ entry_type: 'support', activity_code: 'customers', project_id: projectId, ticket_number: 'x' }, false)
    await insert({ entry_type: 'internal', activity_code: 'meetings', ticket_number: 'x' }, false)
    await insert({ entry_type: 'support', activity_code: 'internal_it', activity_other: 'x' }, false)
    await insert({ entry_type: 'project', activity_code: 'customers', project_id: projectId }, false)
    await insert({ project_id: projectId, activity_code: 'planning' }, false)
    await insert({ entry_type: 'unknown', activity_code: 'other' }, false)
  })

  it('requires trimmed nonblank conditional text and enforces inclusive length limits', async () => {
    for (const ticket_number of [null, '', ' ', '\t', ' padded ', ' x﻿', 'x'.repeat(101)]) {
      await insert({ entry_type: 'support', activity_code: 'customers', ticket_number }, false)
    }
    for (const activity_other of [null, '', ' ', '\n', ' padded ', 'x'.repeat(201)]) {
      await insert({ entry_type: 'internal', activity_code: 'other', activity_other }, false)
    }
    await insert({ entry_type: 'support', activity_code: 'customers', ticket_number: 'x'.repeat(100) }, true)
    await insert({ entry_type: 'internal', activity_code: 'other', activity_other: 'x'.repeat(200) }, true)
  })

  it('rejects real-project reserved inserts/renames while trusted false flags survive renames', async () => {
    await client.query('create temporary table project_probe (name text, is_timesheet_project boolean not null default true)')
    const definition = native.match(/create or replace function public\.projects_reserved_timesheet_flag[\s\S]*?\$\$;/i)![0]
    await client.query(definition.replace('public.projects_reserved_timesheet_flag', 'pg_temp.project_guard'))
    await client.query('create trigger project_guard before insert or update on project_probe for each row execute function pg_temp.project_guard()')
    await client.query("insert into project_probe values ('Internal', false), ('Real project', true)")
    await client.query("update project_probe set name = 'Historical reference' where name = 'Internal'")
    expect((await client.query("select is_timesheet_project from project_probe where name = 'Historical reference'")).rows[0].is_timesheet_project).toBe(false)
    for (const statement of ["insert into project_probe (name) values (' SUPPORT ')", "update project_probe set name = ' Internal IT ' where is_timesheet_project"]) {
      await client.query('savepoint project_check')
      await expect(client.query(statement)).rejects.toMatchObject({ code: '23514' })
      await client.query('rollback to savepoint project_check')
    }
  })

  it.each(['create_timesheet', 'update_timesheet'])('matches legacy %s SQL fingerprints exactly, including omitted/default nulls', async (operation) => {
    const payload = { id: projectId, user_id: userId, project_id: projectId, activity_type_id: null, log_date: '2026-10-05', hours_worked: 1.5, work_done: 'Historical work' }
    const baseline = await client.query('select pg_temp.legacy_fingerprint($1, $2::jsonb) as fingerprint', [operation, JSON.stringify(payload)])
    for (const name of ['native']) {
      const current = await client.query(`select pg_temp.${name}_fingerprint($1, $2::jsonb) as fingerprint`, [operation, JSON.stringify({ ...payload, entry_type: null, activity_code: null, ticket_number: null, activity_other: null })])
      expect(current.rows[0].fingerprint).toBe(baseline.rows[0].fingerprint)
    }
  })

  it.each(['create_timesheet', 'update_timesheet'])('matches %s TS/native defaults and changes fingerprint for ticket-only edits', async (operation) => {
    const input = { id: projectId, userId, entryType: 'support', activityCode: 'customers', ticketNumber: '  001-a:B ﻿', logDate: '2026-10-05', hoursWorked: 1.5, workDone: 'Investigated ticket' }
    const payload = canonicalEffectPayload(operation, input, userId) as Record<string, unknown>
    const raw: Record<string, unknown> = { ...payload, ticket_number: input.ticketNumber, activity_other: ' ' }
    delete raw.project_id
    delete raw.activity_type_id
    for (const name of ['native']) {
      const result = await client.query(`select pg_temp.${name}_fingerprint($1, $2::jsonb) as canonical, pg_temp.${name}_fingerprint($1, $3::jsonb) as raw, pg_temp.${name}_fingerprint($1, $4::jsonb) as changed`, [operation, JSON.stringify(payload), JSON.stringify(raw), JSON.stringify({ ...payload, ticket_number: '001-a:C' })])
      expect(result.rows[0].raw).toBe(result.rows[0].canonical)
      expect(result.rows[0].changed).not.toBe(result.rows[0].canonical)
    }
  })
})
