// app/api/auth/change-password/route.ts
import { json, originCheck, serverError } from '@/app/api/_http'
import { getSessionUser } from '@/lib/auth'
import { changePassword } from '@/lib/auth/native'
import { passwordSchema } from '@/lib/validation-schemas'
import {
  peekRateLimit,
  consumeRateLimit,
  dailyPasswordStore,
  RATE_LIMIT_PASSWORD,
  WINDOWS,
  getRetryAfter,
} from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { getClientIp } from '@/lib/ip'

export async function POST(request: Request) {
  const originError = originCheck(request)
  if (originError) return originError

  const session = await getSessionUser()
  if (!session) return json({ error: 'You must be signed in.' }, 401)

  let body: unknown = {}
  try {
    body = await request.json()
  } catch {
    body = {}
  }
  const { currentPassword, newPassword } = (body ?? {}) as {
    currentPassword?: unknown
    newPassword?: unknown
  }

  if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
    return json({ error: 'Current and new password are required.' }, 400)
  }
  const check = passwordSchema.safeParse(newPassword)
  if (!check.success) {
    return json({ error: check.error.issues[0]?.message ?? 'Invalid password.' }, 400)
  }

  // Rate limit failed current-password verifications per user+IP (hourly
  // window) so a hijacked session cannot brute-force the current password.
  // Like the login route, only FAILED attempts consume budget. Cheap
  // validation failures above never reach this limiter, so legitimate users
  // fixing a weak new password are not punished.
  const ip = getClientIp(request)
  const key = `pwchange:${session.id}:${ip}`
  const peeked = peekRateLimit(dailyPasswordStore, key, RATE_LIMIT_PASSWORD, WINDOWS.hour)
  if (!peeked.ok) {
    const retry = getRetryAfter(peeked.resetAt)
    logger.warn('rate limit: password change exceeded', { userId: session.id, retryAfter: retry })
    return json({ error: 'Too many attempts. Try again later.' }, 429, {
      'Retry-After': String(retry),
    })
  }

  try {
    const { error } = await changePassword(session.id, currentPassword, newPassword)
    if (error) {
      consumeRateLimit(dailyPasswordStore, key, RATE_LIMIT_PASSWORD, WINDOWS.hour)
    }
    return json({ error })
  } catch (err) {
    return serverError(err)
  }
}
