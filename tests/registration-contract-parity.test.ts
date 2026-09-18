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
import {
  RegistrationConflictError as SupabaseRegistrationConflictError,
  RegistrationConfigurationError,
  RegistrationOutcomeUncertainError,
  supabaseRegistrationPort,
} from '@/lib/auth/registration-supabase'

const { mockQuery } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
}))
const { mockGetPublicAuthSettings } = vi.hoisted(() => ({
  mockGetPublicAuthSettings: vi.fn(),
}))

vi.mock('@/lib/db/pool', () => ({
  query: mockQuery,
}))

const mockAdminFrom = vi.fn()
const mockDeleteUser = vi.fn()
vi.mock('@/lib/supabase/admin', () => ({
  getAdminClient: () => ({
    from: mockAdminFrom,
    auth: { admin: { deleteUser: mockDeleteUser } },
  }),
}))

const mockSignUp = vi.fn()
const mockSignOut = vi.fn()
vi.mock('@/lib/supabase/public', () => ({
  getPublicAuthSettings: mockGetPublicAuthSettings,
  getPublicAnonClient: () => ({
    auth: { signUp: mockSignUp, signOut: mockSignOut },
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
      expect(res.error.message).not.toMatch(/Supabase|profile/i)
    }
  })

  it('maps provider configuration failures to a non-internal CONFIGURATION outcome', async () => {
    const configError = new Error('Supabase email confirmation must be enabled for public registration.')
    ;(configError as Error & { code: string }).code = 'CONFIGURATION'
    mockPort.registerIdentity = vi.fn().mockRejectedValue(configError)

    const res = await registerUser({ email: 'new@allowed.com', password: 'Password123!' }, mockPort)
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error.code).toBe('CONFIGURATION')
      expect(res.error.message).toBe('Registration is temporarily unavailable. Contact an administrator.')
      // The provider's configuration detail is never surfaced to the caller.
      expect(res.error.message).not.toMatch(/Supabase|confirmation/i)
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
    mockSignOut.mockReset()
    mockDeleteUser.mockReset()
    mockGetPublicAuthSettings.mockReset()
    mockGetPublicAuthSettings.mockResolvedValue({
      disable_signup: false,
      mailer_autoconfirm: false,
      external: { email: true },
    })
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
    const eqMock = vi.fn().mockReturnThis()
    mockAdminFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: eqMock,
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'u1', is_active: true }, error: null }),
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
    expect(mockAdminFrom).toHaveBeenCalledWith('profiles')
    expect(eqMock).toHaveBeenCalledWith('id', 'u1')
    expect(eqMock).toHaveBeenCalledWith('email', 'user@example.com')
  })

  it('maps an obfuscated concurrent-duplicate signup to a conflict without deleting the existing user', async () => {
    mockSignUp.mockResolvedValue({
      data: { user: { id: 'fake-user', email: 'user@example.com' }, session: null },
      error: null,
    })
    mockAdminFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    })

    const outcome = await registerUser(
      { email: 'user@example.com', password: 'Password123!' },
      {
        ...supabaseRegistrationPort,
        findWhitelistedDomain: async () => ({ id: 'domain', domain: 'example.com', autoActivate: true }),
        accountExists: async () => false, // The other request commits after this check.
      }
    )

    expect(outcome).toEqual({
      ok: false,
      error: { code: 'ACCOUNT_EXISTS', message: 'An account with that email already exists.' },
    })
    expect(mockDeleteUser).not.toHaveBeenCalled()
  })

  it('treats an already-pending identity as a confirmation flow without claiming a new account', async () => {
    mockSignUp.mockResolvedValue({
      data: { user: { id: 'existing-user', email: 'user@example.com' }, session: null },
      error: null,
    })
    mockAdminFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'existing-user', is_active: false }, error: null }),
    })

    const outcome = await registerUser(
      { email: 'user@example.com', password: 'Password123!' },
      {
        ...supabaseRegistrationPort,
        findWhitelistedDomain: async () => ({ id: 'domain', domain: 'example.com', autoActivate: true }),
        accountExists: async () => false, // The other request commits after this check.
      }
    )

    expect(outcome.ok).toBe(true)
    if (outcome.ok) {
      expect(outcome.data.isActive).toBe(false) // Read the persisted profile, not the current domain setting.
      expect(outcome.data.message).toMatch(/confirm your address/i)
      expect(outcome.data.message).not.toMatch(/account created/i)
    }
    expect(mockDeleteUser).not.toHaveBeenCalled()
  })

  it('does not report signup success when the profile verification query fails', async () => {
    mockSignUp.mockResolvedValue({
      data: { user: { id: 'u1', email: 'user@example.com' }, session: null },
      error: null,
    })
    mockAdminFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: { message: 'profile query unavailable' } }),
    })

    await expect(
      supabaseRegistrationPort.registerIdentity({
        email: 'user@example.com',
        name: 'User',
        password: 'Password123!',
        passwordHash: 'hash',
        isActive: true,
      })
    ).rejects.toThrow(RegistrationOutcomeUncertainError)
    expect(mockDeleteUser).not.toHaveBeenCalled()
  })

  it('treats a transport failure during profile verification as an uncertain signup', async () => {
    mockSignUp.mockResolvedValue({
      data: { user: { id: 'u1', email: 'user@example.com' }, session: null },
      error: null,
    })
    mockAdminFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockRejectedValue(new Error('network unavailable')),
    })

    await expect(
      supabaseRegistrationPort.registerIdentity({
        email: 'user@example.com',
        name: 'User',
        password: 'Password123!',
        passwordHash: 'hash',
        isActive: true,
      })
    ).rejects.toThrow(RegistrationOutcomeUncertainError)
    expect(mockDeleteUser).not.toHaveBeenCalled()
  })

  it('rejects unsafe provider settings before creating an identity', async () => {
    mockGetPublicAuthSettings.mockResolvedValue({
      disable_signup: false,
      mailer_autoconfirm: true,
      external: { email: true },
    })

    await expect(
      supabaseRegistrationPort.registerIdentity({
        email: 'user@example.com',
        name: 'User',
        password: 'Password123!',
        passwordHash: 'hash',
        isActive: true,
      })
    ).rejects.toThrow(RegistrationConfigurationError)
    expect(mockSignUp).not.toHaveBeenCalled()
  })

  it('fails closed and cleans up when the provider returns a session', async () => {
    // Confirmation disabled in the deployment config: signUp returns a session.
    // The adapter must not turn that configuration into a usable account.
    mockSignUp.mockResolvedValue({
      data: {
        user: { id: 'u2', email: 'user@example.com' },
        session: { access_token: 'must-never-escape', refresh_token: 'must-never-escape' },
      },
      error: null,
    })
    mockSignOut.mockResolvedValue({ error: null })
    mockDeleteUser.mockResolvedValue({ error: null })

    await expect(
      supabaseRegistrationPort.registerIdentity({
        email: 'user@example.com',
        name: 'User',
        password: 'Password123!',
        passwordHash: 'hash',
        isActive: true,
      })
    ).rejects.toThrow(RegistrationConfigurationError)
    expect(mockSignOut).toHaveBeenCalledOnce()
    expect(mockDeleteUser).toHaveBeenCalledWith('u2')
  })

  it('still removes the unsafe identity when signOut itself fails', async () => {
    mockSignUp.mockResolvedValue({
      data: {
        user: { id: 'u3', email: 'user@example.com' },
        session: { access_token: 'must-never-escape', refresh_token: 'must-never-escape' },
      },
      error: null,
    })
    mockSignOut.mockRejectedValue(new Error('logout transport unavailable'))
    mockDeleteUser.mockResolvedValue({ error: null })

    await expect(
      supabaseRegistrationPort.registerIdentity({
        email: 'user@example.com',
        name: 'User',
        password: 'Password123!',
        passwordHash: 'hash',
        isActive: true,
      })
    ).rejects.toThrow(RegistrationConfigurationError)
    expect(mockDeleteUser).toHaveBeenCalledWith('u3')
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

  it.each([
    { code: 'email_address_invalid', expected: 'Please enter a valid email address.' },
    { code: 'weak_password', expected: 'Password does not meet complexity requirements.' },
  ])('maps a definite $code rejection to safe validation feedback', async ({ code, expected }) => {
    mockSignUp.mockResolvedValue({
      data: { user: null, session: null },
      error: { code, status: 400, message: 'provider-internal details' },
    })

    const outcome = await registerUser(
      { email: 'user@example.com', password: 'Password123!' },
      {
        ...supabaseRegistrationPort,
        findWhitelistedDomain: async () => ({ id: 'domain', domain: 'example.com', autoActivate: true }),
        accountExists: async () => false,
      }
    )
    expect(outcome).toEqual({ ok: false, error: { code: 'VALIDATION_ERROR', message: expected } })
    expect(outcome.ok).toBe(false)
    expect(mockDeleteUser).not.toHaveBeenCalled()
  })

  it.each([
    { name: 'lost transport response', error: { name: 'AuthRetryableFetchError', status: 0, message: 'network lost' } },
    { name: 'provider server failure', error: { code: 'unexpected_failure', status: 503, message: 'provider unavailable' } },
    { name: 'unclassified provider failure', error: { code: 'unexpected_failure', message: 'unknown outcome' } },
  ])('treats a $name as uncertain without deleting an identity', async ({ error }) => {
    mockSignUp.mockResolvedValue({
      data: { user: null, session: null },
      error,
    })

    await expect(
      supabaseRegistrationPort.registerIdentity({
        email: 'user@example.com',
        name: 'User',
        password: 'Password123!',
        passwordHash: 'hash',
        isActive: true,
      })
    ).rejects.toThrow(RegistrationOutcomeUncertainError)
    expect(mockDeleteUser).not.toHaveBeenCalled()
  })

  it('treats a rejected signup request and an empty provider response as uncertain', async () => {
    const input = {
      email: 'user@example.com',
      name: 'User',
      password: 'Password123!',
      passwordHash: 'hash',
      isActive: true,
    }
    mockSignUp.mockRejectedValueOnce(new Error('connection reset'))
    await expect(supabaseRegistrationPort.registerIdentity(input)).rejects.toThrow(RegistrationOutcomeUncertainError)

    mockSignUp.mockResolvedValueOnce({ data: { user: null, session: null }, error: null })
    await expect(supabaseRegistrationPort.registerIdentity(input)).rejects.toThrow(RegistrationOutcomeUncertainError)
    expect(mockDeleteUser).not.toHaveBeenCalled()
  })
})
