import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

const {
  mockRequire,
  mockCreate,
  mockGet,
  mockSum,
  mockBackfill,
  mockWithIdempotency,
} = vi.hoisted(() => ({
  mockRequire: vi.fn(),
  mockCreate: vi.fn(),
  mockGet: vi.fn(),
  mockSum: vi.fn(),
  mockBackfill: vi.fn(),
  mockWithIdempotency: vi.fn(),
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
  json: vi.fn((body: unknown, init?: number | { status?: number }) => ({
    body,
    status: typeof init === 'number' ? init : (init?.status ?? 200),
  })),
  apiError: vi.fn((code: string, message: string, status: number) => ({
    body: { error: { code, message } },
    status,
  })),
  serviceResultResponse: vi.fn((result: { success: boolean; data?: unknown; code?: string; message?: string; status?: number }, successStatus = 200) => result.success
    ? { body: { data: result.data, error: null }, status: result.status ?? successStatus }
    : { body: { data: null, error: { code: result.code, message: result.message } }, status: result.status }),
  serverError: vi.fn(() => ({ status: 500 })),
}))

vi.mock('@/lib/idempotency', () => ({
  withIdempotency: mockWithIdempotency,
}))

vi.mock('@/lib/db', () => ({
  repo: {
    createTimesheet: mockCreate,
    getTimesheet: mockGet,
    sumHoursForUserDate: mockSum,
    getBackfillWindow: mockBackfill,
  },
}))

import { POST } from '@/app/api/v1/timesheets/[id]/duplicate/route'
import { setRateLimitStore, resetLocalRateLimitWindows } from '@/lib/rate-limit'
import { createRateLimitFake, type RateLimitFake } from './helpers/rate-limit-store'

const actor = { id: 'user-1', email: 'u@example.com', role: 'user', isActive: true }

let rateLimitFake: RateLimitFake

beforeEach(() => {
  vi.clearAllMocks()
  rateLimitFake = createRateLimitFake()
  setRateLimitStore(rateLimitFake)
  mockRequire.mockResolvedValue({ ok: true, actor, sessionId: 'session-1' })
  mockBackfill.mockResolvedValue({ mode: 'days', windowDays: 30, extraDays: 0 })
  mockSum.mockResolvedValue(0)
  mockCreate.mockResolvedValue({ id: 'ts-dup-1', error: null })

  const idempotencyStore = new Map<string, { fingerprint: string; response: unknown }>()
  mockWithIdempotency.mockImplementation(
    async (
      request: Request,
      actorId: string,
      operation: string,
      payload: unknown,
      execute: () => Promise<unknown>
    ) => {
      const key = request.headers.get('idempotency-key') || request.headers.get('x-idempotency-key')
      if (!key) return execute()
      const fp = JSON.stringify(payload)
      const composite = `${key}:${actorId}:${operation}`
      const existing = idempotencyStore.get(composite)
      if (existing) {
        if (existing.fingerprint !== fp) {
          return {
            body: {
              data: null,
              error: {
                code: 'IDEMPOTENCY_CONFLICT',
                message: 'Idempotency key reused with different payload.',
              },
            },
            status: 409,
          }
        }
        return existing.response
      }
      const res = await execute()
      idempotencyStore.set(composite, { fingerprint: fp, response: res })
      return res
    }
  )

  mockGet.mockImplementation((_, id: string) => {
    if (id === 'ts-1') {
      return Promise.resolve({
        id: 'ts-1',
        user_id: 'user-1',
        project_id: 'proj-1',
        activity_type_id: 'act-1',
        log_date: '2026-08-26',
        hours_worked: 7.5,
        work_done: 'Architecture review',
        projects: { name: 'Project Alpha' },
        activity_types: { name: 'Engineering' },
        profiles: { email: 'u@example.com' },
      })
    }
    if (id === 'ts-dup-1') {
      return Promise.resolve({
        id: 'ts-dup-1',
        user_id: 'user-1',
        project_id: 'proj-1',
        activity_type_id: 'act-1',
        log_date: '2026-08-26',
        hours_worked: 7.5,
        work_done: 'Architecture review',
        projects: { name: 'Project Alpha' },
        activity_types: { name: 'Engineering' },
        profiles: { email: 'u@example.com' },
      })
    }
    return Promise.resolve(null)
  })
})

afterEach(() => {
  setRateLimitStore(null)
  resetLocalRateLimitWindows()
})

describe('POST /api/v1/timesheets/[id]/duplicate', () => {
  it('duplicates own timesheet entry on valid POST and returns mapped DTO', async () => {
    const response = (await POST(
      new Request('http://localhost/api/v1/timesheets/ts-1/duplicate', {
        method: 'POST',
      }),
      { params: Promise.resolve({ id: 'ts-1' }) }
    )) as unknown as {
      status: number
      body: { data: { success: boolean; entry: { id: string; project_id: string; hours_worked: number } } }
    }

    expect(response.status).toBe(201)
    expect(response.body.data.success).toBe(true)
    expect(response.body.data.entry.id).toBe('ts-dup-1')
    expect(response.body.data.entry.project_id).toBe('proj-1')
    expect(response.body.data.entry.hours_worked).toBe(7.5)
    expect(mockCreate).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({
        userId: 'user-1',
        projectId: 'proj-1',
        activityTypeId: 'act-1',
        hoursWorked: 7.5,
        workDone: 'Architecture review',
        logDate: '2026-08-26',
      })
    )
  })

  it('allows overriding targetDate in request body', async () => {
    const response = (await POST(
      new Request('http://localhost/api/v1/timesheets/ts-1/duplicate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetDate: '2026-08-27' }),
      }),
      { params: Promise.resolve({ id: 'ts-1' }) }
    )) as unknown as { status: number }

    expect(response.status).toBe(201)
    expect(mockCreate).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({
        logDate: '2026-08-27',
      })
    )
  })

  it('rejects duplicate if daily cap would exceed 24 hours', async () => {
    mockSum.mockResolvedValue(18) // 18 + 7.5 = 25.5 > 24

    const response = (await POST(
      new Request('http://localhost/api/v1/timesheets/ts-1/duplicate', {
        method: 'POST',
      }),
      { params: Promise.resolve({ id: 'ts-1' }) }
    )) as unknown as { status: number; body: { error: { message: string } } }

    expect(response.status).toBe(400)
    expect(response.body.error.message).toMatch(/exceed 24 hours/i)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('rejects duplicate if target entry belongs to another user and actor is not admin', async () => {
    mockGet.mockResolvedValueOnce({
      id: 'ts-other',
      user_id: 'user-999',
      log_date: '2026-08-26',
      hours_worked: 4,
    })

    const response = (await POST(
      new Request('http://localhost/api/v1/timesheets/ts-other/duplicate', {
        method: 'POST',
      }),
      { params: Promise.resolve({ id: 'ts-other' }) }
    )) as unknown as { status: number; body: { error: { code: string } } }

    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('FORBIDDEN')
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('keyed replay returns stored response without re-executing', async () => {
    const req1 = new Request('http://localhost/api/v1/timesheets/ts-1/duplicate', {
      method: 'POST',
      headers: { 'idempotency-key': 'dup-key-1' },
    })
    const res1 = (await POST(req1, { params: Promise.resolve({ id: 'ts-1' }) })) as unknown as {
      status: number
      body: { data: { success: boolean; entry: { id: string } } }
    }
    expect(res1.status).toBe(201)
    expect(res1.body.data.entry.id).toBe('ts-dup-1')
    expect(mockCreate).toHaveBeenCalledTimes(1)

    // Second call with same idempotency key
    const req2 = new Request('http://localhost/api/v1/timesheets/ts-1/duplicate', {
      method: 'POST',
      headers: { 'idempotency-key': 'dup-key-1' },
    })
    const res2 = (await POST(req2, { params: Promise.resolve({ id: 'ts-1' }) })) as unknown as {
      status: number
      body: { data: { success: boolean; entry: { id: string } } }
    }
    expect(res2.status).toBe(201)
    expect(res2.body.data.entry.id).toBe('ts-dup-1')
    // Crucial: mockCreate was NOT re-executed!
    expect(mockCreate).toHaveBeenCalledTimes(1)
  })

  it('rejects duplicate with 409 conflict when idempotency key is reused with different payload', async () => {
    const req1 = new Request('http://localhost/api/v1/timesheets/ts-1/duplicate', {
      method: 'POST',
      headers: {
        'idempotency-key': 'dup-conflict-key',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ targetDate: '2026-08-26' }),
    })
    const res1 = (await POST(req1, { params: Promise.resolve({ id: 'ts-1' }) })) as unknown as { status: number }
    expect(res1.status).toBe(201)
    expect(mockCreate).toHaveBeenCalledTimes(1)

    // Reusing same key with different targetDate (different payload fingerprint)
    const req2 = new Request('http://localhost/api/v1/timesheets/ts-1/duplicate', {
      method: 'POST',
      headers: {
        'idempotency-key': 'dup-conflict-key',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ targetDate: '2026-08-27' }),
    })
    const res2 = (await POST(req2, { params: Promise.resolve({ id: 'ts-1' }) })) as unknown as {
      status: number
      body: { error: { code: string } }
    }
    expect(res2.status).toBe(409)
    expect(res2.body.error.code).toBe('IDEMPOTENCY_CONFLICT')
    expect(mockCreate).toHaveBeenCalledTimes(1)
  })
})
