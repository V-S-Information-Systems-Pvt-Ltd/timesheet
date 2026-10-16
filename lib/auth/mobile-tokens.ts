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

function getSigningMaterial(): { key: Uint8Array; alg: string } {
  const value = process.env.MOBILE_AUTH_SECRET
  if (!value || value.length < 32) {
    throw new Error('MOBILE_AUTH_SECRET must be configured with at least 32 characters.')
  }
  return { key: new TextEncoder().encode(value), alg: 'HS256' }
}

function getVerificationKeys(): Array<{ key: Uint8Array; algs: string[] }> {
  try {
    const mat = getSigningMaterial()
    return [{ key: mat.key, algs: [mat.alg] }]
  } catch {
    return [] // not configured
  }
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

  const customClaims: Record<string, unknown> = {
    sid: input.sessionId,
    family: input.familyId,
    ver: MOBILE_TOKEN_VERSION,
  }

  const { key, alg } = getSigningMaterial()
  const header = { alg, typ: 'JWT' }

  const jwt = new SignJWT(customClaims)
    .setProtectedHeader(header)
    .setSubject(input.userId)
    .setIssuer(MOBILE_TOKEN_ISSUER)
    .setAudience(MOBILE_TOKEN_AUDIENCE)
    .setIssuedAt(issuedAt)
    .setExpirationTime(expiresAt)

  return jwt.sign(key)
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
  const keysToTry = getVerificationKeys()

  for (const entry of keysToTry) {
    try {
      const { payload } = await jwtVerify(token, entry.key, {
        algorithms: entry.algs,
        issuer: MOBILE_TOKEN_ISSUER,
        currentDate: options?.now,
      })
      const aud = payload.aud
      const audValid =
        aud === MOBILE_TOKEN_AUDIENCE || (Array.isArray(aud) && aud.includes(MOBILE_TOKEN_AUDIENCE))
      if (!audValid) {
        continue
      }

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
      // try next secret
    }
  }
  return null
}

export { ACCESS_TOKEN_TTL_SECONDS, MOBILE_TOKEN_AUDIENCE, MOBILE_TOKEN_ISSUER, MOBILE_TOKEN_VERSION }
