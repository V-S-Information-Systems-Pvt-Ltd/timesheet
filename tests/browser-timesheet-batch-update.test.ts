import { beforeEach, describe, expect, it, vi } from 'vitest'

const { persistence, reserve, release } = vi.hoisted(() => ({
  persistence: {
    getByIds: vi.fn(), getBackfillWindow: vi.fn(),
    sumHoursForUserDates: vi.fn(), bulkUpdate: vi.fn(),
  },
  reserve: vi.fn(), release: vi.fn(),
}))

vi.mock('@/lib/db/timesheets', () => ({
  timesheetPersistence: persistence,
  timesheetDeps: () => ({ persistence, clock: () => '2026-09-26', writeBudget: { reserve } }),
}))
vi.mock('@/app/api/v1/_http', async () => {
  const actual = await vi.importActual<typeof import('@/app/api/v1/_http')>('@/app/api/v1/_http')
  return {
    ...actual,
    withMobileActor: vi.fn(async (_request, handler, options) => {
      expect(options).toEqual({ allowCookie: true })
      return handler({ actor, requestId: 'test', startTime: performance.now() })
    }),
  }
})

import { POST } from '@/app/api/v1/timesheets/batch-update/route'

const actor = { id: 'u1', email: 'u@example.com', role: 'user' as const, permission_role: 'user' as const, hierarchy_role: 'user' as const, isActive: true }
const entry = { id: 't1', projectId: 'p1', activityTypeId: 'a1', hoursWorked: 4, workDone: 'Work', logDate: '2026-09-26' }
function request(entries: unknown) {
  return new Request('http://localhost/api/v1/timesheets/batch-update', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ entries }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  reserve.mockResolvedValue({ ok: true, reservation: { release } })
  release.mockResolvedValue(undefined)
  persistence.getBackfillWindow.mockResolvedValue({ mode: 'days', windowDays: 30, extraDays: 0 })
  persistence.getByIds.mockResolvedValue([{ id: 't1', user_id: 'u1', hours_worked: 2, log_date: '2026-09-26' }])
  persistence.sumHoursForUserDates.mockResolvedValue(new Map())
  persistence.bulkUpdate.mockResolvedValue({ updated: 1, rowErrors: [], error: null })
})

describe('browser bulk-edit route and domain lifecycle', () => {
  it('keeps row validation partial and charges the batch once', async () => {
    const response = await POST(request([entry, { ...entry, id: 't2', projectId: '' }]))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data.updated).toBe(1)
    expect(body.data.errors).toEqual(['Entry t2: projectId: Project is required.'])
    expect(persistence.bulkUpdate).toHaveBeenCalledWith(actor, [expect.objectContaining({ id: 't1' })])
    expect(reserve).toHaveBeenCalledExactlyOnceWith('u1')
    expect(release).not.toHaveBeenCalled()
  })

  it('keeps all-failed row details and refunds the single reservation', async () => {
    persistence.getByIds.mockResolvedValue([])
    const response = await POST(request([entry]))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ data: { updated: 0, errors: ['Entry t1: not found'] }, error: null })
    expect(reserve).toHaveBeenCalledTimes(1)
    expect(release).toHaveBeenCalledTimes(1)
    expect(persistence.bulkUpdate).not.toHaveBeenCalled()
  })

  it.each([
    [[], 'No entries selected.'],
    [Array.from({ length: 501 }, () => entry), 'Too many entries for one edit (max 500).'],
  ])('rejects bounded payload failures before charging', async (entries, message) => {
    const response = await POST(request(entries))
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: { message } })
    expect(reserve).not.toHaveBeenCalled()
    expect(persistence.getByIds).not.toHaveBeenCalled()
  })

  it('accepts the 500-row upper boundary', async () => {
    persistence.getByIds.mockResolvedValue([])
    const response = await POST(request(Array.from({ length: 500 }, (_, i) => ({ ...entry, id: `t${i}` }))))
    expect(response.status).toBe(200)
    expect(reserve).toHaveBeenCalledTimes(1)
  })

  it('rejects malformed JSON and null rows before domain work', async () => {
    const malformed = new Request('http://localhost/api/v1/timesheets/batch-update', { method: 'POST', body: '{' })
    expect((await POST(malformed)).status).toBe(400)
    expect((await POST(request([null]))).status).toBe(400)
    expect(reserve).not.toHaveBeenCalled()
  })

  it('retains ownership checks and refunds when all rows are forbidden', async () => {
    persistence.getByIds.mockResolvedValue([{ id: 't1', user_id: 'u2', hours_worked: 2, log_date: '2026-09-26' }])
    const response = await POST(request([entry]))
    expect(await response.json()).toMatchObject({ data: { updated: 0, errors: ['Entry t1: you can only modify your own entries'] } })
    expect(release).toHaveBeenCalledTimes(1)
    expect(persistence.bulkUpdate).not.toHaveBeenCalled()
  })

  it('refunds on a persistence exception and returns a server error', async () => {
    persistence.bulkUpdate.mockRejectedValue(new Error('Database unavailable'))
    expect((await POST(request([entry]))).status).toBe(500)
    expect(reserve).toHaveBeenCalledTimes(1)
    expect(release).toHaveBeenCalledTimes(1)
  })

  it('maps an aggregate write error to a failed response and refunds the batch', async () => {
    persistence.bulkUpdate.mockResolvedValue({ updated: 0, rowErrors: [], error: 'Daily total would exceed 24 hours.' })
    const response = await POST(request([entry]))
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ data: null, error: {
      code: 'VALIDATION_ERROR', message: 'Daily total would exceed 24 hours.',
    } })
    expect(reserve).toHaveBeenCalledTimes(1)
    expect(release).toHaveBeenCalledTimes(1)
  })
})
