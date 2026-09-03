import { createHash } from 'node:crypto'
import { json, originCheck } from '@/app/api/_http'
import { issuePasswordResetToken } from '@/lib/db/password-recovery'
import { sendPasswordResetEmail } from '@/lib/email/password-reset'
import { getClientIp } from '@/lib/ip'
import { isValidEmail } from '@/lib/validation'
import { reserveRateLimit } from '@/lib/rate-limit'
import { logger, extractError } from '@/lib/logger'

export const runtime = 'nodejs'

export const PASSWORD_RESET_REQUEST_MESSAGE =
  'If an account exists for that email, we sent a password reset link.'

const NO_STORE = { 'Cache-Control': 'no-store, private' }
const MIN_RESPONSE_MS = 180

function emailFingerprint(email: string): string {
  return createHash('sha256').update(email, 'utf8').digest('hex').slice(0, 16)
}

async function waitForMinimumResponse(startedAt: number): Promise<void> {
  const remaining = MIN_RESPONSE_MS - (Date.now() - startedAt)
  if (remaining > 0) await new Promise<void>((resolve) => setTimeout(resolve, remaining))
}

export async function POST(request: Request) {
  const originError = originCheck(request)
  if (originError) return originError

  const startedAt = Date.now()
  let body: unknown = {}
  try {
    body = await request.json()
  } catch {
    body = {}
  }

  const email = typeof (body as { email?: unknown })?.email === 'string'
    ? (body as { email: string }).email.trim().toLowerCase()
    : ''
  if (!isValidEmail(email)) {
    return json({ error: 'Please enter a valid email address.' }, 400, NO_STORE)
  }

  const ip = getClientIp(request)
  // Every request counts, so the reservation is never released: the response is
  // deliberately identical whether or not the account exists, and a caller must
  // not be able to distinguish them by probing repeatedly.
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
        // Do not turn delivery details or account existence into a user-visible
        // signal. The operational log contains no raw token or reset URL.
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
