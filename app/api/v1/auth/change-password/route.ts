import { requireMobileActor, json, serverError, apiError } from '@/app/api/v1/_http'
import { changePassword } from '@/lib/auth/native'
import { passwordSchema } from '@/lib/validation-schemas'
import { reserveRateLimit } from '@/lib/rate-limit'
import { getClientIp } from '@/lib/ip'
import { IS_NATIVE } from '@/lib/backend'
import { getAdminClient } from '@/lib/supabase/admin'

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
      const { error } = await changePassword(auth.actor.id, currentPassword, newPassword)
      if (error) {
        keepReservation = true
        return apiError('INVALID_CREDENTIALS', error, 400)
      }
    } else {
      const admin = getAdminClient()
      const { error } = await admin.auth.admin.updateUserById(auth.actor.id, { password: newPassword })
      if (error) {
        keepReservation = true
        return apiError('PASSWORD_UPDATE_FAILED', error.message, 400)
      }
    }

    return json({ data: { success: true }, error: null })
  } catch (err) {
    return serverError(err)
  } finally {
    if (!keepReservation) await releaseReservation?.()
  }
}
