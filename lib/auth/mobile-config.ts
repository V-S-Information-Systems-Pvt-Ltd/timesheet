// lib/auth/mobile-config.ts
import 'server-only'
import { IS_SUPABASE } from '@/lib/backend/config'

/**
 * Validates whether mobile bearer authentication is fully enabled and correctly configured.
 * Requires explicit MOBILE_BEARER_AUTH_ENABLED === 'true' and a valid backend signing secret
 * of at least 32 characters.
 */
export function isMobileBearerAuthEnabled(): boolean {
  if (process.env.MOBILE_BEARER_AUTH_ENABLED !== 'true') {
    return false
  }

  if (process.env.MOBILE_AUTH_SECRET !== undefined && !process.env.MOBILE_AUTH_SECRET.trim()) {
    return false
  }

  if (IS_SUPABASE) {
    const key =
      process.env.MOBILE_AUTH_SECRET ||
      process.env.SUPABASE_JWT_SECRET ||
      process.env.SUPABASE_MOBILE_SIGNING_KEY
    return Boolean(key && key.trim().length > 0)
  }

  const secret = process.env.MOBILE_AUTH_SECRET
  return Boolean(secret && secret.trim().length > 0)
}
