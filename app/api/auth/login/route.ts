import { json, originCheck, serverError } from '@/app/api/_http'
import { setSessionCookie, signIn, signSessionToken } from '@/lib/auth/native'
import { reserveRateLimit } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { getClientIp } from '@/lib/ip'

export async function POST(request: Request) {
  const originError = originCheck(request)
  if (originError) return originError

  let body: unknown = {}
  try {
    body = await request.json()
  } catch {
    body = {}
  }
  const { email, password } = (body ?? {}) as { email?: unknown; password?: unknown }

  if (typeof email !== 'string' || typeof password !== 'string') {
    return json({ error: 'Email and password are required.' }, 400)
  }

  // Rate limit by IP + email (hourly window) to slow brute-force attempts.
  // Only FAILED attempts count against the budget (see USER_GUIDE), so
  // successful logins never lock an account by mistake — the slot is reserved
  // up front and released again below when the credentials verify.
  const normalized = email.trim().toLowerCase()
  const ip = getClientIp(request)

  const reservation = await reserveRateLimit('daily-login', `login:${normalized}:${ip}`)
  if (!reservation.ok) {
    logger.warn('rate limit: login exceeded', {
      email: normalized,
      retryAfter: reservation.retryAfter,
    })
    return json({ error: 'Too many login attempts. Try again later.' }, 429, {
      'Retry-After': String(reservation.retryAfter),
    })
  }

  try {
    const { user, error, sessionVersion } = await signIn(normalized, password)
    if (error || !user) {
      // Keep the slot: this attempt was a failure and must count.
      return json({ error: error ?? 'Invalid email or password.' }, 401)
    }

    await reservation.release()

    const token = sessionVersion === undefined
      ? await signSessionToken(user)
      : await signSessionToken(user, sessionVersion)
    await setSessionCookie(token)
    return json({ user })
  } catch (err) {
    // A server fault is not a failed credential attempt, so refund the slot.
    await reservation.release()
    return serverError(err)
  }
}
