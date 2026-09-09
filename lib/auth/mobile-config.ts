// lib/auth/mobile-config.ts
import 'server-only'
import { IS_SUPABASE } from '@/lib/backend/config'

import { createPrivateKey } from 'node:crypto'

export const SUPPORTED_SIGNING_ALGS = ['HS256', 'ES256', 'RS256'] as const
export type SupportedSigningAlg = (typeof SUPPORTED_SIGNING_ALGS)[number]

export function isValidKeyStructure(key: string, alg: string): boolean {
  const trimmed = key.trim()
  if (alg === 'HS256') {
    return trimmed.length >= 32
  }
  if (alg === 'ES256') {
    try {
      const keyObj = createPrivateKey(trimmed)
      if (keyObj.asymmetricKeyType !== 'ec') return false
      const curve = keyObj.asymmetricKeyDetails?.namedCurve?.toLowerCase()
      return curve === 'prime256v1' || curve === 'secp256r1' || curve === 'p-256'
    } catch {
      return false
    }
  }
  if (alg === 'RS256') {
    try {
      const keyObj = createPrivateKey(trimmed)
      if (keyObj.asymmetricKeyType !== 'rsa') return false
      const modLength = keyObj.asymmetricKeyDetails?.modulusLength
      return typeof modLength === 'number' && modLength >= 2048
    } catch {
      return false
    }
  }
  return false
}

/**
 * Validates whether mobile bearer authentication is fully enabled and correctly configured.
 * Requires explicit MOBILE_BEARER_AUTH_ENABLED === 'true' and a valid backend signing secret
 * or registered asymmetric key matching Supabase imported key requirements.
 */
export function isMobileBearerAuthEnabled(): boolean {
  if (process.env.MOBILE_BEARER_AUTH_ENABLED !== 'true') {
    return false
  }

  if (IS_SUPABASE) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    if (!url || !/^https?:\/\//i.test(url.trim())) {
      return false
    }

    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!anonKey || anonKey.trim().length === 0) {
      return false
    }

    const kid = process.env.SUPABASE_MOBILE_SIGNING_KEY_ID || process.env.SUPABASE_MOBILE_SIGNING_KID || process.env.SUPABASE_JWT_KEY_ID
    if (!kid || kid.trim().length === 0) {
      return false
    }

    const alg = (process.env.SUPABASE_MOBILE_SIGNING_ALG || process.env.SUPABASE_MOBILE_SIGNING_KEY_ALG || 'HS256').toUpperCase()
    if (!SUPPORTED_SIGNING_ALGS.includes(alg as SupportedSigningAlg)) {
      return false
    }

    const key = process.env.SUPABASE_MOBILE_SIGNING_KEY || process.env.SUPABASE_MOBILE_SIGNING_KEY_KEY || process.env.SUPABASE_JWT_SECRET
    if (!key) return false

    return isValidKeyStructure(key, alg)
  }

  const secret = process.env.MOBILE_AUTH_SECRET
  return Boolean(secret && secret.trim().length >= 32)
}

/**
 * Whether the server may accept automatic replay of queued offline mutations
 * (T19.2 durable idempotency). Native execution is transactional today, so the
 * capability is advertised immediately. Supabase support depends on the
 * immutable-effect migration and live RLS evidence, so it stays fail-closed
 * until an operator explicitly opts in after verifying the deployed schema.
 */
export function isDurableIdempotencyEnabled(): boolean {
  if (!IS_SUPABASE) return true
  return process.env.DURABLE_IDEMPOTENCY_ENABLED === 'true'
}

/**
 * Short non-secret description of the bearer configuration for startup logs.
 * Never includes key material.
 */
export function describeMobileBearerConfig(): string {
  if (IS_SUPABASE) {
    const kid = process.env.SUPABASE_MOBILE_SIGNING_KEY_ID || process.env.SUPABASE_MOBILE_SIGNING_KID || process.env.SUPABASE_JWT_KEY_ID
    const alg = (process.env.SUPABASE_MOBILE_SIGNING_ALG || process.env.SUPABASE_MOBILE_SIGNING_KEY_ALG || 'HS256').toUpperCase()
    const key = process.env.SUPABASE_MOBILE_SIGNING_KEY || process.env.SUPABASE_MOBILE_SIGNING_KEY_KEY || process.env.SUPABASE_JWT_SECRET
    return `backend=supabase alg=${alg} kid=${kid ? 'set' : 'missing'} key=${key ? 'set' : 'missing'}`
  }
  const secret = process.env.MOBILE_AUTH_SECRET
  return `backend=native secret=${secret && secret.trim().length >= 32 ? 'set' : 'missing-or-short'}`
}
