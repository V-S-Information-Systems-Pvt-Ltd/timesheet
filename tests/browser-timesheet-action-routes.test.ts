import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockWithMobileActor, mockWithIdempotency, mockYesterday, mockDeleteLast } = vi.hoisted(() => ({
  mockWithMobileActor: vi.fn(),
  mockWithIdempotency: vi.fn(),
  mockYesterday: vi.fn(),
  mockDeleteLast: vi.fn(),
}))

vi.mock('@/app/api/v1/_http', () => ({
  withMobileActor: mockWithMobileActor,
  parseJsonBody: vi.fn(async (request: Request) => ({ ok: true as const, body: await request.json() })),
  json: vi.fn((body: unknown, status = 200) => ({ body, status })),
  serviceResultResponse: vi.fn((result: { success: boolean; data?: unknown; code?: string; message?: string; status?: number }, successStatus = 200) => result.success
    ? { body: { data: result.data, error: null }, status: result.status ?? successStatus }
    : { body: { data: null, error: { code: result.code, message: result.message } }, status: result.status }),
  serverError: vi.fn(() => ({ status: 500 })),
}))

vi.mock('@/lib/api/v1/services/timesheets', () => ({
  createYesterdayTimesheetService: mockYesterday,
  deleteLastTimesheetService: mockDeleteLast,
}))

vi.mock('@/lib/idempotency', () => ({ withIdempotency: mockWithIdempotency }))

import { DELETE as deleteLast } from '@/app/api/v1/timesheets/last/route'
import { POST as logYesterday } from '@/app/api/v1/timesheets/yesterday/route'
import { addDaysISO, todayISO } from '@/lib/dates'

const actor = { id: 'u1', email: 'u@example.com', role: 'admin', isActive: true }

beforeEach(() => {
  vi.clearAllMocks()
  mockWithMobileActor.mockImplementation(async (
    _request: Request,
    handler: (auth: { actor: typeof actor }) => Promise<unknown>,
    options?: unknown
  ) => {
    expect(options).toEqual({ allowCookie: true })
    return handler({ actor })
  })
  mockWithIdempotency.mockImplementation(async (
    _request: Request,
    _actorId: string,
    _operation: string,
    _payload: unknown,
    execute: () => Promise<unknown>
  ) => execute())
  mockYesterday.mockResolvedValue({ success: true, data: { success: true } })
  mockDeleteLast.mockResolvedValue({ success: true, data: { success: true } })
})

describe('browser timesheet action routes', () => {
  it('computes yesterday on the server and preserves the target user', async () => {
    const body = {
      projectId: 'p1',
      activityTypeId: 'a1',
      hoursWorked: 4,
      workDone: 'Backfill',
      userId: 'u2',
    }
    const response = await logYesterday(new Request('http://localhost/api/v1/timesheets/yesterday', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })) as unknown as { status: number }

    const expectedDate = addDaysISO(todayISO(), -1)
    expect(response.status).toBe(201)
    expect(mockWithIdempotency).not.toHaveBeenCalled()
    expect(mockYesterday).toHaveBeenCalledWith(actor, { ...body, logDate: expectedDate })
  })

  it('deletes the latest entry through the domain service', async () => {
    const response = await deleteLast(new Request('http://localhost/api/v1/timesheets/last', {
      method: 'DELETE',
    })) as unknown as { status: number }

    expect(response.status).toBe(200)
    expect(mockWithIdempotency).not.toHaveBeenCalled()
    expect(mockDeleteLast).toHaveBeenCalledWith(actor)
  })
})
