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
    readJsonLenient: actual.readJsonLenient,
    serverError: vi.fn((_err: unknown) => ({ body: { error: 'internal' }, status: 500 })),
  }
})

const { mockFindWhitelistedDomain, mockAccountExists, mockRegisterIdentity } = vi.hoisted(() => ({
  mockFindWhitelistedDomain: vi.fn(),
  mockAccountExists: vi.fn(),
  mockRegisterIdentity: vi.fn(),
}))

vi.mock('@/lib/auth/registration', () => ({
  registrationPort: {
    findWhitelistedDomain: mockFindWhitelistedDomain,
    accountExists: mockAccountExists,
    registerIdentity: mockRegisterIdentity,
  },
}))

vi.mock('@/lib/auth/password', () => ({ hashPassword: vi.fn(async (p: string) => `hash:${p}`) }))
vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn() },
  extractError: (e: unknown) => String(e),
}))

import { POST as signUpPost } from '@/app/api/v1/auth/browser/signup/route'
import { GET as domainCheckGet } from '@/app/api/v1/auth/browser/domain-check/route'
import { resetLocalRateLimitWindows, setRateLimitStore } from '@/lib/rate-limit'
import { createRateLimitFake, type RateLimitFake } from './helpers/rate-limit-store'

interface Res {
  status: number
  body: Record<string, unknown>
  headers?: Record<string, string> | null
}

function rg(res: Response): Res {
  return res as unknown as Res
}

function signUpRequest(body: unknown, ip = '1.2.3.4'): Request {
  return new Request('http://localhost/api/v1/auth/browser/signup', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  })
}

function domainRequest(qs: string, ip = '1.2.3.4'): Request {
  const request = new Request(`http://localhost/api/v1/auth/browser/domain-check${qs}`)
  request.headers.set('x-forwarded-for', ip)
  return request
}

let rateLimitFake: RateLimitFake

beforeEach(() => {
  vi.clearAllMocks()
  rateLimitFake = createRateLimitFake()
  setRateLimitStore(rateLimitFake)
  mockFindWhitelistedDomain.mockReset()
  mockAccountExists.mockReset()
  mockRegisterIdentity.mockReset()
})

afterEach(() => {
  setRateLimitStore(null)
  resetLocalRateLimitWindows()
  vi.unstubAllEnvs()
})

describe('v1 browser registration routes', () => {
  it('signs up through the browser contract even when mobile bearer auth is disabled', async () => {
    vi.stubEnv('MOBILE_BEARER_AUTH_ENABLED', 'false')
    mockFindWhitelistedDomain.mockResolvedValue({ id: 'd1', domain: 'company.com', autoActivate: true })
    mockAccountExists.mockResolvedValue(false)
    mockRegisterIdentity.mockResolvedValue({ id: 'p1', email: 'jane@company.com', isActive: true })

    const res = rg(await signUpPost(signUpRequest({
      email: ' JANE@COMPANY.COM ',
      password: 'Secret123',
      name: ' Jane ',
    })))

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ success: true, isActive: true })
    expect(mockRegisterIdentity).toHaveBeenCalledWith(expect.objectContaining({
      email: 'jane@company.com',
      name: 'Jane',
      isActive: true,
    }))
  })

  it('preserves signup error mapping and per-IP rate limiting', async () => {
    mockFindWhitelistedDomain.mockResolvedValue(null)
    const denied = rg(await signUpPost(signUpRequest({ email: 'jane@outside.com', password: 'Secret123' })))
    expect(denied.status).toBe(403)

    for (let i = 1; i < 10; i++) {
      await signUpPost(signUpRequest({ email: `u${i}@outside.com`, password: 'Secret123' }))
    }
    const limited = rg(await signUpPost(signUpRequest({ email: 'overflow@outside.com', password: 'Secret123' })))
    expect(limited.status).toBe(429)
    expect(limited.headers?.['Retry-After']).toBeDefined()
  })

  it('rejects foreign-origin signup before registration runs', async () => {
    const request = new Request('http://localhost/api/v1/auth/browser/signup', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        host: 'localhost',
        origin: 'https://evil.example.com',
      },
      body: JSON.stringify({ email: 'jane@company.com', password: 'Secret123' }),
    })
    const res = rg(await signUpPost(request))
    expect(res.status).toBe(403)
    expect(mockFindWhitelistedDomain).not.toHaveBeenCalled()
  })

  it('preserves domain-check validation, whitelist result, and rate limit contract', async () => {
    expect(rg(await domainCheckGet(domainRequest(''))).status).toBe(400)

    resetLocalRateLimitWindows()
    setRateLimitStore(null)
    rateLimitFake = createRateLimitFake()
    setRateLimitStore(rateLimitFake)
    mockFindWhitelistedDomain.mockResolvedValue({ id: 'd1', domain: 'company.com', autoActivate: true })
    const allowed = rg(await domainCheckGet(domainRequest('?email=%20JANE@COMPANY.COM%20')))
    expect(allowed.body).toEqual({ allowed: true, autoActivate: true })
    expect(mockFindWhitelistedDomain).toHaveBeenCalledWith('company.com')

    for (let i = 1; i < 10; i++) {
      await domainCheckGet(domainRequest(`?email=u${i}@company.com`))
    }
    const limited = rg(await domainCheckGet(domainRequest('?email=overflow@company.com')))
    expect(limited.status).toBe(429)
    expect(limited.headers?.['Retry-After']).toBeDefined()
  })
})
