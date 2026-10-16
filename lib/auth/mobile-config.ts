// lib/auth/mobile-config.ts
import 'server-only'

/**
 * Validates whether mobile bearer authentication is fully enabled and correctly configured.
 * Requires explicit MOBILE_BEARER_AUTH_ENABLED === 'true' and a valid backend signing secret
 * (MOBILE_AUTH_SECRET, at least 32 characters).
 */
export function isMobileBearerAuthEnabled(): boolean {
  if (process.env.MOBILE_BEARER_AUTH_ENABLED !== 'true') {
    return false
  }

  const secret = process.env.MOBILE_AUTH_SECRET
  return Boolean(secret && secret.trim().length >= 32)
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
  const secret = process.env.MOBILE_AUTH_SECRET
  return `backend=native secret=${secret && secret.trim().length >= 32 ? 'set' : 'missing-or-short'}`
}
