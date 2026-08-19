// app/api/auth/login/route.ts
import { json, serverError } from '@/app/api/_http'
import { setSessionCookie, signIn, signSessionToken } from '@/lib/auth/native'
import { checkRateLimit, dailyLoginStore, RATE_LIMIT_LOGIN, WINDOWS, getRetryAfter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'

export async function POST(request: Request) {
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

  // Rate limit by email (hourly window) to slow brute-force attempts.
  const rate = checkRateLimit(dailyLoginStore, `login:${email.trim().toLowerCase()}`, RATE_LIMIT_LOGIN, WINDOWS.hour)
  if (!rate.ok) {
    const retry = getRetryAfter(rate.resetAt)
    logger.warn('rate limit: login exceeded', { email, retryAfter: retry })
    return json({ error: 'Too many login attempts. Try again later.' }, 429, {
      'Retry-After': String(retry),
    })
  }

  try {
    const { user, error } = await signIn(email.trim().toLowerCase(), password)
    if (error || !user) {
      return json({ error: error ?? 'Invalid email or password.' }, 401)
    }

    await setSessionCookie(await signSessionToken(user))
    return json({ user })
  } catch (err) {
    return serverError(err)
  }
}
