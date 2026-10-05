import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

const { mockRequire, mockList, mockCreate, mockDelete } = vi.hoisted(() => ({
  mockRequire: vi.fn(),
  mockList: vi.fn(),
  mockCreate: vi.fn(),
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
    const auth = (await mockRequire(req, { allowInactive: true })) as { ok: boolean; response?: unknown }
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
    listLeaves: mockList,
    createLeaves: mockCreate,
    deleteLeave: mockDelete,
  },
  unthrottledWriteBudget: {
    reserve: async () => ({ ok: true, reservation: { release: async () => {} } }),
  },
  leaveReminderDeps: (overrides: { writeBudget?: typeof dailyWriteBudget } = {}) => ({
    persistence: {
      listLeaves: mockList,
      createLeaves: mockCreate,
      deleteLeave: mockDelete,
    },
    writeBudget: overrides.writeBudget ?? dailyWriteBudget,
  }),
}))

import { GET, POST } from '@/app/api/v1/leaves/route'
import { DELETE } from '@/app/api/v1/leaves/[id]/route'
import { setRateLimitStore, resetLocalRateLimitWindows, reserveRateLimit, RATE_LIMIT_DAILY } from '@/lib/rate-limit'
import { createRateLimitFake, type RateLimitFake } from './helpers/rate-limit-store'

const actor = { id: 'user-1', email: 'u@example.com', role: 'user', isActive: true }

let rateLimitFake: RateLimitFake

beforeEach(() => {
  vi.clearAllMocks()
  rateLimitFake = createRateLimitFake()
  setRateLimitStore(rateLimitFake)
  mockRequire.mockResolvedValue({ ok: true, via: 'bearer', actor, sessionId: 'session-1' })
  mockList.mockResolvedValue([])
  mockCreate.mockResolvedValue({ error: null })
  mockDelete.mockResolvedValue({ error: null })
})

afterEach(() => {
  setRateLimitStore(null)
  resetLocalRateLimitWindows()
})

describe('/api/v1/leaves', () => {
  it('lists leaves for authenticated user on GET', async () => {
    const request = new Request('http://localhost/api/v1/leaves?from=2026-08-01&to=2026-08-31')
    const response = (await GET(request)) as unknown as { status: number; body: { data: unknown } }

    expect(response.status).toBe(200)
    expect(mockRequire).toHaveBeenCalledWith(request, { allowCookie: true })
    expect(mockList).toHaveBeenCalledWith(actor, { from: '2026-08-01', to: '2026-08-31' })
  })

  it('creates leave entries on valid POST', async () => {
    const body = {
      rows: [
        {
          userId: 'user-1',
          leaveDate: '2026-08-28',
          reason: 'Medical appointment',
        },
      ],
    }
    const request = new Request('http://localhost/api/v1/leaves', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const response = (await POST(request)) as unknown as { status: number; body: { data: { success: boolean } } }

    expect(response.status).toBe(201)
    expect(mockRequire).toHaveBeenCalledWith(request, { allowCookie: true })
    expect(mockCreate).toHaveBeenCalledWith(actor, body.rows)
  })

  it('deletes leave on DELETE', async () => {
    const request = new Request('http://localhost/api/v1/leaves/leaf-1')
    const response = (await DELETE(request, {
      params: Promise.resolve({ id: 'leaf-1' }),
    })) as unknown as { status: number }

    expect(response.status).toBe(200)
    expect(mockRequire).toHaveBeenCalledWith(request, { allowCookie: true })
    expect(mockDelete).toHaveBeenCalledWith(actor, 'leaf-1')
  })

  it('rejects POST when daily write budget is exhausted with 429 RATE_LIMITED', async () => {
    for (let i = 0; i < RATE_LIMIT_DAILY; i++) {
      await reserveRateLimit('daily-writes', 'writes:user-1')
    }
    const body = {
      rows: [
        {
          userId: 'user-1',
          leaveDate: '2026-08-28',
          reason: 'Medical appointment',
        },
      ],
    }
    const response = (await POST(
      new Request('http://localhost/api/v1/leaves', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    )) as unknown as { status: number; body: { error: { code: string } } }

    expect(response.status).toBe(429)
    expect(response.body.error.code).toBe('RATE_LIMITED')
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('preserves the browser cookie write policy when the mobile daily budget is exhausted', async () => {
    for (let i = 0; i < RATE_LIMIT_DAILY; i++) {
      await reserveRateLimit('daily-writes', 'writes:user-1')
    }
    mockRequire.mockResolvedValue({ ok: true, via: 'cookie', actor })

    const body = {
      rows: [{ userId: 'user-1', leaveDate: '2026-08-28', reason: 'Medical appointment' }],
    }
    const createResponse = (await POST(new Request('http://localhost/api/v1/leaves', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }))) as unknown as { status: number }
    expect(createResponse.status).toBe(201)
    expect(mockCreate).toHaveBeenCalledWith(actor, body.rows)

    const deleteResponse = (await DELETE(new Request('http://localhost/api/v1/leaves/leaf-1', {
      method: 'DELETE',
    }), { params: Promise.resolve({ id: 'leaf-1' }) })) as unknown as { status: number }
    expect(deleteResponse.status).toBe(200)
    expect(mockDelete).toHaveBeenCalledWith(actor, 'leaf-1')
  })

  it('preserves validation field errors for browser-compatible POST callers', async () => {
    const response = (await POST(
      new Request('http://localhost/api/v1/leaves', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: 'not-an-array' }),
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
