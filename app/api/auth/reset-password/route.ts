import { json, originCheck, serverError } from '@/app/api/_http'
import { clearSessionCookie } from '@/lib/auth/native'
import { consumePasswordResetToken } from '@/lib/db/password-recovery'
import { getClientIp } from '@/lib/ip'
import { passwordSchema } from '@/lib/validation-schemas'
import { logger } from '@/lib/logger'
import { reserveRateLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store, private' }
const INVALID_RESET_MESSAGE = 'This password reset link is invalid or has expired.'

export async function POST(request: Request) {
  const originError = originCheck(request)
  if (originError) return originError

  let body: unknown = {}
  try {
    body = await request.json()
  } catch {
    body = {}
  }

  const token = typeof (body as { token?: unknown })?.token === 'string'
    ? (body as { token: string }).token
    : ''
  const newPassword = typeof (body as { newPassword?: unknown })?.newPassword === 'string'
    ? (body as { newPassword: string }).newPassword
    : ''

  // Only INVALID token attempts count against the budget, so a user who fumbles
  // their new password is not locked out of a valid reset link.
  const ip = getClientIp(request)
  const reservation = await reserveRateLimit('password-reset-complete', `password-reset-complete:${ip}`)
  if (!reservation.ok) {
    return json({ error: 'Too many attempts. Try again later.' }, 429, {
      ...NO_STORE,
      'Retry-After': String(reservation.retryAfter),
    })
  }

  if (token.length < 32 || token.length > 256) {
    // Malformed token: keep the slot.
    return json({ error: INVALID_RESET_MESSAGE }, 400, NO_STORE)
  }
  const check = passwordSchema.safeParse(newPassword)
  if (!check.success) {
    await reservation.release()
    return json({ error: check.error.issues[0]?.message ?? 'Invalid password.' }, 400, NO_STORE)
  }

  try {
    const result = await consumePasswordResetToken(token, newPassword)
    if (!result.ok) {
      // Token rejected: keep the slot.
      return json({ error: INVALID_RESET_MESSAGE }, 400, NO_STORE)
    }

    await reservation.release()
    logger.info('auth.password_reset_completed', { userId: result.userId })
    await clearSessionCookie()
    return json({ error: null }, 200, NO_STORE)
  } catch (err) {
    await reservation.release()
    const response = serverError(err)
    response.headers.set('Cache-Control', 'no-store, private')
    return response
  }
}
