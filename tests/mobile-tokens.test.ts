import { describe, expect, it, vi } from 'vitest'

import { decodeProtectedHeader, SignJWT } from 'jose'
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
    const now = new Date('2026-08-26T10:00:00.000Z')
    const token = await signMobileAccessToken({
      userId: 'user-1',
      sessionId: 'session-1',
      familyId: 'family-1',
      now,
    })

    const header = decodeProtectedHeader(token)
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

  it('throws when MOBILE_AUTH_SECRET is missing or too short', async () => {
    vi.stubEnv('MOBILE_AUTH_SECRET', 'short')
    await expect(
      signMobileAccessToken({ userId: 'user-1', sessionId: 'session-1', familyId: 'family-1' })
    ).rejects.toThrow('MOBILE_AUTH_SECRET must be configured')
    vi.stubEnv('MOBILE_AUTH_SECRET', 'a'.repeat(32))
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
    await expect(verifyMobileAccessToken(token)).resolves.toBeNull()
    vi.stubEnv('MOBILE_AUTH_SECRET', 'a'.repeat(32))

    const wrongAudience = await new SignJWT({ sid: 'session-1', family: 'family-1', ver: 1 })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject('user-1')
      .setIssuer('vsis-timesheet-mobile')
      .setAudience('authenticated')
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(new TextEncoder().encode('a'.repeat(32)))
    await expect(verifyMobileAccessToken(wrongAudience)).resolves.toBeNull()

    const expired = await signMobileAccessToken({
      userId: 'user-1',
      sessionId: 'session-1',
      familyId: 'family-1',
      now: new Date(Date.now() - 2 * 60 * 60 * 1000),
    })
    await expect(verifyMobileAccessToken(expired)).resolves.toBeNull()
  })
})
