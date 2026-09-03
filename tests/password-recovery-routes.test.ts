import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

const {
  mockIssue,
  mockSend,
  mockConsume,
  mockClearCookie,
} = vi.hoisted(() => ({
  mockIssue: vi.fn(),
  mockSend: vi.fn(),
  mockConsume: vi.fn(),
  mockClearCookie: vi.fn(),
}))

vi.mock('@/app/api/_http', () => ({
  json: vi.fn((body: unknown, status = 200, headers?: Record<string, string>) => ({ body, status, headers })),
  originCheck: vi.fn(() => null),
  serverError: vi.fn(() => ({ body: { error: 'Internal server error.' }, status: 500 })),
}))
vi.mock('@/lib/db/password-recovery', () => ({
  issuePasswordResetToken: mockIssue,
  consumePasswordResetToken: mockConsume,
}))
vi.mock('@/lib/email/password-reset', () => ({ sendPasswordResetEmail: mockSend }))
vi.mock('@/lib/auth/native', () => ({ clearSessionCookie: mockClearCookie }))

import { POST as forgotPassword } from '@/app/api/auth/forgot-password/route'
import { POST as resetPassword } from '@/app/api/auth/reset-password/route'
import { setRateLimitStore, resetLocalRateLimitWindows } from '@/lib/rate-limit'
import { createRateLimitFake, type RateLimitFake } from './helpers/rate-limit-store'

function request(path: string, body: unknown, ip = '203.0.113.10'): Request {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'http://localhost',
      host: 'localhost',
      'x-forwarded-for': ip,
    },
    body: JSON.stringify(body),
  })
}

function result(value: unknown): { status: number; body: Record<string, unknown>; headers?: Record<string, string> } {
  return value as { status: number; body: Record<string, unknown>; headers?: Record<string, string> }
}

let rateLimitFake: RateLimitFake

beforeEach(() => {
  vi.clearAllMocks()
  rateLimitFake = createRateLimitFake()
  setRateLimitStore(rateLimitFake)
})

afterEach(() => {
  setRateLimitStore(null)
  resetLocalRateLimitWindows()
})

describe('POST /api/auth/forgot-password', () => {
  it('returns the same generic response for unknown accounts', async () => {
    mockIssue.mockResolvedValueOnce(null)
    const response = result(await forgotPassword(request('/api/auth/forgot-password', { email: 'missing@example.com' })))
    expect(response.status).toBe(200)
    expect(response.body.message).toMatch(/If an account exists/)
    expect(mockSend).not.toHaveBeenCalled()
    expect(response.headers?.['Cache-Control']).toContain('no-store')
  })

  it('emails a known account without returning the raw token', async () => {
    const issued = {
      userId: 'u1',
      email: 'jane@example.com',
      token: 'a'.repeat(43),
      expiresAt: new Date('2026-09-02T12:30:00Z'),
    }
    mockIssue.mockResolvedValueOnce(issued)
    mockSend.mockResolvedValueOnce(undefined)
    const response = result(await forgotPassword(request('/api/auth/forgot-password', { email: 'Jane@Example.com' })))
    expect(response.status).toBe(200)
    expect(response.body.message).toMatch(/If an account exists/)
    expect(JSON.stringify(response.body)).not.toContain(issued.token)
    expect(mockSend).toHaveBeenCalledWith({ to: issued.email, token: issued.token, expiresAt: issued.expiresAt })
  })
})

describe('POST /api/auth/reset-password', () => {
  it('rejects a weak password before consuming a token', async () => {
    const response = result(await resetPassword(request('/api/auth/reset-password', {
      token: 'a'.repeat(43),
      newPassword: 'weak',
    })))
    expect(response.status).toBe(400)
    expect(response.body.error).toMatch(/at least 8 characters/i)
    expect(mockConsume).not.toHaveBeenCalled()
  })

  it('consumes a valid token and clears any native cookie', async () => {
    mockConsume.mockResolvedValueOnce({ ok: true, userId: 'u1' })
    mockClearCookie.mockResolvedValueOnce(undefined)
    const response = result(await resetPassword(request('/api/auth/reset-password', {
      token: 'a'.repeat(43),
      newPassword: 'NewPass1',
    })))
    expect(response.status).toBe(200)
    expect(response.body.error).toBeNull()
    expect(mockConsume).toHaveBeenCalledWith('a'.repeat(43), 'NewPass1')
    expect(mockClearCookie).toHaveBeenCalledTimes(1)
  })

  it('returns an invalid-link error for an already-used token', async () => {
    mockConsume.mockResolvedValueOnce({ ok: false })
    const response = result(await resetPassword(request('/api/auth/reset-password', {
      token: 'b'.repeat(43),
      newPassword: 'NewPass1',
    })))
    expect(response.status).toBe(400)
    expect(response.body.error).toMatch(/invalid or has expired/i)
    expect(mockClearCookie).not.toHaveBeenCalled()
  })
})
