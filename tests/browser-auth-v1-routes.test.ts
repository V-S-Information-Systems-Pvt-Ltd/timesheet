import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/backend/config', () => ({
  IS_NATIVE: true,
  IS_SUPABASE: false,
}))

vi.mock('@/app/api/_http', async () => {
  const actual = await vi.importActual<typeof import('@/app/api/_http')>('@/app/api/_http')
  return {
    json: vi.fn((body: unknown, status = 200, headers?: Record<string, string>) => ({ body, status, headers })),
    originCheck: actual.originCheck,
    serverError: vi.fn((_err: unknown) => ({ body: { error: 'internal' }, status: 500 })),
  }
})

const { mockSignIn, mockSetSessionCookie, mockSignSessionToken, mockClearSessionCookie } = vi.hoisted(() => ({
  mockSignIn: vi.fn(),
  mockSetSessionCookie: vi.fn(),
  mockSignSessionToken: vi.fn(),
  mockClearSessionCookie: vi.fn(),
}))

vi.mock('@/lib/auth/native', () => ({
  signIn: mockSignIn,
  setSessionCookie: mockSetSessionCookie,
  signSessionToken: mockSignSessionToken,
  clearSessionCookie: mockClearSessionCookie,
}))

vi.mock('@/lib/auth', () => ({
  getSessionUser: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn() },
  extractError: (e: unknown) => String(e),
}))

import { POST as loginPost } from '@/app/api/v1/auth/browser/login/route'
import { POST as logoutPost } from '@/app/api/v1/auth/browser/logout/route'
import { GET as meGet } from '@/app/api/v1/auth/browser/me/route'
import { getSessionUser } from '@/lib/auth'
import { resetLocalRateLimitWindows, setRateLimitStore } from '@/lib/rate-limit'
import { createRateLimitFake, netHeld, type RateLimitFake } from './helpers/rate-limit-store'

interface Res {
  status: number
  body: Record<string, unknown>
  headers?: Record<string, string> | null
}

function rg(res: Response): Res {
  return res as unknown as Res
}

function loginRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/v1/auth/browser/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '5.6.7.8', ...headers },
    body: JSON.stringify(body),
  })
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
  vi.unstubAllEnvs()
})

describe('v1 native browser auth routes', () => {
  it('logs in with a cookie session even when mobile bearer auth is disabled', async () => {
    vi.stubEnv('MOBILE_BEARER_AUTH_ENABLED', 'false')
    const user = { id: 'u1', email: 'u@example.com' }
    mockSignIn.mockResolvedValue({ user, error: null, sessionVersion: 4 })
    mockSignSessionToken.mockResolvedValue('session-token')

    const res = rg(await loginPost(loginRequest({ email: 'U@EXAMPLE.COM', password: 'correct' })))

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ user })
    expect(mockSignIn).toHaveBeenCalledWith('u@example.com', 'correct')
    expect(mockSignSessionToken).toHaveBeenCalledWith(user, 4)
    expect(mockSetSessionCookie).toHaveBeenCalledWith('session-token')
    expect(netHeld(rateLimitFake, 'daily-login')).toBe(0)
  })

  it('keeps failed credentials in the login budget and preserves Retry-After', async () => {
    mockSignIn.mockResolvedValue({ user: null, error: 'Invalid email or password.' })
    for (let i = 0; i < 10; i++) {
      await loginPost(loginRequest({ email: 'u@example.com', password: 'wrong' }))
    }

    expect(netHeld(rateLimitFake, 'daily-login')).toBe(10)
    const res = rg(await loginPost(loginRequest({ email: 'u@example.com', password: 'wrong' })))
    expect(res.status).toBe(429)
    expect(res.body.error).toBe('Too many login attempts. Try again later.')
    expect(res.headers?.['Retry-After']).toBeDefined()
  })

  it('refunds the login budget on server faults', async () => {
    mockSignIn.mockRejectedValue(new Error('database unavailable'))
    const res = rg(await loginPost(loginRequest({ email: 'u@example.com', password: 'correct' })))
    expect(res.status).toBe(500)
    expect(netHeld(rateLimitFake, 'daily-login')).toBe(0)
  })

  it('rejects foreign-origin login before credentials are checked', async () => {
    const res = rg(await loginPost(loginRequest(
      { email: 'u@example.com', password: 'correct' },
      { host: 'localhost', origin: 'https://evil.example.com' }
    )))
    expect(res.status).toBe(403)
    expect(mockSignIn).not.toHaveBeenCalled()
  })

  it('clears the cookie on logout and rejects foreign-origin logout', async () => {
    const ok = rg(await logoutPost(new Request('http://localhost/api/v1/auth/browser/logout', { method: 'POST' })))
    expect(ok.status).toBe(200)
    expect(mockClearSessionCookie).toHaveBeenCalledTimes(1)

    mockClearSessionCookie.mockClear()
    const rejected = rg(await logoutPost(new Request('http://localhost/api/v1/auth/browser/logout', {
      method: 'POST',
      headers: { host: 'localhost', origin: 'https://evil.example.com' },
    })))
    expect(rejected.status).toBe(403)
    expect(mockClearSessionCookie).not.toHaveBeenCalled()
  })

  it('returns the signed-in browser session without applying an active-account gate', async () => {
    const user = { id: 'inactive-user', email: 'inactive@example.com' }
    vi.mocked(getSessionUser).mockResolvedValue(user as never)
    const res = rg(await meGet())
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ user })

    vi.mocked(getSessionUser).mockResolvedValue(null)
    const anonymous = rg(await meGet())
    expect(anonymous.body).toEqual({ user: null })
  })
})
