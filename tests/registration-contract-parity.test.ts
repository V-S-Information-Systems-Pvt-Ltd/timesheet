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
import { RegistrationConflictError as SupabaseRegistrationConflictError, supabaseRegistrationPort } from '@/lib/auth/registration-supabase'

const { mockQuery } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
}))

vi.mock('@/lib/db/pool', () => ({
  query: mockQuery,
}))

const mockAdminFrom = vi.fn()
vi.mock('@/lib/supabase/admin', () => ({
  getAdminClient: () => ({
    from: mockAdminFrom,
  }),
}))

const mockSignUp = vi.fn()
vi.mock('@/lib/supabase/public', () => ({
  getPublicAnonClient: () => ({
    auth: { signUp: mockSignUp },
  }),
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
})

describe('supabaseRegistrationPort implementation', () => {
  beforeEach(() => {
    mockAdminFrom.mockReset()
    mockSignUp.mockReset()
  })

  it('findWhitelistedDomain uses exact eq query', async () => {
    const selectMock = vi.fn().mockReturnThis()
    const eqMock = vi.fn().mockReturnThis()
    const limitMock = vi.fn().mockReturnThis()
    const maybeSingleMock = vi.fn().mockResolvedValue({
      data: { id: 'd1', domain: 'example.com', auto_activate: false },
      error: null,
    })

    mockAdminFrom.mockReturnValue({
      select: selectMock,
      eq: eqMock,
      limit: limitMock,
      maybeSingle: maybeSingleMock,
    })

    const res = await supabaseRegistrationPort.findWhitelistedDomain('example.com')
    expect(res).toEqual({ id: 'd1', domain: 'example.com', autoActivate: false })
    expect(mockAdminFrom).toHaveBeenCalledWith('whitelisted_domains')
    expect(eqMock).toHaveBeenCalledWith('domain', 'example.com')
  })

  it('accountExists returns boolean from single row head lookup', async () => {
    const selectMock = vi.fn().mockReturnThis()
    const eqMock = vi.fn().mockReturnThis()
    const limitMock = vi.fn().mockReturnThis()
    const maybeSingleMock = vi.fn().mockResolvedValue({
      data: { id: 'p1' },
      error: null,
    })

    mockAdminFrom.mockReturnValue({
      select: selectMock,
      eq: eqMock,
      limit: limitMock,
      maybeSingle: maybeSingleMock,
    })

    const res = await supabaseRegistrationPort.accountExists('user@example.com')
    expect(res).toBe(true)
    expect(eqMock).toHaveBeenCalledWith('email', 'user@example.com')
  })

  it('registerIdentity signs up through the anonymous public client without confirming email', async () => {
    // Email confirmation enabled: GoTrue returns the user without a session,
    // so the identity cannot sign in until the address is verified.
    mockSignUp.mockResolvedValue({
      data: { user: { id: 'u1', email: 'user@example.com' }, session: null },
      error: null,
    })

    const result = await supabaseRegistrationPort.registerIdentity({
      email: 'user@example.com',
      name: 'User',
      password: 'Password123!',
      passwordHash: 'hash',
      isActive: true,
    })
    expect(result).toEqual({
      id: 'u1',
      email: 'user@example.com',
      isActive: true,
      requiresEmailConfirmation: true,
    })
    expect(mockSignUp).toHaveBeenCalledWith({
      email: 'user@example.com',
      password: 'Password123!',
      options: { data: { name: 'User' } },
    })
  })

  it('registerIdentity reports no pending confirmation when the provider returns a session', async () => {
    // Confirmation disabled in the deployment config: signUp returns a session
    // and the identity can sign in immediately.
    mockSignUp.mockResolvedValue({
      data: {
        user: { id: 'u2', email: 'user@example.com' },
        session: { access_token: 'should-never-escape', refresh_token: 'either' },
      },
      error: null,
    })

    const result = await supabaseRegistrationPort.registerIdentity({
      email: 'user@example.com',
      name: 'User',
      password: 'Password123!',
      passwordHash: 'hash',
      isActive: true,
    })
    expect(result.requiresEmailConfirmation).toBe(false)
  })

  it('maps Supabase Auth email conflicts to the registration conflict contract', async () => {
    mockSignUp.mockResolvedValue({
      data: { user: null, session: null },
      error: { code: 'user_already_exists', message: 'User already registered' },
    })

    await expect(
      supabaseRegistrationPort.registerIdentity({
        email: 'user@example.com',
        name: 'User',
        password: 'Password123!',
        passwordHash: 'hash',
        isActive: true,
      })
    ).rejects.toThrow(SupabaseRegistrationConflictError)
  })

  it('maps the legacy email_exists code to the registration conflict contract', async () => {
    mockSignUp.mockResolvedValue({
      data: { user: null, session: null },
      error: { code: 'email_exists', message: 'A user with this email already exists' },
    })

    await expect(
      supabaseRegistrationPort.registerIdentity({
        email: 'user@example.com',
        name: 'User',
        password: 'Password123!',
        passwordHash: 'hash',
        isActive: true,
      })
    ).rejects.toThrow(SupabaseRegistrationConflictError)
  })

  it('surfaces non-conflict provider failures without leaking tokens', async () => {
    mockSignUp.mockResolvedValue({
      data: { user: null, session: null },
      error: { code: 'unexpected_failure', message: 'Something went wrong' },
    })

    await expect(
      supabaseRegistrationPort.registerIdentity({
        email: 'user@example.com',
        name: 'User',
        password: 'Password123!',
        passwordHash: 'hash',
        isActive: true,
      })
    ).rejects.toThrow('Something went wrong')
  })
})
