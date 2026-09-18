import { withMobileActor, json, apiSuccess, serverError, apiError, parseJsonBody } from '@/app/api/v1/_http'
import { changePassword } from '@/lib/auth/native'
import { mobileSessionStore } from '@/lib/auth/mobile-session-store'
import { passwordSchema } from '@/lib/validation-schemas'
import { reserveRateLimit } from '@/lib/rate-limit'
import { getClientIp } from '@/lib/ip'
import { IS_NATIVE } from '@/lib/backend/config'
import {
  changePasswordForActor,
  completeMobilePasswordChange,
  revokeOtherMobileSessions,
} from '@/lib/auth/identity-service'
import { createSupabaseMobilePasswordPort } from '@/lib/auth/supabase-mobile-password'

export const runtime = 'nodejs'

type ApiResponse = ReturnType<typeof json>
type SupabaseFailure = { code: string; message: string; status: number }

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

      if (IS_NATIVE) {
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
      } else {
        const provider = createSupabaseMobilePasswordPort({
          url: process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://mock.supabase.co',
          anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'mock-anon-key',
        })
        const sessionDeps = { sessions: mobileSessionStore }
        let providerAuthenticated = false
        let cleanupStarted = false
        let mobilePasswordChangeStarted = false

        const finish = async (
          failure: SupabaseFailure | null,
          passwordChanged = false
        ): Promise<ApiResponse> => {
          const cleanupError = providerAuthenticated && !cleanupStarted
            ? await (async () => {
                cleanupStarted = true
                return provider.cleanup()
              })()
            : null

          if (failure?.code === 'INVALID_CREDENTIALS') keepReservation = true
          if (cleanupError) {
            const prefix = failure?.message ?? (passwordChanged ? 'Password changed.' : 'Password change failed.')
            return apiError(
              'PASSWORD_UPDATE_FAILED',
              `${prefix} Failed to clean up the temporary provider session: ${cleanupError}.`,
              500
            )
          }
          if (failure) return apiError(failure.code, failure.message, failure.status)
          return apiSuccess({ success: true })
        }

        const completeMobileChange = async (
          failure: SupabaseFailure | null,
          passwordChanged = false
        ): Promise<ApiResponse> => {
          try {
            await completeMobilePasswordChange(auth.actor.id, auth.sessionId, sessionDeps)
            mobilePasswordChangeStarted = false
          } catch {
            const prefix = failure?.message ?? (passwordChanged ? 'Password changed.' : 'Password change failed.')
            return await finish({
              code: 'PASSWORD_UPDATE_FAILED',
              message: `${prefix} Failed to finalize mobile-session revocation.`,
              status: 500,
            }, passwordChanged)
          }
          return await finish(failure, passwordChanged)
        }

        try {
          const authenticateResult = await provider.authenticate({
            email: auth.actor.email,
            currentPassword,
          })
          if (!authenticateResult.ok) {
            return await finish({ code: 'INVALID_CREDENTIALS', message: 'Current password is incorrect.', status: 400 })
          }
          providerAuthenticated = true

          // Revoke all other mobile sessions for this actor while preserving current.
          // This runs BEFORE the provider write: a failed revoke must never be
          // followed by an unprotected password change.
          let revokeStatus: 'revoked' | 'conflict'
          try {
            revokeStatus = await revokeOtherMobileSessions(auth.actor.id, auth.sessionId, sessionDeps)
          } catch {
            return await finish(
              {
                code: 'PASSWORD_UPDATE_FAILED',
                message: 'Could not revoke other sessions; password was not changed.',
                status: 500,
              }
            )
          }
          if (revokeStatus === 'conflict') {
            return await finish({
              code: 'SESSION_REVOKED',
              message: 'The mobile session is no longer valid. Please sign in again.',
              status: 401,
            })
          }
          mobilePasswordChangeStarted = true

          const updateResult = await provider.updatePassword({ currentPassword, newPassword })
          if (!updateResult.ok) {
            if (updateResult.kind === 'request_failed') {
              return await completeMobileChange({
                code: 'PASSWORD_UPDATE_FAILED',
                message: 'Password update failed after other mobile sessions were revoked.',
                status: 500,
              })
            }
            // Other mobile sessions were already revoked above; say so
            // truthfully instead of implying nothing changed.
            return await completeMobileChange({
              code: 'PASSWORD_UPDATE_FAILED',
              message: `${updateResult.message} Note: other mobile sessions were already revoked.`,
              status: 400,
            })
          }

          const revokeOthers = await provider.revokeOtherProviderSessions()
          if (!revokeOthers.ok) {
            const message = revokeOthers.kind === 'provider_error'
              ? `Password changed, but failed to revoke other sessions: ${revokeOthers.message}`
              : 'Password changed, but failed to revoke other sessions.'
            return await completeMobileChange(
              { code: 'PASSWORD_UPDATE_FAILED', message, status: 500 },
              true
            )
          }

          return await completeMobileChange(null, true)
        } catch (err) {
          if (providerAuthenticated && mobilePasswordChangeStarted) {
            return await completeMobileChange(
              {
                code: 'PASSWORD_UPDATE_FAILED',
                message: 'Password change failed after other mobile sessions were revoked.',
                status: 500,
              }
            )
          }
          throw err
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
