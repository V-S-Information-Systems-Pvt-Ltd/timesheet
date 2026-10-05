import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { Actor, TimesheetInput } from '@/lib/db/types'
import { canonicalEffectPayload } from '@/lib/idempotency-effect'

const { query, createClient, getAdminClient } = vi.hoisted(() => ({ query: vi.fn(), createClient: vi.fn(), getAdminClient: vi.fn() }))
vi.mock('@/lib/db/pool', () => ({ query }))
vi.mock('@/lib/supabase/server', () => ({ createClient }))
vi.mock('@/lib/supabase/admin', () => ({ getAdminClient }))
vi.mock('@/lib/supabase/bearer', () => ({ getMobileSupabaseClient: () => null }))
import { nativeTimesheetPersistence } from '@/lib/db/native/timesheets'
import { supabaseTimesheetPersistence } from '@/lib/db/supabase/timesheets'
import { nativeReferencePersistence } from '@/lib/db/native/reference'
import { supabaseReferencePersistence } from '@/lib/db/supabase/reference'

const actor: Actor = { id: '11111111-1111-4111-8111-111111111111', email: 'user@example.com', role: 'user', permission_role: 'user', hierarchy_role: 'user', isActive: true }
const id = '22222222-2222-4222-8222-222222222222'
const input: TimesheetInput = { userId: actor.id, projectId: null, activityTypeId: null, entryType: 'support', activityCode: 'customers', ticketNumber: '  001-Ab:C  ', logDate: '2026-10-05', hoursWorked: 2, workDone: 'Investigated ticket' }

function provider(data: unknown = null, error: { code?: string; message: string } | null = null) {
  const result = { data, error, count: 0 }
  const chain = {
    select: vi.fn().mockReturnThis(), insert: vi.fn().mockReturnThis(), update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(), is: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue(result), single: vi.fn().mockResolvedValue(result),
    then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
  }
  const client = { from: vi.fn(() => chain), rpc: vi.fn().mockResolvedValue({ data: [{ updated_id: id }], error: null }) }
  createClient.mockResolvedValue(client)
  getAdminClient.mockReturnValue(client)
  return { chain, client }
}

beforeEach(() => { vi.resetAllMocks(); query.mockResolvedValue([{ id }]) })

describe('classification persistence backend parity', () => {
  it('normalizes v2 optional fields and ticket text identically on create and update', async () => {
    const { chain } = provider({ id })
    expect(await nativeTimesheetPersistence.create(actor, input)).toEqual({ id, error: null })
    expect(await supabaseTimesheetPersistence.create(actor, input)).toEqual({ id, error: null })
    const canonical = canonicalEffectPayload('create_timesheet', input, actor.id) as Record<string, unknown>
    expect(chain.insert).toHaveBeenCalledWith(canonical)
    expect(query.mock.calls[0][1]).toEqual([actor.id, null, null, 'support', 'customers', null, '001-Ab:C', input.logDate, 2, input.workDone])
    await nativeTimesheetPersistence.update(actor, id, input)
    await supabaseTimesheetPersistence.update(actor, id, input)
    expect(chain.update).toHaveBeenCalledWith(expect.objectContaining({ project_id: null, activity_type_id: null, activity_other: null, ticket_number: '001-Ab:C' }))
    expect(query.mock.calls[1][1]).toEqual([null, null, input.logDate, 2, input.workDone, id, actor.id, 'support', 'customers', null, '001-Ab:C'])
  })

  it('preserves legacy references and maps write constraint failures to the established envelope', async () => {
    const legacy = { ...input, projectId: id, activityTypeId: id, entryType: null, activityCode: null, ticketNumber: null }
    const { chain } = provider(null, { code: '23514', message: 'classification violation' })
    query.mockRejectedValue({ code: '23514', constraint: 'timesheets_classification_valid' })
    expect(await nativeTimesheetPersistence.create(actor, legacy)).toEqual({ error: 'Something went wrong. Please try again.' })
    expect(await supabaseTimesheetPersistence.create(actor, legacy)).toEqual({ error: 'Something went wrong. Please try again.' })
    expect(chain.insert).toHaveBeenCalledWith(expect.objectContaining({ project_id: id, activity_type_id: id, entry_type: null }))
  })

  it('bulk writes carry all fields and do not turn a read-all co role into write-all', async () => {
    const co = { ...actor, role: 'co' as const, permission_role: 'co' as const }
    const { client } = provider([{ id, user_id: actor.id }])
    query.mockResolvedValue([{ id }])
    const row = { id, ...input }
    expect(await nativeTimesheetPersistence.bulkUpdate(co, [row])).toMatchObject({ updated: 1, error: null })
    expect(await supabaseTimesheetPersistence.bulkUpdate(co, [row])).toMatchObject({ updated: 1, error: null })
    expect(query.mock.calls[0][0]).toContain('t.user_id = $11')
    expect(query.mock.calls[0][1]).toEqual([id, null, null, 'support', 'customers', null, '001-Ab:C', input.logDate, 2, input.workDone, actor.id])
    expect(client.rpc).toHaveBeenCalledWith('bulk_update_timesheets', { p_actor_id: actor.id, p_can_edit_all: false, p_rows: [expect.objectContaining({ entry_type: 'support', ticket_number: '001-Ab:C', activity_other: null })] })
  })

  it('rejects inactive bulk actors before accessing either provider', async () => {
    provider()
    for (const adapter of [nativeTimesheetPersistence, supabaseTimesheetPersistence]) {
      expect(await adapter.bulkUpdate({ ...actor, isActive: false }, [{ id, ...input }])).toMatchObject({ error: 'Your account is not active.' })
    }
    expect(query).not.toHaveBeenCalled()
    expect(getAdminClient).not.toHaveBeenCalled()
  })

  it.each([true, false, undefined])('requires an explicitly eligible project flag %s in both backends', async (flag) => {
    query.mockResolvedValue([{ is_timesheet_project: flag }])
    provider({ is_timesheet_project: flag })
    expect(await nativeTimesheetPersistence.projectEligibility(actor, id)).toEqual({ eligible: flag === true })
    expect(await supabaseTimesheetPersistence.projectEligibility(actor, id)).toEqual({ eligible: flag === true })
  })

  it('keeps project eligibility readable and rename writes never overwrite it', async () => {
    const project = { id, name: 'Internal', is_timesheet_project: false }
    query.mockResolvedValue([project])
    const { chain } = provider([project])
    expect(await nativeReferencePersistence.listProjects(actor)).toEqual([project])
    expect(await supabaseReferencePersistence.listProjects(actor)).toEqual([project])
    expect(query.mock.calls[0][0]).toContain('is_timesheet_project')
    const admin = { ...actor, role: 'admin' as const, permission_role: 'admin' as const }
    await nativeReferencePersistence.renameProject(admin, id, 'Historical reference')
    await supabaseReferencePersistence.renameProject(admin, id, 'Historical reference')
    expect(query.mock.calls[1][0]).not.toContain('is_timesheet_project')
    expect(chain.update).toHaveBeenCalledWith({ name: 'Historical reference' })
  })

  it.each(['support', 'legacy'] as const)('filters %s and activity identically for list/CSV consumers', async (entryType) => {
    query.mockResolvedValue([])
    const { chain } = provider([])
    const opts = { entryType, activityCode: 'customers' as const, includeCount: false }
    await nativeTimesheetPersistence.list(actor, opts)
    await supabaseTimesheetPersistence.list(actor, opts)
    expect(query.mock.calls[0][0]).toContain(entryType === 'legacy' ? 't.entry_type is null' : 't.entry_type = $2')
    if (entryType === 'legacy') expect(chain.is).toHaveBeenCalledWith('entry_type', null)
    else expect(chain.eq).toHaveBeenCalledWith('entry_type', entryType)
    expect(chain.eq).toHaveBeenCalledWith('activity_code', 'customers')
  })
})

const sql = (file: string) => readFileSync(path.join(process.cwd(), file), 'utf8')
const native = sql('db/migrations/0039_timesheet_classification.sql')
const supabase = sql('supabase/migrations/20261007000000_timesheet_classification.sql')

describe('classification paired migration invariants', () => {
  it('uses identical NULL-safe constraints, null legacy activity references for v2, and bounded trimmed details', () => {
    const constraint = (source: string) => source.match(/add constraint timesheets_classification_valid[\s\S]*?\) is true\);/i)?.[0]
    expect(constraint(native)).toBeDefined()
    expect(constraint(supabase)).toBe(constraint(native))
    expect(constraint(native)?.match(/activity_type_id is null/g)).toHaveLength(3)
    expect(constraint(native)).toContain('char_length(ticket_number) between 1 and 100')
    expect(constraint(native)).toContain('char_length(activity_other) between 1 and 200')
    expect(constraint(native)).toContain('ticket_number = btrim(ticket_number')
    expect(constraint(native)).toContain('activity_other = btrim(activity_other')
    expect(native).not.toMatch(/update public\.timesheets/i)
    expect(supabase.slice(0, supabase.indexOf('create or replace function public.bulk_update_timesheets'))).not.toMatch(/update public\.timesheets/i)
  })

  it('keeps the exact legacy canonical expressions from both previous SQL definitions', () => {
    const legacyObject = (source: string, operation: string) => {
      const regex = new RegExp(`when '${operation}' then(?: case when .*? is null then)? (jsonb_build_object\\([\\s\\S]*?\\))(?=\\s+(?:else jsonb_build_object|when))`)
      const match = source.match(regex)
      expect(match, operation).not.toBeNull()
      return match![1].replace(/\s+/g, '')
    }
    for (const operation of ['create_timesheet', 'update_timesheet']) {
      expect(legacyObject(native, operation)).toBe(legacyObject(sql('db/migrations/0035_migration_retry_history.sql'), operation))
      expect(legacyObject(supabase, operation)).toBe(legacyObject(sql('supabase/migrations/20260920000000_idempotency_effects.sql'), operation))
    }
  })

  it('pins the bulk definer owner/grants and rechecks active actor, admin escalation and both dates', () => {
    expect(supabase).toContain('alter function public.bulk_update_timesheets(uuid, boolean, jsonb) owner to postgres')
    expect(supabase).toContain('set search_path = public, pg_temp')
    expect(supabase).toContain('revoke all on function public.bulk_update_timesheets(uuid, boolean, jsonb) from public, anon, authenticated')
    expect(supabase).toContain('grant execute on function public.bulk_update_timesheets(uuid, boolean, jsonb) to service_role')
    expect(supabase).toContain('actor.id = p_actor_id and actor.is_active')
    expect(supabase).toContain("actor.permission_role = 'admin'")
    expect(supabase).toContain('t.log_date <= current_date and v.log_date <= current_date')
    expect(supabase).toContain('t.user_id = p_actor_id')
  })

  it('rejects eligible reserved names without converting a project flag during rename', () => {
    for (const source of [native, supabase]) {
      expect(source).toMatch(/if new\.is_timesheet_project and lower\(btrim\(new\.name,/i)
      expect(source).toContain("in ('internal', 'internal it', 'support') then")
      expect(source).not.toMatch(/[\x0b\x0c]/)
      expect(source).toContain("using errcode = '23514'")
      expect(source).not.toContain('new.is_timesheet_project :=')
    }
  })
})
