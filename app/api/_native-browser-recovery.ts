import { createHash } from 'node:crypto'
import { json, originCheck, readJsonLenient, serverError } from '@/app/api/_http'
import { clearSessionCookie } from '@/lib/auth/native'
import { consumePasswordResetToken, issuePasswordResetToken } from '@/lib/db/password-recovery'
import { sendPasswordResetEmail } from '@/lib/email/password-reset'
import { getClientIp } from '@/lib/ip'
import { extractError, logger } from '@/lib/logger'
import { reserveRateLimit } from '@/lib/rate-limit'
import { isValidEmail } from '@/lib/validation'
import { passwordSchema } from '@/lib/validation-schemas'

export const PASSWORD_RESET_REQUEST_MESSAGE =
  'If an account exists for that email, we sent a password reset link.'

const NO_STORE = { 'Cache-Control': 'no-store, private' }
const MIN_RESPONSE_MS = 180
const INVALID_RESET_MESSAGE = 'This password reset link is invalid or has expired.'

function emailFingerprint(email: string): string {
  return createHash('sha256').update(email, 'utf8').digest('hex').slice(0, 16)
}

async function waitForMinimumResponse(startedAt: number): Promise<void> {
  const remaining = MIN_RESPONSE_MS - (Date.now() - startedAt)
  if (remaining > 0) await new Promise<void>((resolve) => setTimeout(resolve, remaining))
}

export async function browserForgotPassword(request: Request) {
  const originError = originCheck(request)
  if (originError) return originError

  const startedAt = Date.now()
  const body = await readJsonLenient(request)

  const email = typeof (body as { email?: unknown })?.email === 'string'
    ? (body as { email: string }).email.trim().toLowerCase()
    : ''
  if (!isValidEmail(email)) {
    return json({ error: 'Please enter a valid email address.' }, 400, NO_STORE)
  }

  const ip = getClientIp(request)
  // Every request counts; known, unknown, failed and limited responses remain
  // non-enumerating and timed. Logs never include tokens or reset URLs.
  const reservation = await reserveRateLimit(
    'password-reset-request',
    `password-reset-request:${emailFingerprint(email)}:${ip}`
  )

  if (!reservation.ok) {
    await waitForMinimumResponse(startedAt)
    return json(
      { message: PASSWORD_RESET_REQUEST_MESSAGE },
      200,
      { ...NO_STORE, 'Retry-After': String(reservation.retryAfter) }
    )
  }

  try {
    const issued = await issuePasswordResetToken(email)
    if (issued) {
      try {
        await sendPasswordResetEmail({
          to: issued.email,
          token: issued.token,
          expiresAt: issued.expiresAt,
        })
      } catch (err) {
        logger.error('password reset email delivery failed', {
          account: emailFingerprint(email),
          error: extractError(err),
        })
      }
    }
  } catch (err) {
    logger.error('password reset request failed', {
      account: emailFingerprint(email),
      error: extractError(err),
    })
  }

  await waitForMinimumResponse(startedAt)
  return json({ message: PASSWORD_RESET_REQUEST_MESSAGE }, 200, NO_STORE)
}

export async function browserResetPassword(request: Request) {
  const originError = originCheck(request)
  if (originError) return originError

  const body = await readJsonLenient(request)

  const token = typeof (body as { token?: unknown })?.token === 'string'
    ? (body as { token: string }).token
    : ''
  const newPassword = typeof (body as { newPassword?: unknown })?.newPassword === 'string'
    ? (body as { newPassword: string }).newPassword
    : ''

  const ip = getClientIp(request)
  const reservation = await reserveRateLimit('password-reset-complete', `password-reset-complete:${ip}`)
  if (!reservation.ok) {
    return json({ error: 'Too many attempts. Try again later.' }, 429, {
      ...NO_STORE,
      'Retry-After': String(reservation.retryAfter),
    })
  }

  if (token.length < 32 || token.length > 256) {
    // Invalid tokens consume budget; password-policy failures release it.
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
