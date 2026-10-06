import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { Pool, type PoolClient } from 'pg'
import { canonicalEffectPayload } from '@/lib/idempotency-effect'

const sql = (file: string) => readFileSync(path.join(process.cwd(), file), 'utf8')
const native = sql('db/migrations/0039_timesheet_classification.sql')
const supabase = sql('supabase/migrations/20261007000000_timesheet_classification.sql')
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
    for (const [name, source] of [['native', native], ['supabase', supabase]] as const) {
      await client.query(`create temporary table ${name}_probe (project_id uuid, activity_type_id uuid, entry_type text, activity_code text, ticket_number text, activity_other text)`)
      const constraint = source.match(/add constraint timesheets_classification_valid[\s\S]*?\) is true\);/i)![0]
      await client.query(`alter table ${name}_probe ${constraint}`)
    }
    for (const [name, source] of [['native', native], ['supabase', supabase], ['legacy', previous]] as const) {
      const definition = source.match(/create or replace function public\.idempotency_effect_fingerprint[\s\S]*?\$\$;/i)![0]
      await client.query(definition.replace('public.idempotency_effect_fingerprint', `pg_temp.${name}_fingerprint`))
    }
  })
  afterEach(async () => { await client.query('rollback'); client.release() })

  async function insert(row: Record<string, unknown>, succeeds: boolean) {
    for (const backend of ['native', 'supabase']) {
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

  it('bulk SQL rechecks owner, active actor, admin escalation and old/new dates at the write', async () => {
    await client.query(`create temporary table bulk_probe (like native_probe including constraints);
      alter table bulk_probe add column id uuid, add column user_id uuid, add column log_date date, add column hours_worked numeric, add column work_done text;
      create temporary table actor_probe (id uuid, is_active boolean, permission_role text);
      create temporary table settings_probe (id int, backfill_mode text, backfill_window_days int, backfill_extra_days int);
      insert into settings_probe values (1, 'days', 7, 0)`)
    await client.query("insert into actor_probe values ($1, true, 'user')", [userId])
    await client.query("insert into bulk_probe (id, user_id, log_date, entry_type, activity_code, ticket_number) values ($1, $2, current_date, 'support', 'customers', 'old')", [projectId, userId])
    const definition = supabase.match(/create or replace function public\.bulk_update_timesheets[\s\S]*?\$\$;/i)![0]
    await client.query(definition.replace('public.bulk_update_timesheets', 'pg_temp.bulk_update_probe').replaceAll('public.timesheets', 'pg_temp.bulk_probe').replaceAll('public.profiles', 'pg_temp.actor_probe').replaceAll('public.app_settings', 'pg_temp.settings_probe'))
    const dates = (await client.query("select current_date::text as today, (current_date + 1)::text as future, (current_date - 8)::text as old")).rows[0]
    const payload = { id: projectId, entry_type: 'support', activity_code: 'customers', ticket_number: '001-a:B', log_date: dates.today, hours_worked: 1, work_done: 'Investigated' }
    const update = async (canEditAll = false, log_date = dates.today) => (await client.query('select * from pg_temp.bulk_update_probe($1, $2, $3::jsonb)', [userId, canEditAll, JSON.stringify([{ ...payload, log_date }])])).rowCount
    expect(await update()).toBe(1)
    expect(await update(false, dates.future)).toBe(0)
    expect(await update(false, dates.old)).toBe(0)
    await client.query('update bulk_probe set log_date = current_date - 8')
    expect(await update()).toBe(0)
    await client.query('update bulk_probe set log_date = current_date, user_id = $1', [projectId])
    expect(await update()).toBe(0)
    expect(await update(true)).toBe(0)
    await client.query("update actor_probe set permission_role = 'admin'")
    expect(await update(true, dates.old)).toBe(1)
    await client.query('update actor_probe set is_active = false')
    expect(await update(true)).toBe(0)
  })

  it.each(['create_timesheet', 'update_timesheet'])('matches legacy %s SQL fingerprints exactly, including omitted/default nulls', async (operation) => {
    const payload = { id: projectId, user_id: userId, project_id: projectId, activity_type_id: null, log_date: '2026-10-05', hours_worked: 1.5, work_done: 'Historical work' }
    const baseline = await client.query('select pg_temp.legacy_fingerprint($1, $2::jsonb) as fingerprint', [operation, JSON.stringify(payload)])
    for (const name of ['native', 'supabase']) {
      const current = await client.query(`select pg_temp.${name}_fingerprint($1, $2::jsonb) as fingerprint`, [operation, JSON.stringify({ ...payload, entry_type: null, activity_code: null, ticket_number: null, activity_other: null })])
      expect(current.rows[0].fingerprint).toBe(baseline.rows[0].fingerprint)
    }
  })

  it.each(['create_timesheet', 'update_timesheet'])('matches %s TS/native/Supabase defaults and changes fingerprint for ticket-only edits', async (operation) => {
    const input = { id: projectId, userId, entryType: 'support', activityCode: 'customers', ticketNumber: '  001-a:B ﻿', logDate: '2026-10-05', hoursWorked: 1.5, workDone: 'Investigated ticket' }
    const payload = canonicalEffectPayload(operation, input, userId) as Record<string, unknown>
    const raw: Record<string, unknown> = { ...payload, ticket_number: input.ticketNumber, activity_other: ' ' }
    delete raw.project_id
    delete raw.activity_type_id
    const fingerprints: string[] = []
    for (const name of ['native', 'supabase']) {
      const result = await client.query(`select pg_temp.${name}_fingerprint($1, $2::jsonb) as canonical, pg_temp.${name}_fingerprint($1, $3::jsonb) as raw, pg_temp.${name}_fingerprint($1, $4::jsonb) as changed`, [operation, JSON.stringify(payload), JSON.stringify(raw), JSON.stringify({ ...payload, ticket_number: '001-a:C' })])
      expect(result.rows[0].raw).toBe(result.rows[0].canonical)
      expect(result.rows[0].changed).not.toBe(result.rows[0].canonical)
      fingerprints.push(result.rows[0].canonical)
    }
    expect(fingerprints[0]).toBe(fingerprints[1])
  })
})
