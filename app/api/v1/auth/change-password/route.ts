import { withMobileActor, json, serverError, apiError, parseJsonBody } from '@/app/api/v1/_http'
import { changePassword } from '@/lib/auth/native'
import { mobileSessionStore } from '@/lib/auth/mobile-session-store'
import { passwordSchema } from '@/lib/validation-schemas'
import { reserveRateLimit } from '@/lib/rate-limit'
import { getClientIp } from '@/lib/ip'
import { IS_NATIVE } from '@/lib/backend/config'
import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

type ApiResponse = ReturnType<typeof json>
type SupabaseFailure = { code: string; message: string; status: number }

async function cleanupEphemeralProviderSession(
  client: Pick<SupabaseClient, 'auth'>
): Promise<string | null> {
  try {
    const result = await client.auth.signOut({ scope: 'local' })
    return result?.error?.message ?? null
  } catch {
    return 'the provider cleanup request failed'
  }
}

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
        const result = await changePassword(auth.actor.id, currentPassword, newPassword, {
          preserveSessionId: auth.sessionId,
        })
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
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://mock.supabase.co'
        const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'mock-anon-key'
        const ephemeral = createSupabaseClient(supabaseUrl, anonKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        })
        let ephemeralAuthenticated = false
        let cleanupStarted = false
        let mobilePasswordChangeStarted = false

        const finish = async (
          failure: SupabaseFailure | null,
          passwordChanged = false
        ): Promise<ApiResponse> => {
          const cleanupError = ephemeralAuthenticated && !cleanupStarted
            ? await (async () => {
                cleanupStarted = true
                return cleanupEphemeralProviderSession(ephemeral)
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
          return json({ data: { success: true }, error: null })
        }

        const completeMobilePasswordChange = async (
          failure: SupabaseFailure | null,
          passwordChanged = false
        ): Promise<ApiResponse> => {
          try {
            await mobileSessionStore.completePasswordChange(auth.actor.id, auth.sessionId)
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
          const { error: signInError } = await ephemeral.auth.signInWithPassword({
            email: auth.actor.email,
            password: currentPassword,
          })
          if (signInError) {
            return await finish({ code: 'INVALID_CREDENTIALS', message: 'Current password is incorrect.', status: 400 })
          }
          ephemeralAuthenticated = true

          // Revoke all other mobile sessions for this actor while preserving current.
          // This runs BEFORE the provider write: a failed revoke must never be
          // followed by an unprotected password change.
          try {
            const revokeStatus = await mobileSessionStore.revokeOtherSessions(auth.actor.id, auth.sessionId)
            if (revokeStatus === 'conflict') {
              return await finish({
                code: 'SESSION_REVOKED',
                message: 'The mobile session is no longer valid. Please sign in again.',
                status: 401,
              })
            }
            mobilePasswordChangeStarted = true
          } catch {
            return await finish(
              {
                code: 'PASSWORD_UPDATE_FAILED',
                message: 'Could not revoke other sessions; password was not changed.',
                status: 500,
              }
            )
          }

          let updateError: { message: string } | null = null
          try {
            updateError = (await ephemeral.auth.updateUser({
              password: newPassword,
              current_password: currentPassword,
            })).error
          } catch {
            return await completeMobilePasswordChange(
              {
                code: 'PASSWORD_UPDATE_FAILED',
                message: 'Password update failed after other mobile sessions were revoked.',
                status: 500,
              }
            )
          }
          if (updateError) {
            // Other mobile sessions were already revoked above; say so
            // truthfully instead of implying nothing changed.
            return await completeMobilePasswordChange({
              code: 'PASSWORD_UPDATE_FAILED',
              message: `${updateError.message} Note: other mobile sessions were already revoked.`,
              status: 400,
            })
          }

          try {
            const { error: signOutErr } = await ephemeral.auth.signOut({ scope: 'others' })
            if (signOutErr) {
              return await completeMobilePasswordChange(
                {
                  code: 'PASSWORD_UPDATE_FAILED',
                  message: `Password changed, but failed to revoke other sessions: ${signOutErr.message}`,
                  status: 500,
                },
                true
              )
            }
          } catch {
            return await completeMobilePasswordChange(
              {
                code: 'PASSWORD_UPDATE_FAILED',
                message: 'Password changed, but failed to revoke other sessions.',
                status: 500,
              },
              true
            )
          }

          return await completeMobilePasswordChange(null, true)
        } catch (err) {
          if (ephemeralAuthenticated && mobilePasswordChangeStarted) {
            return await completeMobilePasswordChange(
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

      return json({ data: { success: true }, error: null })
    } catch (err) {
      return serverError(err)
    } finally {
      if (!keepReservation) await releaseReservation?.()
    }
  })
}
