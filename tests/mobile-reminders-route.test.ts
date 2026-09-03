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
  json: vi.fn((body: unknown, status = 200) => ({ body, status })),
  apiError: vi.fn((code: string, message: string, status: number) => ({
    body: { error: { code, message } },
    status,
  })),
  serverError: vi.fn(() => ({ status: 500 })),
}))

vi.mock('@/lib/db', () => ({
  repo: {
    listReminders: mockList,
    createReminder: mockCreate,
    updateReminder: mockUpdate,
    deleteReminder: mockDelete,
  },
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
    const response = (await GET(new Request('http://localhost/api/v1/reminders'))) as unknown as {
      status: number
      body: { data: unknown }
    }
    expect(response.status).toBe(200)
    expect(mockList).toHaveBeenCalledWith(actor, 'user-1')
  })

  it('creates reminder on valid POST', async () => {
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
    )) as unknown as { status: number; body: { data: { success: boolean } } }

    expect(response.status).toBe(201)
    expect(mockCreate).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({
        userId: 'user-1',
        message: 'Submit monthly timesheet',
      })
    )
  })

  it('updates reminder done state on PATCH', async () => {
    const response = (await PATCH(
      new Request('http://localhost/api/v1/reminders/rem-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ done: true }),
      }),
      { params: Promise.resolve({ id: 'rem-1' }) }
    )) as unknown as { status: number }

    expect(response.status).toBe(200)
    expect(mockUpdate).toHaveBeenCalledWith(actor, 'rem-1', { done: true })
  })

  it('deletes reminder on DELETE', async () => {
    const response = (await DELETE(new Request('http://localhost/api/v1/reminders/rem-1'), {
      params: Promise.resolve({ id: 'rem-1' }),
    })) as unknown as { status: number }

    expect(response.status).toBe(200)
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
})
