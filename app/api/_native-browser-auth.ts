import { json, originCheck, readJsonLenient, serverError } from '@/app/api/_http'
import { getSessionUser } from '@/lib/auth'
import { clearSessionCookie, setSessionCookie, signIn, signSessionToken } from '@/lib/auth/native'
import { getClientIp } from '@/lib/ip'
import { logger } from '@/lib/logger'
import { reserveRateLimit } from '@/lib/rate-limit'

export async function nativeBrowserLogin(request: Request) {
  const originError = originCheck(request)
  if (originError) return originError

  const body = await readJsonLenient(request)
  const { email, password } = (body ?? {}) as { email?: unknown; password?: unknown }

  if (typeof email !== 'string' || typeof password !== 'string') {
    return json({ error: 'Email and password are required.' }, 400)
  }

  const normalized = email.trim().toLowerCase()
  const ip = getClientIp(request)
  // Only failed credentials keep a slot; successes and server faults refund it.
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
      return json({ error: error ?? 'Invalid email or password.' }, 401)
    }

    await reservation.release()

    const token = sessionVersion === undefined
      ? await signSessionToken(user)
      : await signSessionToken(user, sessionVersion)
    await setSessionCookie(token)
    return json({ user })
  } catch (err) {
    await reservation.release()
    return serverError(err)
  }
}

export async function nativeBrowserLogout(request: Request) {
  const originError = originCheck(request)
  if (originError) return originError

  await clearSessionCookie()
  return json({ ok: true })
}

export async function nativeBrowserSession() {
  const user = await getSessionUser()
  return json({ user })
}
