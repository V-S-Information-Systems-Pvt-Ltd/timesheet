// tests/native-auth-session.test.ts
// Regression coverage for native session token versioning and password reset invalidation.
// Verifies:
// 1. Valid session token with matching session_version resolves the user.
// 2. Pre-reset session token with old session_version is rejected after a reset increments session_version.
// 3. Post-reset sign-in with the new password yields an updated session_version that succeeds.
// 4. Missing cookie, expired/tampered JWT, and mismatched session version return null.

import { describe, it, expect, beforeEach, vi } from 'vitest'

process.env.AUTH_SECRET = 'test-auth-secret-super-secure-key-32-chars!'

const { mockQuery, mockCookiesStore } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockCookiesStore: {
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
  },
}))

vi.mock('@/lib/db/pool', () => ({
  query: mockQuery,
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => mockCookiesStore),
}))

import { nativeAuth, signIn } from '@/lib/auth/native'
import { signSessionToken } from '@/lib/auth/jwt'
import { hashPassword } from '@/lib/auth/password'

describe('native auth session_version invalidation and post-reset sign-in', () => {
  const testUser = { id: 'u-123', email: 'alice@example.com' }

  beforeEach(() => {
    mockQuery.mockReset()
    mockCookiesStore.get.mockReset()
    mockCookiesStore.set.mockReset()
    mockCookiesStore.delete.mockReset()
  })

  it('resolves session user when JWT session_version matches DB session_version', async () => {
    const token = await signSessionToken(testUser, 0)
    mockCookiesStore.get.mockReturnValue({ value: token })
    mockQuery.mockResolvedValueOnce([{ session_version: 0 }])

    const user = await nativeAuth.getSessionUser()
    expect(user).toEqual(testUser)
    expect(mockQuery).toHaveBeenCalledWith(
      'select session_version from public.profiles where id = $1',
      [testUser.id]
    )
  })

  it('rejects pre-reset JWT when DB session_version has been incremented by password reset', async () => {
    // Token issued before password reset (sv = 0)
    const preResetToken = await signSessionToken(testUser, 0)
    mockCookiesStore.get.mockReturnValue({ value: preResetToken })

    // DB session_version has incremented to 1 due to password reset
    mockQuery.mockResolvedValueOnce([{ session_version: 1 }])

    const user = await nativeAuth.getSessionUser()
    expect(user).toBeNull()
  })

  it('signs in with new password post-reset and generates a valid updated session', async () => {
    const newPassword = 'NewSecretPassword1!'
    const newPasswordHash = await hashPassword(newPassword)

    // User table has updated password_hash and session_version = 1
    mockQuery.mockResolvedValueOnce([
      {
        id: testUser.id,
        email: testUser.email,
        password_hash: newPasswordHash,
        session_version: 1,
      },
    ])

    const signInResult = await signIn(testUser.email, newPassword)
    expect(signInResult.error).toBeNull()
    expect(signInResult.user).toEqual(testUser)
    expect(signInResult.sessionVersion).toBe(1)

    // Now issue a token with the new session_version
    const postResetToken = await signSessionToken(testUser, signInResult.sessionVersion)
    mockCookiesStore.get.mockReturnValue({ value: postResetToken })

    // When the user makes a subsequent authenticated call, DB session_version is 1
    mockQuery.mockResolvedValueOnce([{ session_version: 1 }])

    const sessionUser = await nativeAuth.getSessionUser()
    expect(sessionUser).toEqual(testUser)
  })

  it('returns null when session cookie is absent or malformed', async () => {
    mockCookiesStore.get.mockReturnValue(undefined)
    expect(await nativeAuth.getSessionUser()).toBeNull()

    mockCookiesStore.get.mockReturnValue({ value: 'invalid.jwt.token' })
    expect(await nativeAuth.getSessionUser()).toBeNull()
  })
})
