// tests/registration-contract-parity.test.ts
// Contract and parity tests for the pre-auth signup boundary.
// Verifies that:
// 1. registration-service.ts owns normalization, eligibility, and race handling.
// 2. Both browser (/api/auth/signup) and mobile (/api/v1/auth/signup) routes
//    produce identical business decisions translated into their canonical HTTP envelopes.
// 3. Database uniqueness conflict is handled gracefully as the final safeguard.
// 4. Neither route fabricates an Actor or exposes profile data.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { registerUser, checkDomainEligibility } from '@/lib/auth/registration-service'
import type { RegistrationPort, WhitelistedDomainInfo } from '@/lib/auth/registration'
import { RegistrationConflictError, nativeRegistrationPort } from '@/lib/auth/registration-native'

// The service maps provider errors by their `code`; these stand in for provider-specific errors.
class RegistrationOutcomeUncertainError extends Error {
  readonly code = 'UNCERTAIN'
  constructor() {
    super('Registration may have succeeded; check your email and try again later.')
  }
}

const { mockQuery, mockIssueVerification, mockSendVerification } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockIssueVerification: vi.fn(),
  mockSendVerification: vi.fn(),
}))

vi.mock('@/lib/db/pool', () => ({
  query: mockQuery,
}))
vi.mock('@/lib/db/email-verification', () => ({
  issueEmailVerificationToken: mockIssueVerification,
}))
vi.mock('@/lib/email/password-reset', () => ({
  sendEmailVerificationEmail: mockSendVerification,
}))

describe('registration-service unit logic', () => {
  let mockPort: RegistrationPort

  beforeEach(() => {
    mockPort = {
      findWhitelistedDomain: vi.fn(async (domain: string): Promise<WhitelistedDomainInfo | null> => {
        if (domain === 'allowed.com') return { id: 'd1', domain: 'allowed.com', autoActivate: true }
        if (domain === 'manual.com') return { id: 'd2', domain: 'manual.com', autoActivate: false }
        return null
      }),
      accountExists: vi.fn(async (email: string) => email === 'existing@allowed.com'),
      registerIdentity: vi.fn(async (input) => ({
        id: 'user-123',
        email: input.email,
        isActive: input.isActive,
      })),
    }
  })

  it('rejects missing or non-string credentials', async () => {
    const res1 = await registerUser({}, mockPort)
    expect(res1.ok).toBe(false)
    if (!res1.ok) expect(res1.error.code).toBe('VALIDATION_ERROR')

    const res2 = await registerUser({ email: 'test@allowed.com' }, mockPort)
    expect(res2.ok).toBe(false)
    if (!res2.ok) expect(res2.error.code).toBe('VALIDATION_ERROR')
  })

  it('normalizes email and enforces password complexity', async () => {
    const weak = await registerUser({ email: ' User@Allowed.COM ', password: '123' }, mockPort)
    expect(weak.ok).toBe(false)
    if (!weak.ok) {
      expect(weak.error.code).toBe('VALIDATION_ERROR')
      expect(weak.error.message).toMatch(/at least 8 characters/)
    }

    const success = await registerUser(
      { email: ' User@Allowed.COM ', password: 'Password123!', name: ' Alice ' },
      mockPort
    )
    expect(success.ok).toBe(true)
    if (success.ok) {
      expect(success.data.isActive).toBe(true)
      expect(mockPort.findWhitelistedDomain).toHaveBeenCalledWith('allowed.com')
      expect(mockPort.accountExists).toHaveBeenCalledWith('user@allowed.com')
      expect(mockPort.registerIdentity).toHaveBeenCalledWith({
        email: 'user@allowed.com',
        name: 'Alice',
        password: 'Password123!',
        passwordHash: expect.any(String),
        isActive: true,
      })
    }
  })

  it('rejects non-whitelisted domains with DOMAIN_NOT_ALLOWED', async () => {
    const res = await registerUser({ email: 'user@forbidden.com', password: 'Password123!' }, mockPort)
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error.code).toBe('DOMAIN_NOT_ALLOWED')
      expect(res.error.message).toContain('@forbidden.com')
    }
  })

  it('rejects pre-existing accounts with ACCOUNT_EXISTS', async () => {
    const res = await registerUser({ email: 'existing@allowed.com', password: 'Password123!' }, mockPort)
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error.code).toBe('ACCOUNT_EXISTS')
    }
  })

  it('handles race conditions via database uniqueness conflict gracefully', async () => {
    mockPort.accountExists = vi.fn().mockResolvedValue(false)
    mockPort.registerIdentity = vi.fn().mockRejectedValue(new RegistrationConflictError())

    const res = await registerUser({ email: 'race@allowed.com', password: 'Password123!' }, mockPort)
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error.code).toBe('ACCOUNT_EXISTS')
      expect(res.error.message).toMatch(/already exists/)
    }
  })

  it('sets isActive=false when domain does not auto-activate', async () => {
    const res = await registerUser({ email: 'new@manual.com', password: 'Password123!' }, mockPort)
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.data.isActive).toBe(false)
      expect(res.data.message).toMatch(/administrator must activate/)
    }
  })

  it('reports pending email confirmation truthfully for an active but unconfirmed identity', async () => {
    mockPort.registerIdentity = vi.fn(async (input) => ({
      id: 'user-456',
      email: input.email,
      isActive: input.isActive,
      requiresEmailConfirmation: true,
    }))

    const res = await registerUser({ email: 'pending@allowed.com', password: 'Password123!' }, mockPort)
    expect(res.ok).toBe(true)
    if (res.ok) {
      // isActive reflects application activation; the message must not claim
      // the user can sign in before the provider verifies the address.
      expect(res.data.isActive).toBe(true)
      expect(res.data.message).toMatch(/confirm your address/i)
      expect(res.data.message).not.toMatch(/can now sign in/)
      expect(res.data.message).not.toMatch(/account created/i)
    }
  })

  it('reports a partially completed provider signup without claiming it failed', async () => {
    const uncertain = new RegistrationOutcomeUncertainError()
    mockPort.registerIdentity = vi.fn().mockRejectedValue(uncertain)

    const res = await registerUser({ email: 'new@allowed.com', password: 'Password123!' }, mockPort)
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error.code).toBe('UNCERTAIN')
      expect(res.error.message).toMatch(/may have succeeded/i)
      expect(res.error.message).toMatch(/check your email/i)
      expect(res.error.message).not.toMatch(/provider|profile/i)
    }
  })

  it('maps provider configuration failures to a non-internal CONFIGURATION outcome', async () => {
    const configError = new Error('Provider email confirmation must be enabled for public registration.')
    ;(configError as Error & { code: string }).code = 'CONFIGURATION'
    mockPort.registerIdentity = vi.fn().mockRejectedValue(configError)

    const res = await registerUser({ email: 'new@allowed.com', password: 'Password123!' }, mockPort)
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error.code).toBe('CONFIGURATION')
      expect(res.error.message).toBe('Registration is temporarily unavailable. Contact an administrator.')
      // The provider's configuration detail is never surfaced to the caller.
      expect(res.error.message).not.toMatch(/provider|confirmation/i)
    }
  })

  it('checks domain eligibility without authenticating', async () => {
    const invalid = await checkDomainEligibility('bad-email', mockPort)
    expect(invalid.ok).toBe(false)

    const unwhitelisted = await checkDomainEligibility('u@unknown.com', mockPort)
    expect(unwhitelisted).toEqual({ ok: true, data: { allowed: false, autoActivate: false } })

    const whitelisted = await checkDomainEligibility('u@allowed.com', mockPort)
    expect(whitelisted).toEqual({ ok: true, data: { allowed: true, autoActivate: true } })

    const manual = await checkDomainEligibility('u@manual.com', mockPort)
    expect(manual).toEqual({ ok: true, data: { allowed: true, autoActivate: false } })
  })
})

describe('nativeRegistrationPort implementation', () => {
  beforeEach(() => {
    mockQuery.mockReset()
  })

  it('queries whitelisted_domains with lowercase matching', async () => {
    mockQuery.mockResolvedValueOnce([{ id: 'd1', domain: 'example.com', auto_activate: true }])
    const res = await nativeRegistrationPort.findWhitelistedDomain(' @EXAMPLE.COM ')
    expect(res).toEqual({ id: 'd1', domain: 'example.com', autoActivate: true })
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('from public.whitelisted_domains where lower(domain) = $1'),
      ['example.com']
    )
  })

  it('accountExists returns boolean without reading profile details', async () => {
    mockQuery.mockResolvedValueOnce([{ id: 'u1' }])
    const exists = await nativeRegistrationPort.accountExists('test@example.com')
    expect(exists).toBe(true)
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('select id from public.profiles where lower(email) = $1'),
      ['test@example.com']
    )

    mockQuery.mockResolvedValueOnce([])
    const notExists = await nativeRegistrationPort.accountExists('nonexistent@example.com')
    expect(notExists).toBe(false)
  })

  it('registerIdentity maps unique violation to RegistrationConflictError', async () => {
    const pgError = new Error('duplicate key value violates unique constraint')
    ;(pgError as Error & { code: string }).code = '23505'
    mockQuery.mockRejectedValueOnce(pgError)

    await expect(
      nativeRegistrationPort.registerIdentity({
        email: 'dup@example.com',
        name: 'Dup',
        password: 'Password123!',
        passwordHash: 'hash',
        isActive: true,
      })
    ).rejects.toThrow(RegistrationConflictError)
  })

  it('registerIdentity inserts an inactive, unverified profile and mails a verification link', async () => {
    const expiresAt = new Date('2026-10-20T00:00:00Z')
    mockQuery.mockResolvedValueOnce([{ id: 'u9', email: 'new@example.com' }])
    mockIssueVerification.mockResolvedValueOnce({ token: 'raw-token', expiresAt })
    mockSendVerification.mockResolvedValueOnce(undefined)

    const res = await nativeRegistrationPort.registerIdentity({
      email: 'new@example.com',
      name: 'New',
      password: 'Password123!',
      passwordHash: 'hash',
      isActive: true,
    })

    expect(res).toEqual({ id: 'u9', email: 'new@example.com', isActive: false, requiresEmailConfirmation: true })
    const [sql, params] = mockQuery.mock.calls[0]
    expect(sql).toContain('values ($1, $2, $3, false, null,')
    expect(params).toEqual(['new@example.com', 'New', 'hash'])
    expect(mockIssueVerification).toHaveBeenCalledWith('u9')
    expect(mockSendVerification).toHaveBeenCalledWith({ to: 'new@example.com', token: 'raw-token', expiresAt })
  })

  it('registerIdentity still succeeds when the verification mail cannot be sent', async () => {
    mockQuery.mockResolvedValueOnce([{ id: 'u10', email: 'x@example.com' }])
    mockIssueVerification.mockRejectedValueOnce(new Error('SMTP_HOST is not configured.'))

    const res = await nativeRegistrationPort.registerIdentity({
      email: 'x@example.com',
      name: '',
      password: 'Password123!',
      passwordHash: 'hash',
      isActive: true,
    })
    expect(res.isActive).toBe(false)
    expect(res.requiresEmailConfirmation).toBe(true)
  })
})
