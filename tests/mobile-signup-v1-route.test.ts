import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/backend/config', () => ({
  IS_NATIVE: true,
  IS_SUPABASE: false,
}))

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
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn() }, extractError: (e: unknown) => String(e) }))

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
    mockFindWhitelistedDomain.mockReset()
    mockAccountExists.mockReset()
    mockRegisterIdentity.mockReset()
  })

  afterEach(() => {
    setRateLimitStore(null)
    resetLocalRateLimitWindows()
    vi.unstubAllEnvs()
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
    mockFindWhitelistedDomain.mockResolvedValue({ id: 'd1', domain: 'company.com', autoActivate: true })
    mockAccountExists.mockResolvedValue(false)
    mockRegisterIdentity.mockResolvedValue({ id: 'p1', email: 'jane@company.com', isActive: true })

    const res = await POST(req({ email: 'jane@company.com', password: 'Secret123!', name: 'Jane Doe' }))
    const data = await res.json()
    expect(res.status).toBe(201)
    expect(data.data).toEqual({
      success: true,
      isActive: true,
      message: 'Account created and activated! You can now sign in.',
    })
    expect((data.data as Record<string, unknown>).userId).toBeUndefined()
    expect(mockRegisterIdentity).toHaveBeenCalled()
  })

  it('returns 503 when mobile bearer auth is disabled', async () => {
    vi.stubEnv('MOBILE_BEARER_AUTH_ENABLED', 'false')
    const res = await POST(req({ email: 'jane@company.com', password: 'Secret123!' }))
    const data = await res.json()
    expect(res.status).toBe(503)
    expect(data.error.code).toBe('MOBILE_API_DISABLED')
    expect(mockFindWhitelistedDomain).not.toHaveBeenCalled()
  })

  it('fails closed with 503 when the provider registration configuration is unsafe', async () => {
    mockFindWhitelistedDomain.mockResolvedValue({ id: 'd1', domain: 'company.com', autoActivate: true })
    mockAccountExists.mockResolvedValue(false)
    const configError = new Error('Supabase email confirmation must be enabled for public registration.')
    ;(configError as Error & { code: string }).code = 'CONFIGURATION'
    mockRegisterIdentity.mockRejectedValue(configError)

    const res = await POST(req({ email: 'jane@company.com', password: 'Secret123!' }))
    const data = (await res.json()) as { error: { code: string; message: string } }
    expect(res.status).toBe(503)
    expect(data.error.code).toBe('REGISTRATION_UNAVAILABLE')
    expect(data.error.message).toBe('Registration is temporarily unavailable. Contact an administrator.')
    expect(data.error.message).not.toMatch(/Supabase|confirmation/i)
  })

  it('keeps the released error envelope when signup outcome is uncertain', async () => {
    mockFindWhitelistedDomain.mockResolvedValue({ id: 'd1', domain: 'company.com', autoActivate: true })
    mockAccountExists.mockResolvedValue(false)
    const uncertain = new Error('Internal profile read failed')
    ;(uncertain as Error & { code: string }).code = 'UNCERTAIN'
    mockRegisterIdentity.mockRejectedValue(uncertain)

    const res = await POST(req({ email: 'jane@company.com', password: 'Secret123!' }))
    const data = (await res.json()) as { error: { code: string; message: string } }
    expect(res.status).toBe(503)
    expect(data.error.code).toBe('REGISTRATION_UNAVAILABLE')
    expect(data.error.message).toMatch(/may have succeeded/i)
    expect(data.error.message).not.toMatch(/Internal|profile/i)
  })
})
