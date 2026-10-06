import { describe, expect, it, vi } from 'vitest'
import { batchDuplicateTimesheetsDomain, type TimesheetDomainDeps } from '@/lib/domain/timesheets'
import type { TimesheetPersistence } from '@/lib/domain/timesheets-port'
import type { Actor } from '@/lib/db/types'

const actor: Actor = {
  id: 'user-1', email: 'user@example.com', role: 'user', permission_role: 'user',
  hierarchy_role: 'engineer', isActive: true,
}
const source = {
  id: 'source', user_id: actor.id, project_id: 'project', activity_type_id: null,
  entry_type: 'project', activity_code: 'implementation', activity_other: null, ticket_number: null,
  hours_worked: 2, work_done: 'Completed work', log_date: '2026-10-01',
  created_at: '2026-10-01T00:00:00.000Z', projects: { name: 'Project' },
}

function setup() {
  const release = vi.fn(async () => {})
  const reserve = vi.fn(async () => ({ ok: true as const, reservation: { release } }))
  const getById = vi.fn().mockResolvedValueOnce(source)
  const create = vi.fn().mockResolvedValue({ id: 'created', error: null })
  const persistence: TimesheetPersistence = {
    list: vi.fn(), getBackfillWindow: vi.fn().mockResolvedValue({ mode: 'days', windowDays: 7, extraDays: 0 }),
    getById, getByIds: vi.fn(), getByUserDate: vi.fn(), getLatest: vi.fn(), countByProject: vi.fn(),
    projectEligibility: vi.fn().mockResolvedValue({ eligible: true }),
    sumHoursForUserDate: vi.fn().mockResolvedValue(0), sumHoursForUserDates: vi.fn(),
    create, update: vi.fn(), remove: vi.fn(), bulkUpdate: vi.fn(),
  }
  const deps: TimesheetDomainDeps = { persistence, clock: () => '2026-10-02', writeBudget: { reserve } }
  return { deps, getById, create, reserve, release }
}

describe('batch duplicate committed-write read-back', () => {
  it('reports a committed duplicate successfully when its optional read-back throws', async () => {
    const { deps, getById, create } = setup()
    getById.mockRejectedValueOnce(new Error('Read-back unavailable'))
    const result = await batchDuplicateTimesheetsDomain(actor, [{ id: 'source', targetDate: '2026-10-02' }], deps)
    expect(create).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({
      ok: true, data: { duplicatedCount: 1, results: [{ id: 'source', success: true, entry: {
        id: 'created', user_id: actor.id, log_date: '2026-10-02', hours_worked: 2,
        project_id: 'project', activity_type_id: null, work_done: 'Completed work',
      } }] },
    })
  })

  it('retains the real write-budget reservation after committed create and thrown read-back', async () => {
    const { deps, getById, create, reserve, release } = setup()
    getById.mockRejectedValueOnce(new Error('Read-back unavailable'))
    await batchDuplicateTimesheetsDomain(actor, [{ id: 'source' }], deps)
    expect(create).toHaveBeenCalledTimes(1)
    expect(reserve).toHaveBeenCalledExactlyOnceWith(actor.id)
    expect(release).not.toHaveBeenCalled()
  })

  it('still refunds an entirely failed create and does not attempt read-back', async () => {
    const { deps, getById, create, release } = setup()
    create.mockResolvedValue({ error: 'Insert failed' })
    const result = await batchDuplicateTimesheetsDomain(actor, [{ id: 'source' }], deps)
    expect(result).toEqual({ ok: true, data: { duplicatedCount: 0, results: [{ id: 'source', success: false, error: 'Insert failed' }] } })
    expect(getById).toHaveBeenCalledTimes(1)
    expect(release).toHaveBeenCalledTimes(1)
  })

  it('preserves the established synthesized-entry fallback for a null read-back', async () => {
    const { deps, getById, release } = setup()
    getById.mockResolvedValueOnce(null)
    const result = await batchDuplicateTimesheetsDomain(actor, [{ id: 'source' }], deps)
    expect(result).toMatchObject({ ok: true, data: { duplicatedCount: 1, results: [{ success: true, entry: { id: 'created' } }] } })
    expect(release).not.toHaveBeenCalled()
  })

  it('counts a committed copy before checking the next item against the same-day cap', async () => {
    const { deps, getById, create, release } = setup()
    getById.mockRejectedValueOnce(new Error('Read-back unavailable')).mockResolvedValueOnce({ ...source, id: 'second' })
    vi.mocked(deps.persistence.sumHoursForUserDate).mockResolvedValue(22)
    const result = await batchDuplicateTimesheetsDomain(actor, [{ id: 'source' }, { id: 'second' }], deps)
    expect(result).toMatchObject({ ok: true, data: { duplicatedCount: 1, results: [
      { id: 'source', success: true, entry: { id: 'created' } },
      { id: 'second', success: false, error: expect.stringContaining('24 hours') },
    ] } })
    expect(create).toHaveBeenCalledTimes(1)
    expect(deps.persistence.sumHoursForUserDate).toHaveBeenCalledTimes(1)
    expect(release).not.toHaveBeenCalled()
  })

  it('keeps mixed item order and the committed fallback owner/date/sanitized work', async () => {
    const { deps, getById, create, release } = setup()
    const adminActor: Actor = { ...actor, id: 'admin-1', role: 'admin', permission_role: 'admin' }
    getById.mockReset().mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ...source, work_done: '<b>Completed work</b>' })
      .mockRejectedValueOnce(new Error('Read-back unavailable'))
    const result = await batchDuplicateTimesheetsDomain(adminActor, [
      { id: 'missing' }, { id: 'source', targetDate: '2026-10-02' },
    ], deps)
    expect(result).toMatchObject({ ok: true, data: { duplicatedCount: 1, results: [
      { id: 'missing', success: false },
      { id: 'source', success: true, entry: { id: 'created', user_id: actor.id, log_date: '2026-10-02', work_done: 'Completed work' } },
    ] } })
    expect(create).toHaveBeenCalledExactlyOnceWith(adminActor, expect.objectContaining({ userId: actor.id, logDate: '2026-10-02', workDone: 'Completed work' }))
    expect(release).not.toHaveBeenCalled()
  })
})
