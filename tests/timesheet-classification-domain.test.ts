import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTimesheetEntry, updateTimesheetEntry, bulkUpdateTimesheetsDomain, duplicateTimesheetEntry, batchDuplicateTimesheetsDomain, type TimesheetDomainDeps } from '@/lib/domain/timesheets'
import type { TimesheetPersistence } from '@/lib/domain/timesheets-port'
import type { Actor } from '@/lib/db/types'
import type { TimesheetRow } from '@/app/types'

const actor: Actor = { id: 'u1', email: 'u@example.com', role: 'user', permission_role: 'user', hierarchy_role: 'user', isActive: true }
const base = { hoursWorked: 2, workDone: 'Work', logDate: '2026-10-01' }
const legacy = { ...base, projectId: 'p1', activityTypeId: 'a1' }
const support = { ...base, entryType: 'support', activityCode: 'customers', ticketNumber: ' 001-Ab:/42 ' }
const row: TimesheetRow = { id: 't1', user_id: actor.id, project_id: null, activity_type_id: null, entry_type: 'support', activity_code: 'customers', ticket_number: '001-Ab:/42', activity_other: null, hours_worked: 2, work_done: 'Work', log_date: base.logDate, created_at: '' }
const old: TimesheetRow = { ...row, id: 'old', project_id: 'p1', activity_type_id: 'a1', entry_type: null, activity_code: null, ticket_number: null }
let persistence: TimesheetPersistence
let deps: TimesheetDomainDeps
beforeEach(() => {
  vi.stubEnv('TIMESHEET_CLASSIFICATION_V2', 'true')
  persistence = {
    list: vi.fn(), getById: vi.fn(async () => row), getByIds: vi.fn(async () => [old, row]), getByUserDate: vi.fn(), getLatest: vi.fn(), countByProject: vi.fn(),
    projectEligibility: vi.fn(async () => ({ eligible: true })),
    getBackfillWindow: vi.fn(async () => ({ mode: 'days' as const, windowDays: 7, extraDays: 0 })),
    sumHoursForUserDate: vi.fn(async () => 0), sumHoursForUserDates: vi.fn(async () => new Map()),
    create: vi.fn(async () => ({ id: 'created', error: null })), update: vi.fn(async () => ({ error: null })), remove: vi.fn(),
    bulkUpdate: vi.fn(async () => ({ updated: 2, rowErrors: [], error: null })),
  }
  deps = { persistence, clock: () => base.logDate, writeBudget: { reserve: vi.fn(async () => ({ ok: true as const, reservation: { release: vi.fn() } })) } }
})
afterEach(() => vi.unstubAllEnvs())

describe('classification domain', () => {
  it('creates Support with normalized ticket identity and no project/activity reference', async () => {
    expect((await createTimesheetEntry(actor, support, deps)).ok).toBe(true)
    expect(persistence.create).toHaveBeenCalledWith(actor, { userId: actor.id, ...base, projectId: null, activityTypeId: null, entryType: 'support', activityCode: 'customers', ticketNumber: '001-Ab:/42', activityOther: null })
  })
  it('requires classification on every fresh activated create including backdates', async () => {
    expect(await createTimesheetEntry(actor, legacy, deps)).toMatchObject({ ok: false, error: { code: 'CLASSIFICATION_REQUIRED' } })
    expect(persistence.create).not.toHaveBeenCalled()
  })
  it('rejects invalid client types rather than falling through to legacy', async () => {
    expect((await createTimesheetEntry(actor, { ...legacy, entryType: 'invalid' }, deps)).ok).toBe(false)
    expect(persistence.create).not.toHaveBeenCalled()
  })
  it('rejects ineligible or missing projects server-side', async () => {
    const input = { ...base, entryType: 'project', activityCode: 'planning', projectId: 'p1' }
    vi.mocked(persistence.projectEligibility).mockResolvedValueOnce({ eligible: false }).mockResolvedValueOnce(null)
    expect((await createTimesheetEntry(actor, input, deps)).ok).toBe(false)
    expect((await createTimesheetEntry(actor, input, deps)).ok).toBe(false)
    expect(persistence.create).not.toHaveBeenCalled()
  })
  it('keeps old edits legacy after activation and rejects reclassification', async () => {
    vi.mocked(persistence.getById).mockResolvedValue(old)
    expect((await updateTimesheetEntry(actor, old.id, legacy, deps)).ok).toBe(true)
    expect(persistence.update).toHaveBeenCalledWith(actor, old.id, { userId: actor.id, ...legacy })
    expect((await updateTimesheetEntry(actor, old.id, support, deps)).ok).toBe(false)
  })
  it('cannot downgrade a classified row by omitting classification', async () => {
    expect((await updateTimesheetEntry(actor, row.id, legacy, deps)).ok).toBe(false)
    expect(persistence.update).not.toHaveBeenCalled()
  })
  it('validates each mixed bulk row by persisted format', async () => {
    expect((await bulkUpdateTimesheetsDomain(actor, [{ id: old.id, ...legacy }, { id: row.id, ...support }], deps)).ok).toBe(true)
    expect(persistence.bulkUpdate).toHaveBeenCalledWith(actor, [expect.objectContaining({ id: old.id, activityTypeId: 'a1' }), expect.objectContaining({ id: row.id, entryType: 'support', projectId: null, ticketNumber: '001-Ab:/42' })])
  })
  it('preserves duplicate details, and reports legacy sources per row', async () => {
    vi.mocked(persistence.getById).mockImplementation(async (_actor, id) => id === old.id ? old : row)
    expect((await duplicateTimesheetEntry(actor, row.id, undefined, deps)).ok).toBe(true)
    expect(persistence.create).toHaveBeenCalledWith(actor, expect.objectContaining({ entryType: 'support', ticketNumber: '001-Ab:/42', projectId: null }))
    const result = await batchDuplicateTimesheetsDomain(actor, [{ id: old.id }, { id: row.id }], deps)
    expect(result).toMatchObject({ ok: true, data: { duplicatedCount: 1, results: [{ id: old.id, success: false, code: 'CLASSIFICATION_REQUIRED' }, { id: row.id, success: true }] } })
  })
  it('revalidates project eligibility and dates on duplication', async () => {
    vi.mocked(persistence.getById).mockResolvedValue({ ...row, project_id: 'p1', entry_type: 'project', activity_code: 'planning', ticket_number: null })
    vi.mocked(persistence.projectEligibility).mockResolvedValue({ eligible: false })
    expect((await duplicateTimesheetEntry(actor, row.id, undefined, deps)).ok).toBe(false)
    expect(persistence.create).not.toHaveBeenCalled()
  })
})
