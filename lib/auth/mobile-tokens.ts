import 'server-only'

import { createHash, randomBytes, createPrivateKey, createPublicKey, type KeyObject } from 'node:crypto'
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

import { IS_SUPABASE } from '@/lib/backend/config'

function getSigningMaterial(): { key: Uint8Array | KeyObject; alg: string; kid?: string } {
  if (IS_SUPABASE) {
    const kid = process.env.SUPABASE_MOBILE_SIGNING_KEY_ID || process.env.SUPABASE_MOBILE_SIGNING_KID || process.env.SUPABASE_JWT_KEY_ID
    if (!kid || kid.trim().length === 0) {
      throw new Error('SUPABASE_MOBILE_SIGNING_KEY_ID must be configured for Supabase mobile bearer auth.')
    }
    const alg = (process.env.SUPABASE_MOBILE_SIGNING_ALG || process.env.SUPABASE_MOBILE_SIGNING_KEY_ALG || 'HS256').toUpperCase()
    if (!['HS256', 'ES256', 'RS256'].includes(alg)) {
      throw new Error(`Unsupported signing alg ${alg} (SUPABASE_MOBILE_SIGNING_ALG / SUPABASE_MOBILE_SIGNING_KEY_ALG)`)
    }
    const value = process.env.SUPABASE_MOBILE_SIGNING_KEY || process.env.SUPABASE_MOBILE_SIGNING_KEY_KEY || process.env.SUPABASE_JWT_SECRET
    if (!value) {
      throw new Error('Supabase mobile signing key (SUPABASE_MOBILE_SIGNING_KEY, SUPABASE_MOBILE_SIGNING_KEY_KEY, or SUPABASE_JWT_SECRET) must be configured.')
    }
    if (alg === 'HS256') {
      if (value.trim().length < 32) {
        throw new Error('Supabase mobile signing key must be at least 32 characters for HS256.')
      }
      return { key: new TextEncoder().encode(value), alg, kid }
    } else {
      const trimmed = value.trim()
      if (!trimmed.startsWith('-----BEGIN') || !trimmed.includes('KEY-----')) {
        throw new Error(`Supabase mobile signing key must be a valid PEM private key for ${alg}.`)
      }
      const privKey = createPrivateKey(value)
      return { key: privKey, alg, kid }
    }
  }

  const value = process.env.MOBILE_AUTH_SECRET
  if (!value || value.length < 32) {
    throw new Error('MOBILE_AUTH_SECRET must be configured with at least 32 characters.')
  }
  return { key: new TextEncoder().encode(value), alg: 'HS256' }
}

function getVerificationKeys(): Array<{ key: Uint8Array | KeyObject; algs: string[] }> {
  const keys: Array<{ key: Uint8Array | KeyObject; algs: string[] }> = []
  try {
    const mat = getSigningMaterial()
    if (mat.key instanceof Uint8Array) {
      keys.push({ key: mat.key, algs: [mat.alg] })
    } else {
      keys.push({ key: createPublicKey(mat.key), algs: [mat.alg] })
    }
  } catch {
    // If not configured, fall through
  }

  if (!IS_SUPABASE) {
    const nativeSecret = process.env.MOBILE_AUTH_SECRET
    if (nativeSecret && nativeSecret.length >= 32) {
      const enc = new TextEncoder().encode(nativeSecret)
      if (keys.length === 0 || !(keys[0].key instanceof Uint8Array && keys[0].key.every((b, i) => b === enc[i]))) {
        keys.push({ key: enc, algs: ['HS256'] })
      }
    }
  }

  return keys
}

/**
 * Detects if a token was signed using the legacy native secret.
 * Used to return UPGRADE_REQUIRED in Supabase mode without admitting legacy tokens to RLS paths.
 */
export async function isLegacyMobileToken(token: string): Promise<boolean> {
  const nativeSecret = process.env.MOBILE_AUTH_SECRET
  if (!nativeSecret || nativeSecret.length < 32) {
    return false
  }
  try {
    const enc = new TextEncoder().encode(nativeSecret)
    await jwtVerify(token, enc, {
      algorithms: ['HS256'],
      issuer: MOBILE_TOKEN_ISSUER,
    })
    return true
  } catch {
    return false
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

  // Under Supabase Data API, JWT must carry role='authenticated' so PostgREST applies authenticated RLS
  if (IS_SUPABASE) {
    customClaims.role = 'authenticated'
  }

  const { key, alg, kid } = getSigningMaterial()
  const header: { alg: string; typ: string; kid?: string } = { alg, typ: 'JWT' }
  if (kid) {
    header.kid = kid
  }

  const jwt = new SignJWT(customClaims)
    .setProtectedHeader(header)
    .setSubject(input.userId)
    .setIssuer(MOBILE_TOKEN_ISSUER)
    .setAudience(IS_SUPABASE ? 'authenticated' : MOBILE_TOKEN_AUDIENCE)
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
        aud === MOBILE_TOKEN_AUDIENCE ||
        aud === 'authenticated' ||
        (Array.isArray(aud) && (aud.includes(MOBILE_TOKEN_AUDIENCE) || aud.includes('authenticated')))
      if (!audValid) {
        continue
      }

      const userId = payload.sub
      const sessionId = asString(payload, 'sid')
      const familyId = asString(payload, 'family')
      const version = payload.ver

      // In Supabase mode the Data API enforces RLS from `role`. The minter
      // always sets `role: 'authenticated'` (server-authored, never copied
      // from user metadata). Reject tokens without it so a native-format
      // token can never enter the repository context as an RLS identity.
      if (IS_SUPABASE && payload.role !== 'authenticated') {
        return null
      }

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
