import 'server-only'

import { createHash, randomBytes } from 'node:crypto'
import { SignJWT, jwtVerify, type JWTPayload } from 'jose'

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60
const MOBILE_TOKEN_VERSION = 1
const MOBILE_TOKEN_ISSUER = 'vsis-timesheet-mobile'
const MOBILE_TOKEN_AUDIENCE = 'vsis-timesheet-api'

export interface MobileAccessTokenInput {
  userId: string
  sessionId: string
  familyId: string
  now?: Date
}

export interface MobileAccessTokenClaims {
  userId: string
  sessionId: string
  familyId: string
  issuedAt: number
  expiresAt: number
  version: number
}

function secret(): Uint8Array {
  const value = process.env.MOBILE_AUTH_SECRET
  if (!value || value.length < 32) {
    throw new Error('MOBILE_AUTH_SECRET must be configured with at least 32 characters.')
  }
  return new TextEncoder().encode(value)
}

/** Generate the raw refresh token returned once to the client. */
export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url')
}

/** Store only this digest; never store the raw refresh token. */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

export async function signMobileAccessToken(input: MobileAccessTokenInput): Promise<string> {
  const issuedAt = Math.floor((input.now ?? new Date()).getTime() / 1000)
  const expiresAt = issuedAt + ACCESS_TOKEN_TTL_SECONDS

  return new SignJWT({
    sid: input.sessionId,
    family: input.familyId,
    ver: MOBILE_TOKEN_VERSION,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(input.userId)
    .setIssuer(MOBILE_TOKEN_ISSUER)
    .setAudience(MOBILE_TOKEN_AUDIENCE)
    .setIssuedAt(issuedAt)
    .setExpirationTime(expiresAt)
    .sign(secret())
}

function asString(payload: JWTPayload, key: string): string | null {
  const value = payload[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

/** Verify signature and protocol claims; authorization is done separately. */
export async function verifyMobileAccessToken(
  token: string,
  options?: { now?: Date }
): Promise<MobileAccessTokenClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), {
      algorithms: ['HS256'],
      issuer: MOBILE_TOKEN_ISSUER,
      audience: MOBILE_TOKEN_AUDIENCE,
      currentDate: options?.now,
    })
    const userId = payload.sub
    const sessionId = asString(payload, 'sid')
    const familyId = asString(payload, 'family')
    const version = payload.ver

    if (
      !userId ||
      !sessionId ||
      !familyId ||
      version !== MOBILE_TOKEN_VERSION ||
      typeof payload.iat !== 'number' ||
      typeof payload.exp !== 'number'
    ) {
      return null
    }

    return {
      userId,
      sessionId,
      familyId,
      issuedAt: payload.iat,
      expiresAt: payload.exp,
      version,
    }
  } catch {
    return null
  }
}

export { ACCESS_TOKEN_TTL_SECONDS, MOBILE_TOKEN_AUDIENCE, MOBILE_TOKEN_ISSUER, MOBILE_TOKEN_VERSION }
