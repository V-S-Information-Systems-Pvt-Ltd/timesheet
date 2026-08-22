// tests/domain-check-route.test.ts
// Regression coverage for GET /api/auth/domain-check, the pre-signup whitelist
// lookup used by the Supabase client flow in lib/auth/client.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/app/api/_http', () => ({
  json: vi.fn((body: unknown, status = 200) => ({ body, status })),
}))

const { mockFindWhitelistedDomain } = vi.hoisted(() => ({ mockFindWhitelistedDomain: vi.fn() }))
vi.mock('@/lib/db', () => ({ repo: { findWhitelistedDomain: mockFindWhitelistedDomain } }))
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn() }, extractError: (e: unknown) => String(e) }))

import { GET } from '../app/api/auth/domain-check/route'
import { dailySignupStore } from '@/lib/rate-limit'

interface DomainCheckRes {
  status: number
  body: { allowed: boolean; autoActivate: boolean; error?: string }
}

function rg(res: Response): DomainCheckRes {
  return res as unknown as DomainCheckRes
}

function req(qs: string, ip = '1.2.3.4'): Request {
  const r = new Request(`http://localhost/api/auth/domain-check${qs}`)
  r.headers.set('x-forwarded-for', ip)
  return r
}

beforeEach(() => {
  vi.clearAllMocks()
  dailySignupStore.clear()
  mockFindWhitelistedDomain.mockReset()
})

describe('GET /api/auth/domain-check', () => {
  it('returns 400 for a missing or invalid email', async () => {
    const missing = rg(await GET(req('')))
    expect(missing.status).toBe(400)
    expect(missing.body.allowed).toBe(false)

    const noDomain = rg(await GET(req('?email=not-an-email')))
    expect(noDomain.status).toBe(400)
  })

  it('reports allowed=false for a non-whitelisted domain', async () => {
    mockFindWhitelistedDomain.mockResolvedValue(null)
    const res = rg(await GET(req('?email=jane@outside.com')))
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ allowed: false, autoActivate: false })
  })

  it('reports allowed + autoActivate for a whitelisted domain', async () => {
    mockFindWhitelistedDomain.mockResolvedValue({ id: 'd1', domain: 'company.com', auto_activate: true })
    const res = rg(await GET(req('?email=%20JANE@COMPANY.COM%20')))
    expect(res.body).toEqual({ allowed: true, autoActivate: true })
    // Lookup uses the lowercased domain.
    expect(mockFindWhitelistedDomain).toHaveBeenCalledWith('company.com')
  })

  it('rate-limits by IP after the hourly budget is exhausted', async () => {
    mockFindWhitelistedDomain.mockResolvedValue({ id: 'd1', domain: 'company.com', auto_activate: true })
    for (let i = 0; i < 10; i++) {
      const res = rg(await GET(req(`?email=u${i}@company.com`)))
      expect(res.status).toBe(200)
    }
    const res = rg(await GET(req('?email=overflow@company.com')))
    expect(res.status).toBe(429)
    expect(res.body.error).toMatch(/Too many attempts/)
    expect(mockFindWhitelistedDomain).toHaveBeenCalledTimes(10)
  })
})
