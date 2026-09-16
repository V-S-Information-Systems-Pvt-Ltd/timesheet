import { json, originCheck, serverError } from '@/app/api/_http'
import { IS_NATIVE } from '@/lib/backend/config'
import { getClientIp } from '@/lib/ip'
import { reserveRateLimit } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { registrationPort } from '@/lib/auth/registration'
import { registerUser } from '@/lib/auth/registration-service'

export async function POST(request: Request) {
  if (!IS_NATIVE) {
    return json({ error: 'Endpoint only available in native backend mode.' }, 404)
  }

  const originError = originCheck(request)
  if (originError) return originError

  let body: unknown = {}
  try {
    body = await request.json()
  } catch {
    body = {}
  }

  // Rate limit by IP (hourly window) to slow brute-force scrypt burn and
  // account-enumeration scans. Every signup attempt consumes budget so an
  // attacker cannot endlessly probe whether a domain is whitelisted or an
  // email already exists — so the reservation is never released.
  const ip = getClientIp(request)
  const reservation = await reserveRateLimit('daily-signup', `signup:${ip}`)
  if (!reservation.ok) {
    logger.warn('rate limit: signup exceeded', { ip, retryAfter: reservation.retryAfter })
    return json({ error: 'Too many signup attempts. Try again later.' }, 429, {
      'Retry-After': String(reservation.retryAfter),
    })
  }

  try {
    const outcome = await registerUser(body as Record<string, unknown>, registrationPort)

    if (!outcome.ok) {
      switch (outcome.error.code) {
        case 'VALIDATION_ERROR':
          return json({ error: outcome.error.message }, 400)
        case 'DOMAIN_NOT_ALLOWED':
          return json({ error: outcome.error.message }, 403)
        case 'ACCOUNT_EXISTS':
          return json({ error: outcome.error.message }, 409)
        case 'UNSUPPORTED':
          return json({ error: outcome.error.message }, 404)
      }
    }

    return json({
      success: true,
      isActive: outcome.data.isActive,
      message: outcome.data.message,
    })
  } catch (err) {
    return serverError(err)
  }
}
