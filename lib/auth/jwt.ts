// lib/auth/jwt.ts
// Shared JWT helpers for native-mode session tokens.
// Does NOT import next/headers so it can be used from edge middleware.

import { SignJWT, jwtVerify } from 'jose'
import type { SessionUser } from './index'

export const SESSION_COOKIE = 'vsis_session'
export const SESSION_DAYS = 7

function secret(): Uint8Array {
  const value = process.env.AUTH_SECRET
  if (!value) throw new Error('AUTH_SECRET is not set. Required for native mode.')
  return new TextEncoder().encode(value)
}

export async function signSessionToken(user: SessionUser): Promise<string> {
  return new SignJWT({ email: user.email })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secret())
}

export async function verifySessionToken(token: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, secret())
    if (!payload.sub) return null
    return { id: payload.sub, email: typeof payload.email === 'string' ? payload.email : '' }
  } catch {
    return null
  }
}
