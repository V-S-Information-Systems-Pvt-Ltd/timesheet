import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

const { mockRequire, mockList, mockCreate, mockUpdate, mockDelete } = vi.hoisted(() => ({
  mockRequire: vi.fn(),
  mockList: vi.fn(),
  mockCreate: vi.fn(),
  mockUpdate: vi.fn(),
  mockDelete: vi.fn(),
}))

vi.mock('@/app/api/v1/_http', () => ({
  requireMobileActor: mockRequire,
  withMobileActor: vi.fn(async (req: Request, fn: (auth: unknown) => Promise<unknown>, options?: unknown) => {
    const auth = (await mockRequire(req, options)) as { ok: boolean; response?: unknown }
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
  serviceResultResponse: vi.fn((result: { success: boolean; data?: unknown; code?: string; message?: string; status?: number; fieldErrors?: Record<string, string[]> }, successStatus = 200) => result.success
    ? { body: { data: result.data, error: null }, status: result.status ?? successStatus }
    : {
        body: {
          data: null,
          error: {
            code: result.code,
            message: result.message,
            ...(result.fieldErrors ? { fieldErrors: result.fieldErrors } : {}),
          },
        },
        status: result.status,
      }),
  serverError: vi.fn(() => ({ status: 500 })),
  parseJsonBody: vi.fn(async (request: Request) => ({ ok: true as const, body: await request.json() })),
}))

import { dailyWriteBudget } from '@/lib/domain/write-budget'

vi.mock('@/lib/db/leave-reminders', () => ({
  leaveReminderPersistence: {
    listReminders: mockList,
    createReminder: mockCreate,
    updateReminder: mockUpdate,
    deleteReminder: mockDelete,
  },
  leaveReminderDeps: (overrides: { writeBudget?: typeof dailyWriteBudget } = {}) => ({
    persistence: {
      listReminders: mockList,
      createReminder: mockCreate,
      updateReminder: mockUpdate,
      deleteReminder: mockDelete,
    },
    writeBudget: overrides.writeBudget ?? dailyWriteBudget,
  }),
}))

import { GET, POST } from '@/app/api/v1/reminders/route'
import { PATCH, DELETE } from '@/app/api/v1/reminders/[id]/route'
import { setRateLimitStore, resetLocalRateLimitWindows, reserveRateLimit, RATE_LIMIT_DAILY } from '@/lib/rate-limit'
import { createRateLimitFake, type RateLimitFake } from './helpers/rate-limit-store'

const actor = { id: 'user-1', email: 'u@example.com', role: 'user', isActive: true }

let rateLimitFake: RateLimitFake

beforeEach(() => {
  vi.clearAllMocks()
  rateLimitFake = createRateLimitFake()
  setRateLimitStore(rateLimitFake)
  mockRequire.mockResolvedValue({ ok: true, actor, sessionId: 'session-1' })
  mockList.mockResolvedValue([])
  mockCreate.mockResolvedValue({ error: null })
  mockUpdate.mockResolvedValue({ error: null })
  mockDelete.mockResolvedValue({ error: null })
})

afterEach(() => {
  setRateLimitStore(null)
  resetLocalRateLimitWindows()
})

describe('/api/v1/reminders', () => {
  it('lists reminders on GET', async () => {
    const request = new Request('http://localhost/api/v1/reminders')
    const response = (await GET(request)) as unknown as {
      status: number
      body: { data: unknown }
    }
    expect(response.status).toBe(200)
    expect(mockRequire).toHaveBeenCalledWith(request, { allowCookie: true })
    expect(mockList).toHaveBeenCalledWith(actor, 'user-1')
  })

  it('creates reminder on valid POST', async () => {
    const body = {
      message: 'Submit monthly timesheet',
      remindAt: '2026-08-31T09:00:00.000Z',
    }
    const request = new Request('http://localhost/api/v1/reminders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const response = (await POST(request)) as unknown as { status: number; body: { data: { success: boolean } } }

    expect(response.status).toBe(201)
    expect(mockRequire).toHaveBeenCalledWith(request, { allowCookie: true })
    expect(mockCreate).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({
        userId: 'user-1',
        message: 'Submit monthly timesheet',
      })
    )
  })

  it('updates reminder done state on PATCH', async () => {
    const request = new Request('http://localhost/api/v1/reminders/rem-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ done: true }),
    })
    const response = (await PATCH(
      request,
      { params: Promise.resolve({ id: 'rem-1' }) }
    )) as unknown as { status: number }

    expect(response.status).toBe(200)
    expect(mockRequire).toHaveBeenCalledWith(request, { allowCookie: true })
    expect(mockUpdate).toHaveBeenCalledWith(actor, 'rem-1', { done: true })
  })

  it('deletes reminder on DELETE', async () => {
    const request = new Request('http://localhost/api/v1/reminders/rem-1')
    const response = (await DELETE(request, {
      params: Promise.resolve({ id: 'rem-1' }),
    })) as unknown as { status: number }

    expect(response.status).toBe(200)
    expect(mockRequire).toHaveBeenCalledWith(request, { allowCookie: true })
    expect(mockDelete).toHaveBeenCalledWith(actor, 'rem-1')
  })

  it('rejects POST when daily write budget is exhausted with 429 RATE_LIMITED', async () => {
    for (let i = 0; i < RATE_LIMIT_DAILY; i++) {
      await reserveRateLimit('daily-writes', 'writes:user-1')
    }
    const body = {
      message: 'Submit monthly timesheet',
      remindAt: '2026-08-31T09:00:00.000Z',
    }
    const response = (await POST(
      new Request('http://localhost/api/v1/reminders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    )) as unknown as { status: number; body: { error: { code: string } } }

    expect(response.status).toBe(429)
    expect(response.body.error.code).toBe('RATE_LIMITED')
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('preserves validation field errors for browser-compatible POST callers', async () => {
    const response = (await POST(
      new Request('http://localhost/api/v1/reminders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: '', remindAt: 'not-a-date' }),
      })
    )) as unknown as {
      status: number
      body: { error: { code: string; fieldErrors?: Record<string, string[]> } }
    }

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('VALIDATION_ERROR')
    expect(response.body.error.fieldErrors).toBeDefined()
    expect(mockCreate).not.toHaveBeenCalled()
  })
})
