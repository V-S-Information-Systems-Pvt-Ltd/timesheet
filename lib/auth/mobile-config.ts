// lib/auth/mobile-config.ts
import 'server-only'

import { secretProblem } from '@/lib/secret-env'

/** Why MOBILE_AUTH_SECRET is unusable (short, placeholder, or shared with AUTH_SECRET), or null. */
function mobileSecretProblem(): string | null {
  const secret = process.env.MOBILE_AUTH_SECRET
  const problem = secretProblem('MOBILE_AUTH_SECRET', secret)
  if (problem) return problem
  return secret === process.env.AUTH_SECRET ? 'MOBILE_AUTH_SECRET must differ from AUTH_SECRET.' : null
}

/**
 * Validates whether mobile bearer authentication is fully enabled and correctly configured.
 * Requires explicit MOBILE_BEARER_AUTH_ENABLED === 'true' and a valid backend signing secret
 * (MOBILE_AUTH_SECRET: at least 32 characters, not a placeholder, distinct from AUTH_SECRET).
 */
export function isMobileBearerAuthEnabled(): boolean {
  if (process.env.MOBILE_BEARER_AUTH_ENABLED !== 'true') {
    return false
  }
  return mobileSecretProblem() === null
}

/** Durable idempotency (replay of queued offline mutations) is always on: native execution is transactional. */
export function isDurableIdempotencyEnabled(): boolean {
  return true
}

/**
 * Short non-secret description of the bearer configuration for startup logs.
 * Never includes key material.
 */
export function describeMobileBearerConfig(): string {
  return `backend=native secret=${mobileSecretProblem() === null ? 'set' : 'missing-short-placeholder-or-shared'}`
}
