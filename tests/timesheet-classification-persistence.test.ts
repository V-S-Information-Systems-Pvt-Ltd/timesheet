import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { Actor, TimesheetInput } from '@/lib/db/types'

const { query } = vi.hoisted(() => ({ query: vi.fn() }))
vi.mock('@/lib/db/pool', () => ({ query }))
import { nativeTimesheetPersistence } from '@/lib/db/native/timesheets'
import { nativeReferencePersistence } from '@/lib/db/native/reference'

const actor: Actor = { id: '11111111-1111-4111-8111-111111111111', email: 'user@example.com', role: 'user', permission_role: 'user', hierarchy_role: 'user', isActive: true }
const id = '22222222-2222-4222-8222-222222222222'
const input: TimesheetInput = { userId: actor.id, projectId: null, activityTypeId: null, entryType: 'support', activityCode: 'customers', ticketNumber: '  001-Ab:C  ', logDate: '2026-10-05', hoursWorked: 2, workDone: 'Investigated ticket' }

beforeEach(() => { vi.resetAllMocks(); query.mockResolvedValue([{ id }]) })

describe('classification persistence', () => {
  it('normalizes v2 optional fields and ticket text on create and update', async () => {
    expect(await nativeTimesheetPersistence.create(actor, input)).toEqual({ id, error: null })
    expect(query.mock.calls[0][1]).toEqual([actor.id, null, null, 'support', 'customers', null, '001-Ab:C', input.logDate, 2, input.workDone, null])
    await nativeTimesheetPersistence.update(actor, id, input)
    expect(query.mock.calls[1][1]).toEqual([null, null, input.logDate, 2, input.workDone, id, actor.id, 'support', 'customers', null, '001-Ab:C', null])
  })

  it('preserves legacy references and maps write constraint failures to the established envelope', async () => {
    const legacy = { ...input, projectId: id, activityTypeId: id, entryType: null, activityCode: null, ticketNumber: null }
    query.mockRejectedValue({ code: '23514', constraint: 'timesheets_classification_valid' })
    expect(await nativeTimesheetPersistence.create(actor, legacy)).toEqual({ error: 'Something went wrong. Please try again.' })
  })

  it('bulk writes carry all fields and do not turn a read-all co role into write-all', async () => {
    const co = { ...actor, role: 'co' as const, permission_role: 'co' as const }
    query.mockResolvedValue([{ id }])
    const row = { id, ...input }
    expect(await nativeTimesheetPersistence.bulkUpdate(co, [row])).toMatchObject({ updated: 1, error: null })
    expect(query.mock.calls[0][0]).toContain('t.user_id = $12')
    expect(query.mock.calls[0][1]).toEqual([id, null, null, 'support', 'customers', null, '001-Ab:C', input.logDate, 2, input.workDone, null, actor.id])
  })

  it('rejects inactive bulk actors before accessing the database', async () => {
    expect(await nativeTimesheetPersistence.bulkUpdate({ ...actor, isActive: false }, [{ id, ...input }])).toMatchObject({ error: 'Your account is not active.' })
    expect(query).not.toHaveBeenCalled()
  })

  it.each([true, false, undefined])('requires an explicitly eligible project flag %s', async (flag) => {
    query.mockResolvedValue([{ is_timesheet_project: flag }])
    expect(await nativeTimesheetPersistence.projectEligibility(actor, id)).toEqual({ eligible: flag === true })
  })

  it('keeps project eligibility readable and rename writes never overwrite it', async () => {
    const project = { id, name: 'Internal', is_timesheet_project: false }
    query.mockResolvedValue([project])
    expect(await nativeReferencePersistence.listProjects(actor)).toEqual([project])
    expect(query.mock.calls[0][0]).toContain('is_timesheet_project')
    const admin = { ...actor, role: 'admin' as const, permission_role: 'admin' as const }
    await nativeReferencePersistence.renameProject(admin, id, 'Historical reference')
    expect(query.mock.calls[1][0]).not.toContain('is_timesheet_project')
  })

  it.each(['support', 'legacy'] as const)('filters %s and activity for list/CSV consumers', async (entryType) => {
    query.mockResolvedValue([])
    const opts = { entryType, activityCode: 'customers' as const, includeCount: false }
    await nativeTimesheetPersistence.list(actor, opts)
    expect(query.mock.calls[0][0]).toContain(entryType === 'legacy' ? 't.entry_type is null' : 't.entry_type = $2')
  })
})

const sql = (file: string) => readFileSync(path.join(process.cwd(), file), 'utf8')
const native = sql('db/migrations/0039_timesheet_classification.sql')

describe('classification migration invariants', () => {
  it('uses NULL-safe constraints, null legacy activity references for v2, and bounded trimmed details', () => {
    const constraint = (source: string) => source.match(/add constraint timesheets_classification_valid[\s\S]*?\) is true\);/i)?.[0]
    expect(constraint(native)).toBeDefined()
    expect(constraint(native)?.match(/activity_type_id is null/g)).toHaveLength(3)
    expect(constraint(native)).toContain('char_length(ticket_number) between 1 and 100')
    expect(constraint(native)).toContain('char_length(activity_other) between 1 and 200')
    expect(constraint(native)).toContain('ticket_number = btrim(ticket_number')
    expect(constraint(native)).toContain('activity_other = btrim(activity_other')
    expect(native).not.toMatch(/update public\.timesheets/i)
  })

  it('keeps the exact legacy canonical expressions from the previous SQL definition', () => {
    const legacyObject = (source: string, operation: string) => {
      const regex = new RegExp(`when '${operation}' then(?: case when .*? is null then)? (jsonb_build_object\\([\\s\\S]*?\\))(?=\\s+(?:else jsonb_build_object|when))`)
      const match = source.match(regex)
      expect(match, operation).not.toBeNull()
      return match![1].replace(/\s+/g, '')
    }
    for (const operation of ['create_timesheet', 'update_timesheet']) {
      expect(legacyObject(native, operation)).toBe(legacyObject(sql('db/migrations/0035_migration_retry_history.sql'), operation))
    }
  })

  it('rejects eligible reserved names without converting a project flag during rename', () => {
    for (const source of [native]) {
      expect(source).toMatch(/if new\.is_timesheet_project and lower\(btrim\(new\.name,/i)
      expect(source).toContain("in ('internal', 'internal it', 'support') then")
      expect(source).not.toMatch(/[\x0b\x0c]/)
      expect(source).toContain("using errcode = '23514'")
      expect(source).not.toContain('new.is_timesheet_project :=')
    }
  })
})
