import { withMobileActor, json, serverError, apiError } from '@/app/api/v1/_http'
import { changePassword } from '@/lib/auth/native'
import { mobileSessionStore } from '@/lib/auth/mobile-session-store'
import { passwordSchema } from '@/lib/validation-schemas'
import { reserveRateLimit } from '@/lib/rate-limit'
import { getClientIp } from '@/lib/ip'
import { IS_NATIVE } from '@/lib/backend'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  return withMobileActor(request, async (auth) => {
    let releaseReservation: (() => Promise<void>) | undefined
    let keepReservation = false
    try {
      let body: unknown
      try {
        body = await request.json()
      } catch {
        return apiError('VALIDATION_ERROR', 'A JSON request body is required.', 400)
      }

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
        const { error } = await changePassword(auth.actor.id, currentPassword, newPassword, {
          preserveSessionId: auth.sessionId,
        })
        if (error) {
          keepReservation = true
          return apiError('INVALID_CREDENTIALS', error, 400)
        }
      } else {
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://mock.supabase.co'
        const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'mock-anon-key'
        const ephemeral = createSupabaseClient(supabaseUrl, anonKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        })
        const { error: signInError } = await ephemeral.auth.signInWithPassword({
          email: auth.actor.email,
          password: currentPassword,
        })
        if (signInError) {
          keepReservation = true
          return apiError('INVALID_CREDENTIALS', 'Current password is incorrect.', 400)
        }

        // Revoke all other mobile sessions for this actor while preserving current.
        // This runs BEFORE the provider write: a failed revoke must never be
        // followed by an unprotected password change.
        try {
          await mobileSessionStore.revokeOtherSessions(auth.actor.id, auth.sessionId)
        } catch {
          keepReservation = true
          return apiError('PASSWORD_UPDATE_FAILED', 'Could not revoke other sessions; password was not changed.', 500)
        }

        const { error: updateError } = await ephemeral.auth.updateUser({
          password: newPassword,
          current_password: currentPassword,
        })
        if (updateError) {
          keepReservation = true
          // Other mobile sessions were already revoked above; say so
          // truthfully instead of implying nothing changed.
          return apiError(
            'PASSWORD_UPDATE_FAILED',
            `${updateError.message} Note: other mobile sessions were already revoked.`,
            400
          )
        }

        try {
          const { error: signOutErr } = await ephemeral.auth.signOut({ scope: 'others' })
          if (signOutErr) {
            return apiError('PASSWORD_UPDATE_FAILED', `Password changed, but failed to revoke other sessions: ${signOutErr.message}`, 500)
          }
        } catch {
          return apiError('PASSWORD_UPDATE_FAILED', 'Password changed, but failed to revoke other sessions.', 500)
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
