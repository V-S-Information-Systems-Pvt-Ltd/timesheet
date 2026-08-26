import { describe, expect, it, vi } from 'vitest'

import {
  generateRefreshToken,
  hashRefreshToken,
  signMobileAccessToken,
  verifyMobileAccessToken,
} from '@/lib/auth/mobile-tokens'

describe('mobile token primitives', () => {
  vi.stubEnv('MOBILE_AUTH_SECRET', 'a'.repeat(32))

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
    // Freeze the clock so verification cannot drift past the fixed claims.
    const now = new Date('2026-08-26T10:00:00.000Z')
    vi.useFakeTimers()
    vi.setSystemTime(now)
    try {
      const token = await signMobileAccessToken({
        userId: 'user-1',
        sessionId: 'session-1',
        familyId: 'family-1',
        now,
      })

      await expect(verifyMobileAccessToken(token)).resolves.toEqual({
        userId: 'user-1',
        sessionId: 'session-1',
        familyId: 'family-1',
        issuedAt: 1787738400,
        expiresAt: 1787739300,
        version: 1,
      })
    } finally {
      vi.useRealTimers()
    }
  }, 10_000)

  it('rejects tampered, wrong-secret, wrong-audience, and expired tokens', async () => {
    const token = await signMobileAccessToken({
      userId: 'user-1',
      sessionId: 'session-1',
      familyId: 'family-1',
      now: new Date('2026-08-26T10:00:00.000Z'),
    })

    const [header, payload, signature] = token.split('.')
    const tampered = `${header}.${payload.replace(/.$/, 'x')}.${signature}`
    await expect(verifyMobileAccessToken(tampered)).resolves.toBeNull()

    vi.stubEnv('MOBILE_AUTH_SECRET', 'b'.repeat(32))
    await expect(verifyMobileAccessToken(token)).resolves.toBeNull()
    vi.stubEnv('MOBILE_AUTH_SECRET', 'a'.repeat(32))

    const expired = await signMobileAccessToken({
      userId: 'user-1',
      sessionId: 'session-1',
      familyId: 'family-1',
      now: new Date(Date.now() - 2 * 60 * 60 * 1000),
    })
    await expect(verifyMobileAccessToken(expired)).resolves.toBeNull()
  })
})
