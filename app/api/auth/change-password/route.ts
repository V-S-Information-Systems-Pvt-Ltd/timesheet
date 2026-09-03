import { json, originCheck, serverError } from '@/app/api/_http'
import { getSessionUser } from '@/lib/auth'
import { changePassword } from '@/lib/auth/native'
import { passwordSchema } from '@/lib/validation-schemas'
import { reserveRateLimit } from '@/lib/rate-limit'
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
  // Like the login route, only FAILED attempts consume budget: the slot is
  // reserved here and released when the change succeeds. Cheap validation
  // failures above never reach this limiter, so legitimate users fixing a weak
  // new password are not punished.
  const ip = getClientIp(request)
  const reservation = await reserveRateLimit('daily-password', `pwchange:${session.id}:${ip}`)
  if (!reservation.ok) {
    logger.warn('rate limit: password change exceeded', {
      userId: session.id,
      retryAfter: reservation.retryAfter,
    })
    return json({ error: 'Too many attempts. Try again later.' }, 429, {
      'Retry-After': String(reservation.retryAfter),
    })
  }

  try {
    const { error } = await changePassword(session.id, currentPassword, newPassword)
    // Keep the slot only when the current password failed to verify.
    if (!error) await reservation.release()
    return json({ error })
  } catch (err) {
    await reservation.release()
    return serverError(err)
  }
}
