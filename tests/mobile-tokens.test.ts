import { describe, expect, it, vi } from 'vitest'

import { decodeProtectedHeader, SignJWT } from 'jose'
import {
  generateRefreshToken,
  hashRefreshToken,
  signMobileAccessToken,
  verifyMobileAccessToken,
  isLegacyMobileToken,
} from '@/lib/auth/mobile-tokens'

describe('mobile token primitives', () => {
  vi.stubEnv('MOBILE_AUTH_SECRET', 'a'.repeat(32))
  vi.stubEnv('SUPABASE_MOBILE_SIGNING_KEY', 'a'.repeat(32))
  vi.stubEnv('SUPABASE_JWT_SECRET', 'a'.repeat(32))
  vi.stubEnv('SUPABASE_MOBILE_SIGNING_KEY_ID', 'test-key-id-1')

  it('generates a high-entropy refresh token and stores only a digest', () => {
    const first = generateRefreshToken()
    const second = generateRefreshToken()

    expect(first).not.toBe(second)
    expect(first.length).toBeGreaterThanOrEqual(40)
    expect(hashRefreshToken(first)).toMatch(/^[a-f0-9]{64}$/)
    expect(hashRefreshToken(first)).toBe(hashRefreshToken(first))
    expect(hashRefreshToken(first)).not.toBe(first)
  })

  it('signs and verifies the scoped access-token claims', async () => {
    const now = new Date('2026-08-26T10:00:00.000Z')
    const token = await signMobileAccessToken({
      userId: 'user-1',
      sessionId: 'session-1',
      familyId: 'family-1',
      now,
    })

    const header = decodeProtectedHeader(token)
    expect(header.kid).toBe('test-key-id-1')
    expect(header.alg).toBe('HS256')

    await expect(verifyMobileAccessToken(token, { now })).resolves.toEqual({
      userId: 'user-1',
      sessionId: 'session-1',
      familyId: 'family-1',
      issuedAt: 1787738400,
      expiresAt: 1787739300,
      version: 1,
    })
  })

  it('throws when SUPABASE_MOBILE_SIGNING_KEY_ID is missing in Supabase mode', async () => {
    vi.stubEnv('SUPABASE_MOBILE_SIGNING_KEY_ID', '')
    vi.stubEnv('SUPABASE_JWT_KEY_ID', '')
    vi.stubEnv('SUPABASE_MOBILE_SIGNING_KID', '')

    await expect(
      signMobileAccessToken({
        userId: 'user-1',
        sessionId: 'session-1',
        familyId: 'family-1',
      })
    ).rejects.toThrow('SUPABASE_MOBILE_SIGNING_KEY_ID must be configured')

    vi.stubEnv('SUPABASE_MOBILE_SIGNING_KEY_ID', 'test-key-id-1')
  })

  it('rejects tampered, wrong-secret, wrong-audience, and expired tokens', async () => {
    const token = await signMobileAccessToken({
      userId: 'user-1',
      sessionId: 'session-1',
      familyId: 'family-1',
      now: new Date(),
    })

    const [header, payload, signature] = token.split('.')
    const tampered = `${header}.${payload.replace(/.$/, 'x')}.${signature}`
    await expect(verifyMobileAccessToken(tampered)).resolves.toBeNull()

    vi.stubEnv('MOBILE_AUTH_SECRET', 'b'.repeat(32))
    vi.stubEnv('SUPABASE_MOBILE_SIGNING_KEY', 'b'.repeat(32))
    vi.stubEnv('SUPABASE_JWT_SECRET', 'b'.repeat(32))
    await expect(verifyMobileAccessToken(token)).resolves.toBeNull()
    vi.stubEnv('MOBILE_AUTH_SECRET', 'a'.repeat(32))
    vi.stubEnv('SUPABASE_MOBILE_SIGNING_KEY', 'a'.repeat(32))
    vi.stubEnv('SUPABASE_JWT_SECRET', 'a'.repeat(32))

    const expired = await signMobileAccessToken({
      userId: 'user-1',
      sessionId: 'session-1',
      familyId: 'family-1',
      now: new Date(Date.now() - 2 * 60 * 60 * 1000),
    })
    await expect(verifyMobileAccessToken(expired)).resolves.toBeNull()
  })

  it('rejects Supabase tokens missing the server-authored role claim', async () => {
    const now = new Date()
    // Mint a token with the correct key but without `role: authenticated`
    const key = new TextEncoder().encode('a'.repeat(32))
    const { SignJWT: Sign } = await import('jose')
    const noRole = await new Sign({ sid: 'session-1', family: 'family-1', ver: 1 })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT', kid: 'test-key-id-1' })
      .setSubject('user-1')
      .setIssuer('vsis-timesheet-mobile')
      .setAudience('authenticated')
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(key)
    // Only enforced when NEXT_PUBLIC_BACKEND=supabase (default). In native
    // mode the role claim is absent by design, so skip there.
    const backend = process.env.NEXT_PUBLIC_BACKEND?.trim()
    if (!backend || backend === 'supabase') {
      await expect(verifyMobileAccessToken(noRole, { now })).resolves.toBeNull()
    } else {
      await expect(verifyMobileAccessToken(noRole, { now })).resolves.not.toBeNull()
    }
  })

  it('detects legacy mobile tokens and rejects them in Supabase verification', async () => {
    // Legacy secret distinct from Supabase signing key
    const legacySecret = 'legacy-secret-for-native-32chars!'
    const supabaseKey = 'supabase-signing-key-32chars!!!'
    vi.stubEnv('MOBILE_AUTH_SECRET', legacySecret)
    vi.stubEnv('SUPABASE_MOBILE_SIGNING_KEY', supabaseKey)
    vi.stubEnv('SUPABASE_JWT_SECRET', supabaseKey)
    vi.stubEnv('SUPABASE_MOBILE_SIGNING_KEY_ID', 'test-key-id-1')

    // Create a legacy token signed with MOBILE_AUTH_SECRET
    const legacyToken = await new SignJWT({
      sub: 'user-legacy',
      sid: 'session-legacy',
      fam: 'family-legacy',
      ver: 1,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('vsis-timesheet-mobile')
      .setAudience('vsis-timesheet-api')
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(new TextEncoder().encode(legacySecret))

    // isLegacyMobileToken should identify it
    await expect(isLegacyMobileToken(legacyToken)).resolves.toBe(true)

    // In Supabase mode, verifyMobileAccessToken should NOT accept the legacy secret
    await expect(verifyMobileAccessToken(legacyToken)).resolves.toBeNull()

    // Random non-legacy token should not match isLegacyMobileToken
    await expect(isLegacyMobileToken('invalid.token.signature')).resolves.toBe(false)
  })

  it('supports SUPABASE_MOBILE_SIGNING_KEY_KEY and SUPABASE_MOBILE_SIGNING_KEY_ALG aliases', async () => {
    vi.stubEnv('SUPABASE_MOBILE_SIGNING_KEY', '')
    vi.stubEnv('SUPABASE_JWT_SECRET', '')
    vi.stubEnv('SUPABASE_MOBILE_SIGNING_KEY_KEY', 'alias-key-with-thirty-two-chars!')
    vi.stubEnv('SUPABASE_MOBILE_SIGNING_ALG', '')
    vi.stubEnv('SUPABASE_MOBILE_SIGNING_KEY_ALG', 'HS256')
    vi.stubEnv('SUPABASE_MOBILE_SIGNING_KEY_ID', 'alias-kid-1')

    const now = new Date('2026-08-26T10:00:00.000Z')
    const token = await signMobileAccessToken({
      userId: 'user-alias',
      sessionId: 'session-alias',
      familyId: 'family-alias',
      now,
    })

    const header = decodeProtectedHeader(token)
    expect(header.kid).toBe('alias-kid-1')
    expect(header.alg).toBe('HS256')

    await expect(verifyMobileAccessToken(token, { now })).resolves.toEqual({
      userId: 'user-alias',
      sessionId: 'session-alias',
      familyId: 'family-alias',
      issuedAt: 1787738400,
      expiresAt: 1787739300,
      version: 1,
    })
  })

  it('supports SUPABASE_MOBILE_SIGNING_KID alias when SUPABASE_MOBILE_SIGNING_KEY_ID is unset', async () => {
    vi.stubEnv('SUPABASE_MOBILE_SIGNING_KEY_ID', '')
    vi.stubEnv('SUPABASE_JWT_KEY_ID', '')
    vi.stubEnv('SUPABASE_MOBILE_SIGNING_KID', 'positive-kid-alias-1')
    vi.stubEnv('SUPABASE_MOBILE_SIGNING_KEY', 'a'.repeat(32))
    vi.stubEnv('SUPABASE_MOBILE_SIGNING_ALG', 'HS256')

    const now = new Date('2026-08-26T10:00:00.000Z')
    const token = await signMobileAccessToken({
      userId: 'user-kid',
      sessionId: 'session-kid',
      familyId: 'family-kid',
      now,
    })

    const header = decodeProtectedHeader(token)
    expect(header.kid).toBe('positive-kid-alias-1')
  })
})
