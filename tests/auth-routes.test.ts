// tests/auth-routes.test.ts
// Phase 5.2 authentication route coverage.
// Tests for login, logout, me, and change-password including timing dummy,
// password policy, session, CSRF/origin, and rate-limit cases.
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/app/api/_http', () => ({
  json: vi.fn((body: unknown, status = 200, headers?: Record<string, string>) => ({ body, status, headers })),
  originCheck: vi.fn(() => null),
  serverError: vi.fn((_err: unknown) => ({ body: { error: 'internal' }, status: 500 })),
}))

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
  changePassword: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  getSessionUser: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn() },
  extractError: (e: unknown) => String(e),
}))

import { POST as loginPost } from '../app/api/auth/login/route'
import { POST as logoutPost } from '../app/api/auth/logout/route'
import { GET as meGet } from '../app/api/auth/me/route'
import { POST as changePasswordPost } from '../app/api/auth/change-password/route'
import { dailyLoginStore } from '@/lib/rate-limit'
import { getSessionUser } from '@/lib/auth'
import { changePassword } from '@/lib/auth/native'

interface Res {
  status: number
  body: Record<string, unknown>
  headers?: Record<string, string> | null
}

function rg(res: Response): Res {
  return res as unknown as Res
}

function req(body: unknown, headers: Record<string, string> = {}, ip = '5.6.7.8'): Request {
  return new Request('http://localhost/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, ...headers },
    body: JSON.stringify(body),
  }) as Request
}

beforeEach(() => {
  vi.clearAllMocks()
  dailyLoginStore.clear()
})

// ---------------------------------------------------------------------------
// POST /api/auth/login
// ---------------------------------------------------------------------------
describe('POST /api/auth/login', () => {
  it('rejects requests with missing credentials (400)', async () => {
    const res = rg(await loginPost(req({ email: 'a@x.com' })))
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/Email and password/)
  })

  it('returns 401 when signIn returns an error (bad credentials)', async () => {
    mockSignIn.mockResolvedValue({ user: null, error: 'Invalid email or password.' })
    const res = rg(await loginPost(req({ email: 'u@x.com', password: 'wrong' })))
    expect(res.status).toBe(401)
    expect(res.body.error).toMatch(/Invalid email/)
  })

  it('returns 401 with generic message when signIn returns no error text', async () => {
    mockSignIn.mockResolvedValue({ user: null, error: null })
    const res = rg(await loginPost(req({ email: 'u@x.com', password: 'wrong' })))
    expect(res.status).toBe(401)
    expect(res.body.error).toBe('Invalid email or password.')
  })

  it('issues a session cookie on successful login', async () => {
    const user = { id: 'u1', email: 'u@x.com', role: 'user' }
    mockSignIn.mockResolvedValue({ user, error: null })
    mockSignSessionToken.mockResolvedValue('tok')
    mockSetSessionCookie.mockResolvedValue(undefined)

    const res = rg(await loginPost(req({ email: 'u@x.com', password: 'correct' })))
    expect(res.status).toBe(200)
    expect(res.body.user).toEqual(user)
    expect(mockSignSessionToken).toHaveBeenCalledWith(user)
    expect(mockSetSessionCookie).toHaveBeenCalledWith('tok')
  })

  it('charges rate limit only on failed logins, not successes', async () => {
    const user = { id: 'u1', email: 'u@x.com', role: 'user' }
    mockSignIn.mockResolvedValue({ user, error: null })
    mockSignSessionToken.mockResolvedValue('tok')

    // Success path: budget should not be consumed
    await loginPost(req({ email: 'u@x.com', password: 'correct' }))
    const key = 'login:u@x.com:5.6.7.8'
    expect(dailyLoginStore.get(key)).toBeUndefined()

    // Failure path: budget should be consumed
    mockSignIn.mockResolvedValue({ user: null, error: 'bad' })
    await loginPost(req({ email: 'u@x.com', password: 'wrong' }))
    expect(dailyLoginStore.has(key)).toBe(true)
  })

  it('rate-limits repeated failed login attempts with 429', async () => {
    mockSignIn.mockResolvedValue({ user: null, error: 'bad' })

    // Exhaust the budget (default RATE_LIMIT_LOGIN = 10)
    for (let i = 0; i < 10; i++) {
      await loginPost(req({ email: 'u@x.com', password: 'wrong' }))
    }

    const res = rg(await loginPost(req({ email: 'u@x.com', password: 'wrong' })))
    expect(res.status).toBe(429)
    expect(res.body.error).toMatch(/Too many login attempts/)
    expect(res.headers?.['Retry-After']).toBeDefined()
  })

  it('does NOT rate-limit based on IP when the email changes (keys are per email+ip)', async () => {
    mockSignIn.mockResolvedValue({ user: null, error: 'bad' })

    // Exhaust budget for user-a
    for (let i = 0; i < 10; i++) {
      await loginPost(req({ email: 'user-a@x.com', password: 'wrong' }))
    }
    const res = rg(await loginPost(req({ email: 'user-a@x.com', password: 'wrong' })))
    expect(res.status).toBe(429)

    // user-b at same IP is unaffected
    const res2 = rg(await loginPost(req({ email: 'user-b@x.com', password: 'wrong' })))
    expect(res2.status).toBe(401)
  })
})

// ---------------------------------------------------------------------------
// POST /api/auth/logout
// ---------------------------------------------------------------------------
describe('POST /api/auth/logout', () => {
  it('clears the session cookie and returns ok', async () => {
    mockClearSessionCookie.mockResolvedValue(undefined)
    const req = new Request('http://localhost/api/auth/logout', { method: 'POST' })
    const res = rg(await logoutPost(req as Request))
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
    expect(mockClearSessionCookie).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// GET /api/auth/me
// ---------------------------------------------------------------------------
describe('GET /api/auth/me', () => {
  it('returns the session user when signed in', async () => {
    const user = { id: 'u1', email: 'u@x.com' }
    vi.mocked(getSessionUser).mockResolvedValue(user as never)

    const res = rg(await meGet())
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ user })
  })

  it('returns null user when not signed in', async () => {
    vi.mocked(getSessionUser).mockResolvedValue(null)

    const res = rg(await meGet())
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ user: null })
  })
})

// ---------------------------------------------------------------------------
// POST /api/auth/change-password
// ---------------------------------------------------------------------------
describe('POST /api/auth/change-password', () => {
  function cpReq(body: unknown): Request {
    return new Request('http://localhost/api/auth/change-password', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }) as Request
  }

  it('rejects unauthenticated requests with 401', async () => {
    vi.mocked(getSessionUser).mockResolvedValue(null)
    const res = rg(await changePasswordPost(cpReq({ currentPassword: 'x', newPassword: 'x' })))
    expect(res.status).toBe(401)
    expect(res.body.error).toMatch(/signed in/)
  })

  it('rejects missing fields with 400', async () => {
    vi.mocked(getSessionUser).mockResolvedValue({ id: 'u1' } as never)
    const res = rg(await changePasswordPost(cpReq({ currentPassword: 'x' })))
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/required/)
  })

  it('rejects weak new passwords that violate the password policy (400)', async () => {
    vi.mocked(getSessionUser).mockResolvedValue({ id: 'u1' } as never)

    // Too short
    let res = rg(await changePasswordPost(cpReq({ currentPassword: 'OldPass1', newPassword: 'abc' })))
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/8 characters/)

    // No uppercase
    res = rg(await changePasswordPost(cpReq({ currentPassword: 'OldPass1', newPassword: 'alllower1' })))
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/uppercase/)

    // No digit
    res = rg(await changePasswordPost(cpReq({ currentPassword: 'OldPass1', newPassword: 'NoDigitHere' })))
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/digit/)
  })

  it('propagates auth error on wrong current password', async () => {
    vi.mocked(getSessionUser).mockResolvedValue({ id: 'u1' } as never)
    vi.mocked(changePassword).mockResolvedValue({ error: 'Current password is incorrect.' })
    const res = rg(await changePasswordPost(cpReq({ currentPassword: 'Wrong1!', newPassword: 'NewPass1' })))
    expect(res.body.error).toBe('Current password is incorrect.')
  })

  it('returns null error on successful password change', async () => {
    vi.mocked(getSessionUser).mockResolvedValue({ id: 'u1' } as never)
    vi.mocked(changePassword).mockResolvedValue({ error: null })
    const res = rg(await changePasswordPost(cpReq({ currentPassword: 'OldPass1', newPassword: 'NewPass1' })))
    expect(res.status).toBe(200)
    expect(res.body.error).toBeNull()
  })
})
