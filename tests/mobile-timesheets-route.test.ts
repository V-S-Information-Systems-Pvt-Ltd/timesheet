import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

const {
  mockRequire,
  mockList,
  mockCreate,
  mockGet,
  mockUpdate,
  mockDelete,
  mockSum,
  mockBackfill,
  mockLatest,
} = vi.hoisted(() => ({
  mockRequire: vi.fn(),
  mockList: vi.fn(),
  mockCreate: vi.fn(),
  mockGet: vi.fn(),
  mockUpdate: vi.fn(),
  mockDelete: vi.fn(),
  mockSum: vi.fn(),
  mockBackfill: vi.fn(),
  mockLatest: vi.fn(),
}))

vi.mock('@/app/api/v1/_http', () => ({
  requireMobileActor: mockRequire,
  withMobileActor: vi.fn(async (req: Request, fn: (auth: unknown) => Promise<unknown>) => {
    const auth = (await mockRequire(req)) as { ok: boolean; response?: unknown }
    if (!auth.ok) return auth.response
    return fn(auth)
  }),
  withMobileSession: vi.fn(async (req: Request, fn: (auth: unknown) => Promise<unknown>) => {
    const auth = (await mockRequire(req)) as { ok: boolean; response?: unknown }
    if (!auth.ok) return auth.response
    return fn(auth)
  }),
  json: vi.fn((body: unknown, status = 200) => ({ body, status })),
  apiError: vi.fn((code: string, message: string, status: number) => ({
    body: { error: { code, message } },
    status,
  })),
  serviceResultResponse: vi.fn((result: { success: boolean; data?: unknown; code?: string; message?: string; status?: number }, successStatus = 200) => result.success
    ? { body: { data: result.data, error: null }, status: result.status ?? successStatus }
    : { body: { data: null, error: { code: result.code, message: result.message } }, status: result.status }),
  serverError: vi.fn(() => ({ status: 500 })),
  parseJsonBody: vi.fn(async (request: Request) => ({ ok: true as const, body: await request.json() })),
}))

import { dailyWriteBudget } from '@/lib/domain/write-budget'

vi.mock('@/lib/db/timesheets', () => ({
  timesheetPersistence: {
    list: mockList,
    create: mockCreate,
    getById: mockGet,
    update: mockUpdate,
    remove: mockDelete,
    sumHoursForUserDate: mockSum,
    getBackfillWindow: mockBackfill,
    getLatest: mockLatest,
  },
  timesheetDeps: (overrides: { writeBudget?: typeof dailyWriteBudget } = {}) => ({
    persistence: {
      list: mockList,
      create: mockCreate,
      getById: mockGet,
      update: mockUpdate,
      remove: mockDelete,
      sumHoursForUserDate: mockSum,
      getBackfillWindow: mockBackfill,
      getLatest: mockLatest,
    },
    clock: () => '2026-09-12',
    writeBudget: overrides.writeBudget ?? dailyWriteBudget,
  }),
}))

import { GET, POST } from '@/app/api/v1/timesheets/route'
import { PUT, DELETE } from '@/app/api/v1/timesheets/[id]/route'
import { createYesterdayTimesheetService, deleteLastTimesheetService } from '@/lib/api/v1/services/timesheets'
import { setRateLimitStore, resetLocalRateLimitWindows, reserveRateLimit, RATE_LIMIT_DAILY } from '@/lib/rate-limit'
import { createRateLimitFake, type RateLimitFake } from './helpers/rate-limit-store'

const actor = {
  id: 'user-1', email: 'u@example.com', role: 'user' as const,
  permission_role: 'user' as const, hierarchy_role: 'user' as const, isActive: true,
}

let rateLimitFake: RateLimitFake

beforeEach(() => {
  vi.clearAllMocks()
  rateLimitFake = createRateLimitFake()
  setRateLimitStore(rateLimitFake)
  mockRequire.mockResolvedValue({ ok: true, actor, sessionId: 'session-1' })
  mockList.mockResolvedValue({ rows: [], count: 0 })
  mockBackfill.mockResolvedValue({ mode: 'days', windowDays: 30, extraDays: 0 })
  mockSum.mockResolvedValue(0)
  mockCreate.mockResolvedValue({ error: null })
  mockUpdate.mockResolvedValue({ error: null })
  mockDelete.mockResolvedValue({ error: null })
  mockLatest.mockResolvedValue(null)
})

afterEach(() => {
  setRateLimitStore(null)
  resetLocalRateLimitWindows()
})

describe('/api/v1/timesheets', () => {
  it('preserves yesterday backfill failure wording and target-user authorization', async () => {
    const input = {
      projectId: 'p1', activityTypeId: 'a1', hoursWorked: 5,
      workDone: 'Backfill', logDate: '2026-09-11',
    }
    expect(await createYesterdayTimesheetService(actor, { ...input, userId: 'other-user' }))
      .toMatchObject({ success: false, status: 403, message: 'Only admins can backfill for other users.' })
    mockBackfill.mockResolvedValue({ mode: 'days', windowDays: 0, extraDays: 0 })
    expect(await createYesterdayTimesheetService(actor, input))
      .toMatchObject({ success: false, message: 'Yesterday is outside the writable backfill window.' })
    mockBackfill.mockResolvedValue({ mode: 'days', windowDays: 30, extraDays: 0 })
    mockSum.mockResolvedValue(22)
    expect(await createYesterdayTimesheetService(actor, input)).toMatchObject({
      success: false,
      message: 'Daily total would exceed 24 hours (22h already logged for yesterday).',
    })
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('undo resolves the current actor latest entry and preserves empty and date-window cases', async () => {
    expect(await deleteLastTimesheetService(actor)).toMatchObject({ success: false, message: 'No entries to undo.' })
    mockLatest.mockResolvedValue({ id: 'old', user_id: actor.id, log_date: '2026-01-01' })
    expect(await deleteLastTimesheetService(actor))
      .toMatchObject({ success: false, message: 'This date is outside the writable backfill window.' })
    expect(mockDelete).not.toHaveBeenCalled()
    mockLatest.mockResolvedValue({ id: 'latest', user_id: actor.id, log_date: '2026-09-12' })
    expect(await deleteLastTimesheetService(actor)).toEqual({ success: true, data: { success: true } })
    expect(mockLatest).toHaveBeenCalledWith(actor, actor.id)
    expect(mockDelete).toHaveBeenCalledWith(actor, 'latest')
  })
  it('passes validated filters to the repository on GET and maps to TimesheetEntryDto', async () => {
    mockList.mockResolvedValue({
      rows: [
        {
          id: 'ts-1',
          user_id: 'user-1',
          project_id: 'proj-1',
          activity_type_id: 'act-1',
          log_date: '2026-08-01',
          hours_worked: 7.5,
          work_done: 'Feature work',
          created_at: '2026-08-01T10:00:00Z',
          projects: { name: 'Alpha' },
          activity_types: { name: 'Coding' },
          profiles: { email: 'u@example.com' },
        },
      ],
      count: 1,
    })

    const response = (await GET(
      new Request('http://localhost/api/v1/timesheets?dateFrom=2026-08-01&limit=10')
    )) as unknown as {
      status: number
      body: {
        data: {
          rows: Array<{
            id: string
            project_name?: string
            activity_name?: string
            user_email?: string
            hours_worked: number
          }>
          count: number
        }
      }
    }
    expect(response.status).toBe(200)
    expect(response.body.data.count).toBe(1)
    expect(response.body.data.rows[0]).toEqual({
      id: 'ts-1',
      user_id: 'user-1',
      user_email: 'u@example.com',
      project_id: 'proj-1',
      project_name: 'Alpha',
      activity_type_id: 'act-1',
      activity_name: 'Coding',
      log_date: '2026-08-01',
      hours_worked: 7.5,
      work_done: 'Feature work',
      created_at: '2026-08-01T10:00:00Z',
    })
    expect(mockList).toHaveBeenCalledWith(actor, { dateFrom: '2026-08-01', limit: 10 })
  })

  it('preserves every legacy read filter on the versioned resource', async () => {
    mockList.mockResolvedValueOnce({ rows: [], count: 0 })

    const response = (await GET(
      new Request(
        'http://localhost/api/v1/timesheets?from=5&to=14&limit=10&userId=user-2&dateFrom=2026-08-01&dateTo=2026-08-31'
      )
    )) as unknown as { status: number }

    expect(response.status).toBe(200)
    expect(mockList).toHaveBeenCalledWith(actor, {
      from: 5,
      to: 14,
      limit: 10,
      userId: 'user-2',
      dateFrom: '2026-08-01',
      dateTo: '2026-08-31',
    })
  })

  it('rejects malformed GET filters before calling the service', async () => {
    const response = (await GET(
      new Request('http://localhost/api/v1/timesheets?from=not-an-integer')
    )) as unknown as {
      status: number
      body: { error: { code: string; message: string } }
    }

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('VALIDATION_ERROR')
    expect(response.body.error.message).toContain('from')
    expect(mockList).not.toHaveBeenCalled()
  })

  it('creates timesheet entry on valid POST', async () => {
    const body = {
      projectId: 'proj-1',
      activityTypeId: 'act-1',
      hoursWorked: 7.5,
      workDone: 'Implemented feature',
      logDate: '2026-08-26',
    }
    const response = (await POST(
      new Request('http://localhost/api/v1/timesheets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    )) as unknown as { status: number; body: { data: { success: boolean } } }

    expect(response.status).toBe(201)
    expect(response.body.data).toEqual({ success: true })
    expect(mockCreate).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({
        projectId: 'proj-1',
        hoursWorked: 7.5,
        logDate: '2026-08-26',
      })
    )
  })

  it('rejects POST exceeding 24 hours daily total', async () => {
    mockSum.mockResolvedValue(20)
    const body = {
      projectId: 'proj-1',
      activityTypeId: 'act-1',
      hoursWorked: 5,
      workDone: 'Overtime work',
      logDate: '2026-08-26',
    }
    const response = (await POST(
      new Request('http://localhost/api/v1/timesheets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    )) as unknown as { status: number; body: { error: { message: string } } }

    expect(response.status).toBe(400)
    expect(response.body.error.message).toMatch(/exceed 24 hours/i)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('returns field-level validation errors on invalid browser-compatible POST input', async () => {
    const response = (await POST(
      new Request('http://localhost/api/v1/timesheets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: '',
          activityTypeId: '',
          hoursWorked: -1,
          workDone: '',
          logDate: '2026-08-26',
        }),
      })
    )) as unknown as {
      status: number
      body: { error: { code: string; fieldErrors: Record<string, string[]> } }
    }

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('VALIDATION_ERROR')
    expect(response.body.error.fieldErrors.projectId?.[0]).toBe('Project is required.')
    expect(response.body.error.fieldErrors.hoursWorked?.[0]).toMatch(/greater than zero/i)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('updates entry on valid PUT', async () => {
    mockGet.mockResolvedValue({
      id: 'ts-1',
      user_id: 'user-1',
      log_date: '2026-08-26',
      hours_worked: 4,
    })
    const body = {
      projectId: 'proj-2',
      activityTypeId: 'act-2',
      hoursWorked: 6,
      workDone: 'Updated work description',
      logDate: '2026-08-26',
    }
    const response = (await PUT(
      new Request('http://localhost/api/v1/timesheets/ts-1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ id: 'ts-1' }) }
    )) as unknown as { status: number; body: { data: { success: boolean } } }

    expect(response.status).toBe(200)
    expect(mockUpdate).toHaveBeenCalledWith(
      actor,
      'ts-1',
      expect.objectContaining({ projectId: 'proj-2', hoursWorked: 6 })
    )
  })

  it('deletes own entry on DELETE', async () => {
    mockGet.mockResolvedValue({
      id: 'ts-1',
      user_id: 'user-1',
      log_date: '2026-08-26',
    })
    const response = (await DELETE(new Request('http://localhost/api/v1/timesheets/ts-1'), {
      params: Promise.resolve({ id: 'ts-1' }),
    })) as unknown as { status: number }

    expect(response.status).toBe(200)
    expect(mockDelete).toHaveBeenCalledWith(actor, 'ts-1')
  })

  it('rejects POST when daily write budget is exhausted with 429 RATE_LIMITED', async () => {
    for (let i = 0; i < RATE_LIMIT_DAILY; i++) {
      await reserveRateLimit('daily-writes', 'writes:user-1')
    }
    const body = {
      projectId: 'proj-1',
      activityTypeId: 'act-1',
      hoursWorked: 7.5,
      workDone: 'Implemented feature',
      logDate: '2026-08-26',
    }
    const response = (await POST(
      new Request('http://localhost/api/v1/timesheets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    )) as unknown as { status: number; body: { error: { code: string } } }

    expect(response.status).toBe(429)
    expect(response.body.error.code).toBe('RATE_LIMITED')
    expect(mockCreate).not.toHaveBeenCalled()
  })
})
