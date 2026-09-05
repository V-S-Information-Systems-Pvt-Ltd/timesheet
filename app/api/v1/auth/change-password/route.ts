import { requireMobileActor, json, serverError, apiError } from '@/app/api/v1/_http'
import { changePassword } from '@/lib/auth/native'
import { mobileSessionStore } from '@/lib/auth/mobile-session-store'
import { passwordSchema } from '@/lib/validation-schemas'
import { reserveRateLimit } from '@/lib/rate-limit'
import { getClientIp } from '@/lib/ip'
import { IS_NATIVE } from '@/lib/backend'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  let releaseReservation: (() => Promise<void>) | undefined
  let keepReservation = false
  try {
    const auth = await requireMobileActor(request)
    if (!auth.ok) return auth.response

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
        { data: null, error: { code: 'RATE_LIMITED', message: 'Too many attempts. Try again later.' } },
        429,
        { 'Retry-After': String(reservation.retryAfter) }
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
      const ephemeral = createSupabaseClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://mock.supabase.co',
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'mock-anon',
        { auth: { persistSession: false, autoRefreshToken: false } }
      )
      const { error: loginError } = await ephemeral.auth.signInWithPassword({
        email: auth.actor.email,
        password: currentPassword,
      })
      if (loginError) {
        keepReservation = true
        return apiError('INVALID_CREDENTIALS', 'Current password is incorrect.', 400)
      }

      await mobileSessionStore.revokeOtherSessions(auth.actor.id, auth.sessionId)

      const { error: updateError } = await ephemeral.auth.updateUser({
        password: newPassword,
        current_password: currentPassword,
      })
      if (updateError) {
        keepReservation = true
        return apiError('PASSWORD_UPDATE_FAILED', updateError.message, 400)
      }

      try {
        await ephemeral.auth.signOut({ scope: 'others' })
      } catch {
        // non-blocking best-effort provider signout
      }
    }

    return json({ data: { success: true }, error: null })
  } catch (err) {
    return serverError(err)
  } finally {
    if (!keepReservation) await releaseReservation?.()
  }
}
