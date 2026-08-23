// tests/auth-change-password-timing.test.ts
// Regression coverage for the Phase 0.4 login/change-password timing oracle
// fix. lib/auth/native.ts must run the same dummy-verification when the target
// account has no password hash, so the unknown-user response time does not
// reveal whether an account exists. Spec 5.2 asks for a timing-dummy auth
// case; this locks the change-password branch (the login branch is already
// covered by tests/password.test.ts's verifyDummyPassword and the login flow).
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockQuery,
  mockHashPassword,
  mockVerifyPassword,
  mockVerifyPasswordDetails,
  mockVerifyDummyPassword,
} = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockHashPassword: vi.fn(),
  mockVerifyPassword: vi.fn(),
  mockVerifyPasswordDetails: vi.fn(),
  mockVerifyDummyPassword: vi.fn(),
}))

vi.mock('@/lib/db/pool', () => ({ query: mockQuery }))
vi.mock('next/headers', () => ({ cookies: vi.fn() }))
vi.mock('@/lib/auth/jwt', () => ({
  signSessionToken: vi.fn(),
  verifySessionToken: vi.fn(),
}))
vi.mock('@/lib/auth/password', () => ({
  hashPassword: (...a: unknown[]) => mockHashPassword(...a),
  verifyPassword: (...a: unknown[]) => mockVerifyPassword(...a),
  verifyPasswordDetails: (...a: unknown[]) => mockVerifyPasswordDetails(...a),
  verifyDummyPassword: (...a: unknown[]) => mockVerifyDummyPassword(...a),
}))

import { changePassword } from '../lib/auth/native'

const USER_ID = 'user-1'

beforeEach(() => {
  mockQuery.mockReset()
  mockHashPassword.mockReset()
  mockVerifyPassword.mockReset()
  mockVerifyPasswordDetails.mockReset()
  mockVerifyDummyPassword.mockReset()
})

describe('changePassword timing dummy', () => {
  it('runs the dummy verification when the account has no password hash', async () => {
    mockQuery.mockResolvedValueOnce([{ password_hash: null }])
    mockVerifyDummyPassword.mockResolvedValueOnce(false)

    const result = await changePassword(USER_ID, 'whatever', 'NewPass1')

    expect(result).toEqual({ error: 'User not found.' })
    // The dummy verify must actually run so response time does not betray the
    // missing account, and the supplied (current) password is what is checked.
    expect(mockVerifyDummyPassword).toHaveBeenCalledWith('whatever')
    expect(mockVerifyPassword).not.toHaveBeenCalled()
    expect(mockQuery.mock.calls[0][0]).toContain('select password_hash')
  })

  it('does NOT write a new hash for an unverified/unknown account', async () => {
    mockQuery.mockResolvedValueOnce([{ password_hash: null }])
    await changePassword(USER_ID, 'whatever', 'NewPass1')
    expect(mockHashPassword).not.toHaveBeenCalled()
    const writes = mockQuery.mock.calls.filter(([sql]) => typeof sql === 'string' && sql.includes('update'))
    expect(writes).toHaveLength(0)
  })

  it('only rehashes/updates after a successful current-password verification', async () => {
    mockQuery.mockResolvedValueOnce([{ password_hash: 'scrypt$16384$8$1$abc$def' }])
    mockVerifyPassword.mockResolvedValueOnce(true)
    mockHashPassword.mockResolvedValueOnce('scrypt$16384$8$1$new$hash')

    const result = await changePassword(USER_ID, 'OldPass1', 'NewPass1')
    expect(result.error).toBeNull()
    expect(mockHashPassword).toHaveBeenCalledWith('NewPass1')
    const updateCall = mockQuery.mock.calls.at(-1)
    expect(updateCall?.[0]).toContain('update public.profiles set password_hash')
  })
})