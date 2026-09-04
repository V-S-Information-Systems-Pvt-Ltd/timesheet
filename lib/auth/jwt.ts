// lib/auth/jwt.ts
// Shared JWT helpers for native-mode session tokens.
// Does NOT import next/headers so it can be used from edge middleware.

import { SignJWT, jwtVerify } from 'jose'
import type { SessionUser } from './index'

export const SESSION_COOKIE = 'vsis_session'
export const SESSION_DAYS = 7

export interface NativeSessionPayload {
  user: SessionUser
  sessionVersion: number
}

function secret(): Uint8Array {
  const value = process.env.AUTH_SECRET
  if (!value || value.length < 32) {
    throw new Error('AUTH_SECRET must be configured with at least 32 characters.')
  }
  return new TextEncoder().encode(value)
}

export async function signSessionToken(user: SessionUser, sessionVersion = 0): Promise<string> {
  return new SignJWT({ email: user.email, sv: sessionVersion })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secret())
}

export async function verifySessionToken(token: string): Promise<NativeSessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ['HS256'] })
    if (!payload.sub) return null
    const sessionVersion = typeof payload.sv === 'number' && Number.isInteger(payload.sv) && payload.sv >= 0
      ? payload.sv
      : 0
    return {
      user: { id: payload.sub, email: typeof payload.email === 'string' ? payload.email : '' },
      sessionVersion,
    }
  } catch {
    return null
  }
}
