import { randomBytes } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SignJWT } from 'jose'
import { signSessionToken, verifySessionToken } from '@/lib/auth/jwt'

const secret = randomBytes(24).toString('base64url')

beforeEach(() => vi.stubEnv('AUTH_SECRET', secret))
afterEach(() => vi.unstubAllEnvs())

function sign(claims: Record<string, unknown>, subject?: string) {
  const jwt = new SignJWT(claims).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
  if (subject) jwt.setSubject(subject)
  return jwt.sign(new TextEncoder().encode(secret))
}

describe('session JWT', () => {
  it('round-trips the user and session version', async () => {
    const token = await signSessionToken({ id: 'u1', email: 'a@example.com' } as never, 4)
    expect(await verifySessionToken(token)).toEqual({ user: { id: 'u1', email: 'a@example.com' }, sessionVersion: 4 })
  })

  it('normalises malformed sv and email claims', async () => {
    expect(await verifySessionToken(await sign({ sv: -1, email: 7 }, 'u2'))).toEqual({
      user: { id: 'u2', email: '' },
      sessionVersion: 0,
    })
  })

  it('rejects tokens without a subject, with a foreign key, or under a placeholder secret', async () => {
    expect(await verifySessionToken(await sign({ sv: 0 }))).toBeNull()
    const foreign = await new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject('u3')
      .sign(new TextEncoder().encode(randomBytes(24).toString('base64url')))
    expect(await verifySessionToken(foreign)).toBeNull()

    const token = await signSessionToken({ id: 'u1', email: 'a@example.com' } as never)
    vi.stubEnv('AUTH_SECRET', 'change-me-to-a-long-random-string')
    expect(await verifySessionToken(token)).toBeNull()
    await expect(signSessionToken({ id: 'u1', email: 'a@example.com' } as never)).rejects.toThrow(/placeholder/)
  })
})
