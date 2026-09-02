import { json, originCheck, serverError } from '@/app/api/_http'
import { clearSessionCookie } from '@/lib/auth/native'
import { consumePasswordResetToken } from '@/lib/db/password-recovery'
import { getClientIp } from '@/lib/ip'
import { passwordSchema } from '@/lib/validation-schemas'
import { logger } from '@/lib/logger'
import {
  consumeRateLimit,
  getRetryAfter,
  passwordResetCompleteStore,
  peekRateLimit,
  RATE_LIMIT_PASSWORD_RESET_COMPLETE,
  WINDOWS,
} from '@/lib/rate-limit'

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

  const ip = getClientIp(request)
  const key = `password-reset-complete:${ip}`
  const peeked = peekRateLimit(
    passwordResetCompleteStore,
    key,
    RATE_LIMIT_PASSWORD_RESET_COMPLETE,
    WINDOWS.hour
  )
  if (!peeked.ok) {
    return json({ error: 'Too many attempts. Try again later.' }, 429, {
      ...NO_STORE,
      'Retry-After': String(getRetryAfter(peeked.resetAt)),
    })
  }

  if (token.length < 32 || token.length > 256) {
    consumeRateLimit(
      passwordResetCompleteStore,
      key,
      RATE_LIMIT_PASSWORD_RESET_COMPLETE,
      WINDOWS.hour
    )
    return json({ error: INVALID_RESET_MESSAGE }, 400, NO_STORE)
  }
  const check = passwordSchema.safeParse(newPassword)
  if (!check.success) {
    return json({ error: check.error.issues[0]?.message ?? 'Invalid password.' }, 400, NO_STORE)
  }

  try {
    const result = await consumePasswordResetToken(token, newPassword)
    if (!result.ok) {
      consumeRateLimit(
        passwordResetCompleteStore,
        key,
        RATE_LIMIT_PASSWORD_RESET_COMPLETE,
        WINDOWS.hour
      )
      return json({ error: INVALID_RESET_MESSAGE }, 400, NO_STORE)
    }

    logger.info('auth.password_reset_completed', { userId: result.userId })
    await clearSessionCookie()
    return json({ error: null }, 200, NO_STORE)
  } catch (err) {
    const response = serverError(err)
    response.headers.set('Cache-Control', 'no-store, private')
    return response
  }
}
