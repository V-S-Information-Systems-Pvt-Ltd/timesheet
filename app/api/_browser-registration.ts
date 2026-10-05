import { json, originCheck, readJsonLenient, serverError } from '@/app/api/_http'
import { registrationPort } from '@/lib/auth/registration'
import { checkDomainEligibility, registerUser } from '@/lib/auth/registration-service'
import { getClientIp } from '@/lib/ip'
import { extractError, logger } from '@/lib/logger'
import { reserveRateLimit } from '@/lib/rate-limit'

export async function browserSignUp(request: Request) {
  const originError = originCheck(request)
  if (originError) return originError

  const body = await readJsonLenient(request)

  const ip = getClientIp(request)
  // Every attempt counts, including validation and domain/account probes.
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
        case 'CONFIGURATION':
          logger.error('registration blocked: provider configuration is unsafe', { ip })
          return json({ error: outcome.error.message }, 503)
        case 'UNCERTAIN':
          logger.error('registration outcome uncertain after provider signup', { ip })
          return json({ error: outcome.error.message }, 503)
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

export async function browserDomainCheck(request: Request) {
  // Every unauthenticated probe consumes its own per-IP enumeration budget.
  const ip = getClientIp(request)
  const reservation = await reserveRateLimit('daily-signup', `domaincheck:${ip}`)
  if (!reservation.ok) {
    logger.warn('rate limit: domain check exceeded', { ip, retryAfter: reservation.retryAfter })
    return json(
      { allowed: false, autoActivate: false, error: 'Too many attempts. Try again later.' },
      429,
      { 'Retry-After': String(reservation.retryAfter) }
    )
  }

  const email = new URL(request.url).searchParams.get('email')

  try {
    const outcome = await checkDomainEligibility(email, registrationPort)
    if (!outcome.ok) {
      return json({ allowed: false, autoActivate: false, error: outcome.error }, 400)
    }
    return json({
      allowed: outcome.data.allowed,
      autoActivate: outcome.data.autoActivate,
    })
  } catch (err) {
    logger.error(extractError(err))
    return json({
      allowed: false,
      autoActivate: false,
      error: 'Failed to check registration domain.',
    })
  }
}
