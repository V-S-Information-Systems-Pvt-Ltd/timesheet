// app/api/auth/login/route.ts
import { json, originCheck, serverError } from '@/app/api/_http'
import { setSessionCookie, signIn, signSessionToken } from '@/lib/auth/native'
import { peekRateLimit, consumeRateLimit, dailyLoginStore, RATE_LIMIT_LOGIN, WINDOWS, getRetryAfter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'

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
  // successful logins never lock an account by mistake.
  const normalized = email.trim().toLowerCase()
  const ip = (request.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'local'
  const key = `login:${normalized}:${ip}`

  // Reject early when the budget is already exhausted without consuming.
  const peeked = peekRateLimit(dailyLoginStore, key, RATE_LIMIT_LOGIN, WINDOWS.hour)
  if (!peeked.ok) {
    const retry = getRetryAfter(peeked.resetAt)
    logger.warn('rate limit: login exceeded', { email: normalized, retryAfter: retry })
    return json({ error: 'Too many login attempts. Try again later.' }, 429, {
      'Retry-After': String(retry),
    })
  }

  try {
    const { user, error } = await signIn(normalized, password)
    if (error || !user) {
      consumeRateLimit(dailyLoginStore, key, RATE_LIMIT_LOGIN, WINDOWS.hour)
      return json({ error: error ?? 'Invalid email or password.' }, 401)
    }

    await setSessionCookie(await signSessionToken(user))
    return json({ user })
  } catch (err) {
    return serverError(err)
  }
}
