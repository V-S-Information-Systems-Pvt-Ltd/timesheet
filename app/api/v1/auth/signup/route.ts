import { json, apiError, serverError, getRequestId } from '@/app/api/v1/_http'
import { IS_NATIVE } from '@/lib/backend/config'
import { getClientIp } from '@/lib/ip'
import { reserveRateLimit } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { isMobileBearerAuthEnabled } from '@/lib/auth/mobile-config'
import { registrationPort } from '@/lib/auth/registration'
import { registerUser } from '@/lib/auth/registration-service'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  if (!IS_NATIVE) {
    return apiError('NOT_SUPPORTED', 'Native signup is disabled in Supabase mode.', 404)
  }

  if (!isMobileBearerAuthEnabled()) {
    return apiError('MOBILE_API_DISABLED', 'Mobile API access is temporarily disabled.', 503, {
      'x-request-id': getRequestId(request),
    })
  }

  let body: unknown = {}
  try {
    body = await request.json()
  } catch {
    body = {}
  }

  const ip = getClientIp(request)
  const reservation = await reserveRateLimit('daily-signup', `signup:${ip}`)
  if (!reservation.ok) {
    logger.warn('rate limit: v1 signup exceeded', { ip, retryAfter: reservation.retryAfter })
    return apiError('RATE_LIMITED', 'Too many signup attempts. Try again later.', 429, {
      'Retry-After': String(reservation.retryAfter),
    })
  }

  try {
    const outcome = await registerUser(body as Record<string, unknown>, registrationPort)

    if (!outcome.ok) {
      switch (outcome.error.code) {
        case 'VALIDATION_ERROR':
          return apiError('VALIDATION_ERROR', outcome.error.message, 400)
        case 'DOMAIN_NOT_ALLOWED':
          return apiError('DOMAIN_NOT_ALLOWED', outcome.error.message, 403)
        case 'ACCOUNT_EXISTS':
          return apiError('ACCOUNT_EXISTS', outcome.error.message, 409)
        case 'UNSUPPORTED':
          return apiError('NOT_SUPPORTED', outcome.error.message, 404)
      }
    }

    return json(
      {
        data: outcome.data,
        error: null,
      },
      201
    )
  } catch (err) {
    return serverError(err)
  }
}
