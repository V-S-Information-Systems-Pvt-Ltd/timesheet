// tests/error-hygiene.test.ts
// Tests for CP10 secret validation (AUTH_SECRET length and HS256 algorithm pinning).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SignJWT } from 'jose'

vi.mock('server-only', () => ({}))
import { signSessionToken, verifySessionToken } from '@/lib/auth/jwt'

describe('CP10 AUTH_SECRET minimum length and HS256 algorithm pinning', () => {
  const originalSecret = process.env.AUTH_SECRET

  beforeEach(() => {
    process.env.AUTH_SECRET = 'a'.repeat(32)
  })

  afterEach(() => {
    if (originalSecret !== undefined) process.env.AUTH_SECRET = originalSecret
    else delete process.env.AUTH_SECRET
  })

  it('rejects signing when AUTH_SECRET is less than 32 characters', async () => {
    process.env.AUTH_SECRET = 'short-key-16-bytes!'
    await expect(signSessionToken({ id: 'u1', email: 'test@vsis.lk' })).rejects.toThrow(
      'AUTH_SECRET must be configured with at least 32 characters.'
    )
  })

  it('rejects verification when AUTH_SECRET is less than 32 characters', async () => {
    process.env.AUTH_SECRET = 'short-key-16-bytes!'
    const result = await verifySessionToken('dummy.token.payload')
    expect(result).toBeNull()
  })

  it('successfully signs and verifies with a valid 32+ character secret', async () => {
    process.env.AUTH_SECRET = 'valid-secret-key-that-is-at-least-32-chars-long!'
    const token = await signSessionToken({ id: 'u1', email: 'test@vsis.lk' }, 2)
    const verified = await verifySessionToken(token)
    expect(verified).not.toBeNull()
    expect(verified?.user.id).toBe('u1')
    expect(verified?.user.email).toBe('test@vsis.lk')
    expect(verified?.sessionVersion).toBe(2)
  })

  it('rejects tokens signed with an unapproved algorithm even if signed with the same key', async () => {
    process.env.AUTH_SECRET = 'valid-secret-key-that-is-at-least-32-chars-long!'
    const key = new TextEncoder().encode(process.env.AUTH_SECRET)

    // Sign with HS384 instead of pinned HS256
    const nonHs256Token = await new SignJWT({ email: 'test@vsis.lk', sv: 1 })
      .setProtectedHeader({ alg: 'HS384' })
      .setSubject('u1')
      .setIssuedAt()
      .setExpirationTime('7d')
      .sign(key)

    const result = await verifySessionToken(nonHs256Token)
    expect(result).toBeNull()
  })
})
