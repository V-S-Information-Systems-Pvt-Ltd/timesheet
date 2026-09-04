import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

const { mockFindWhitelistedDomain, mockGetProfileByEmail, mockQuery } = vi.hoisted(() => ({
  mockFindWhitelistedDomain: vi.fn(),
  mockGetProfileByEmail: vi.fn(),
  mockQuery: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  repo: {
    findWhitelistedDomain: mockFindWhitelistedDomain,
    getProfileByEmail: mockGetProfileByEmail,
  },
}))
vi.mock('@/lib/db/pool', () => ({ query: mockQuery }))
vi.mock('@/lib/auth/password', () => ({ hashPassword: vi.fn(async (p: string) => `hash:${p}`) }))
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn() } }))

import { POST } from '@/app/api/v1/auth/signup/route'
import { setRateLimitStore, resetLocalRateLimitWindows } from '@/lib/rate-limit'
import { createRateLimitFake, type RateLimitFake } from './helpers/rate-limit-store'

function req(body: unknown, ip = '1.2.3.4'): Request {
  return new Request('http://localhost/api/v1/auth/signup', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  })
}

let rateLimitFake: RateLimitFake

describe('POST /api/v1/auth/signup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rateLimitFake = createRateLimitFake()
    setRateLimitStore(rateLimitFake)
  })

  afterEach(() => {
    setRateLimitStore(null)
    resetLocalRateLimitWindows()
  })

  it('rejects malformed or weak password (400)', async () => {
    const res = await POST(req({ email: 'jane@company.com', password: '123' }))
    const data = await res.json()
    expect(res.status).toBe(400)
    expect(data.error.code).toBe('VALIDATION_ERROR')
  })

  it('rejects un-whitelisted domain (403)', async () => {
    mockFindWhitelistedDomain.mockResolvedValue(null)
    const res = await POST(req({ email: 'jane@outside.com', password: 'Secret123!' }))
    const data = await res.json()
    expect(res.status).toBe(403)
    expect(data.error.code).toBe('DOMAIN_NOT_ALLOWED')
  })

  it('creates auto-activated account on whitelisted domain (201)', async () => {
    mockFindWhitelistedDomain.mockResolvedValue({ id: 'd1', domain: 'company.com', auto_activate: true })
    mockGetProfileByEmail.mockResolvedValue(null)
    mockQuery.mockResolvedValue([])

    const res = await POST(req({ email: 'jane@company.com', password: 'Secret123!', name: 'Jane Doe' }))
    const data = await res.json()
    expect(res.status).toBe(201)
    expect(data.data.success).toBe(true)
    expect(data.data.isActive).toBe(true)
    expect(mockQuery).toHaveBeenCalled()
  })
})
