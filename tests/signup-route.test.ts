// tests/signup-route.test.ts
// Regression coverage for the native /api/auth/signup endpoint added by the
// domain-whitelist feature. Locks in: domain whitelist accept/reject,
// auto-activation, duplicate rejection, and the per-IP rate limit.
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/app/api/_http', () => ({
  json: vi.fn((body: unknown, status = 200, headers?: Record<string, string>) => ({ body, status, headers })),
  originCheck: vi.fn(() => null),
  serverError: vi.fn((_err: unknown) => ({ error: 'internal' })),
}))

const { mockFindWhitelistedDomain, mockGetProfileByEmail, mockQuery } = vi.hoisted(() => ({
  mockFindWhitelistedDomain: vi.fn(),
  mockGetProfileByEmail: vi.fn(),
  mockQuery: vi.fn(),
}))

vi.mock('@/lib/db', () => ({ repo: { findWhitelistedDomain: mockFindWhitelistedDomain, getProfileByEmail: mockGetProfileByEmail } }))
vi.mock('@/lib/db/pool', () => ({ query: mockQuery }))
vi.mock('@/lib/auth/password', () => ({ hashPassword: vi.fn(async (p: string) => `hash:${p}`) }))
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn() }, extractError: (e: unknown) => String(e) }))

import { POST } from '../app/api/auth/signup/route'
import { dailySignupStore } from '@/lib/rate-limit'

// The route's `json` helper is mocked to `{ body, status, headers }`, so cast
// the Response to that shape to satisfy TypeScript (mirrors reports-route.test).
interface SignupRes {
  status: number
  body: {
    error?: string
    message?: string
    success?: boolean
    isActive?: boolean
  }
  headers?: Record<string, string> | null
}

function rg(res: Response): SignupRes {
  return res as unknown as SignupRes
}

function req(body: unknown, ip = '1.2.3.4'): Request {
  return new Request('http://localhost/api/auth/signup', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  }) as Request
}

beforeEach(() => {
  vi.clearAllMocks()
  dailySignupStore.clear()
  mockFindWhitelistedDomain.mockReset()
  mockGetProfileByEmail.mockReset()
  mockQuery.mockReset()
})

describe('POST /api/auth/signup', () => {
  it('rejects malformed input (400)', async () => {
    expect(rg(await POST(req({ password: 'secret123' }))).body.error).toMatch(/Email and password/)
    expect(rg(await POST(req({ email: 'a@x.com', password: '123' }))).status).toBe(400)

    const short = rg(await POST(req({ email: 'a@x.com', password: '123' })))
    expect(short.body.error).toMatch(/at least 6 characters/)

    const badDomain = rg(await POST(req({ email: 'not-an-email', password: 'secret123' })))
    expect(badDomain.body.error).toMatch(/valid email/)
    expect(badDomain.status).toBe(400)
  })

  it('rejects a non-whitelisted domain with 403', async () => {
    mockFindWhitelistedDomain.mockResolvedValue(null)
    const res = rg(await POST(req({ email: 'jane@outside.com', password: 'secret123' })))
    expect(res.status).toBe(403)
    expect(res.body.error).toContain('@outside.com')
    expect(mockQuery).not.toHaveBeenCalled()
    expect(mockGetProfileByEmail).not.toHaveBeenCalled()
  })

  it('rejects an existing account with 409', async () => {
    mockFindWhitelistedDomain.mockResolvedValue({ id: 'd1', domain: 'company.com', auto_activate: true })
    mockGetProfileByEmail.mockResolvedValue({ id: 'p1' })
    const res = rg(await POST(req({ email: 'jane@company.com', password: 'secret123' })))
    expect(res.status).toBe(409)
    expect(res.body.error).toMatch(/already exists/)
  })

  it('creates an auto-activated account', async () => {
    mockFindWhitelistedDomain.mockResolvedValue({ id: 'd1', domain: 'company.com', auto_activate: true })
    mockGetProfileByEmail.mockResolvedValue(null)
    mockQuery.mockResolvedValue([])
    const res = rg(await POST(req({ email: ' JANE@COMPANY.COM ', password: 'secret123', name: ' Jane ' })))
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ success: true, isActive: true })
    expect(res.body.message).toMatch(/activated/)
    // Normalized email + trimmed name + hash + auto-activate flag. The
    // role 'user' is a SQL literal in the statement, not a binding.
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("values ($1, $2, $3, $4, 'user')"),
      ['jane@company.com', 'Jane', expect.any(String), true]
    )
  })

  it('creates an account awaiting activation when the domain is not auto-activated', async () => {
    mockFindWhitelistedDomain.mockResolvedValue({ id: 'd1', domain: 'company.com', auto_activate: false })
    mockGetProfileByEmail.mockResolvedValue(null)
    mockQuery.mockResolvedValue([])
    const res = rg(await POST(req({ email: 'jane@company.com', password: 'secret123' })))
    expect(res.status).toBe(200)
    expect(res.body.isActive).toBe(false)
    expect(res.body.message).toMatch(/administrator must activate/)
  })

  it('rate-limits by IP after the hourly budget is exhausted', async () => {
    mockFindWhitelistedDomain.mockResolvedValue({ id: 'd1', domain: 'company.com', auto_activate: false })
    mockGetProfileByEmail.mockResolvedValue(null)
    mockQuery.mockResolvedValue([])

    // Fill the hourly budget for this IP.
    for (let i = 0; i < 10; i++) {
      const res = rg(await POST(req({ email: `u${i}@company.com`, password: 'secret123' })))
      expect(res.status).toBe(200)
    }

    const res = rg(await POST(req({ email: 'overflow@company.com', password: 'secret123' })))
    expect(res.status).toBe(429)
    expect(res.body.error).toMatch(/Too many signup attempts/)
    expect(res.headers?.['Retry-After']).toBeDefined()
    expect(mockQuery).toHaveBeenCalledTimes(10)
  })
})
