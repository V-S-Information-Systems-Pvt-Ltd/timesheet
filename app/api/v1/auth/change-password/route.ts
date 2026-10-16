import { withMobileActor, json, apiSuccess, serverError, apiError, parseJsonBody } from '@/app/api/v1/_http'
import { changePassword } from '@/lib/auth/native'
import { passwordSchema } from '@/lib/validation-schemas'
import { reserveRateLimit } from '@/lib/rate-limit'
import { getClientIp } from '@/lib/ip'
import { changePasswordForActor } from '@/lib/auth/identity-service'

export const runtime = 'nodejs'


export async function POST(request: Request) {
  return withMobileActor(request, async (auth) => {
    let releaseReservation: (() => Promise<void>) | undefined
    let keepReservation = false
    try {
      const parsedBody = await parseJsonBody(request)
      if (!parsedBody.ok) return parsedBody.response
      const body = parsedBody.body

      const { currentPassword, newPassword } = (body ?? {}) as {
        currentPassword?: unknown
        newPassword?: unknown
      }

      if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
        return apiError('VALIDATION_ERROR', 'Current and new password are required.', 400)
      }

      const check = passwordSchema.safeParse(newPassword)
      if (!check.success) {
        return apiError('VALIDATION_ERROR', check.error.issues[0]?.message ?? 'Invalid password.', 400)
      }

      // Failed current-password verifications per user+IP. Only failures keep the
      // reserved slot; a successful change releases it.
      const ip = getClientIp(request)
      const reservation = await reserveRateLimit('daily-password', `pwchange:${auth.actor.id}:${ip}`)
      if (!reservation.ok) {
        return json(
          {
            data: null,
            error: {
              code: 'RATE_LIMITED',
              message: 'Too many password change attempts. Try again later.',
            },
          },
          429,
          {
            'Retry-After': String(reservation.retryAfter),
          }
        )
      }
      releaseReservation = reservation.release

      {
        const result = await changePasswordForActor(
          auth.actor.id,
          { currentPassword, newPassword },
          { preserveSessionId: auth.sessionId },
          { passwords: { changePassword } }
        )
        if (result.outcome === 'invalid_credentials') {
          keepReservation = true
          return apiError('INVALID_CREDENTIALS', result.error, 400)
        }
        if (result.outcome === 'session_revoked') {
          return apiError('SESSION_REVOKED', result.error, 401)
        }
        if (result.outcome === 'update_failed') {
          return apiError('PASSWORD_UPDATE_FAILED', result.error, 500)
        }
      }

      return apiSuccess({ success: true })

    } catch (err) {
      return serverError(err)
    } finally {
      if (!keepReservation) await releaseReservation?.()
    }
  })
}
