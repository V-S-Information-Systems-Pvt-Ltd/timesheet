import { json, originCheck, serverError } from '@/app/api/_http'
import { IS_NATIVE } from '@/lib/backend/config'
import { getSessionUser } from '@/lib/auth'
import { changePassword, signSessionToken, setSessionCookie } from '@/lib/auth/native'
import { passwordSchema } from '@/lib/validation-schemas'
import { reserveRateLimit } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { getClientIp } from '@/lib/ip'

function assertNever(value: never): never {
  throw new Error(`Unhandled password-change outcome: ${JSON.stringify(value)}`)
}

export async function POST(request: Request) {
  if (!IS_NATIVE) {
    return json({ error: 'Endpoint only available in native backend mode.' }, 404)
  }

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
    const result = await changePassword(
      session.id,
      currentPassword,
      newPassword,
      { expectedSessionVersion: session.sessionVersion }
    )

    switch (result.outcome) {
      case 'success': {
        await reservation.release()
        const token = await signSessionToken(session, result.sessionVersion)
        await setSessionCookie(token)
        return json({ error: null })
      }
      case 'invalid_credentials':
        return json({ error: result.error })
      case 'session_revoked':
        await reservation.release()
        return json({ error: result.error }, 401)
      case 'update_failed':
        await reservation.release()
        return json({ error: result.error })
      default:
        return assertNever(result)
    }
  } catch (err) {
    await reservation.release()
    return serverError(err)
  }
}
