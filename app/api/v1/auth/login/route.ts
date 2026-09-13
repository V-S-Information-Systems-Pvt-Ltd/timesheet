import { json, serverError } from '@/app/api/_http'
import { apiError, apiSuccess, getRequestId } from '@/app/api/v1/_http'
import { getClientIp } from '@/lib/ip'
import { reserveRateLimit } from '@/lib/rate-limit'
import { verifyMobileCredentials } from '@/lib/auth/mobile-credentials'
import {
  generateRefreshToken,
  hashRefreshToken,
  signMobileAccessToken,
  ACCESS_TOKEN_TTL_SECONDS,
} from '@/lib/auth/mobile-tokens'
import { mobileSessionStore } from '@/lib/auth/mobile-session-store'
import { isMobileBearerAuthEnabled } from '@/lib/auth/mobile-config'
import { mobileLoginSchema, mapActorDto } from '@/lib/api/v1/contracts'
import { getMobileActor } from '@/lib/auth/mobile-actor'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  if (!isMobileBearerAuthEnabled()) {
    return apiError('MOBILE_API_DISABLED', 'Mobile API access is temporarily disabled.', 503, {
      'x-request-id': getRequestId(request),
    })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return apiError('VALIDATION_ERROR', 'A JSON request body is required.', 400)
  }

  const parsed = mobileLoginSchema.safeParse(body)
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors as Record<string, string[]>
    return json({ data: null, error: { code: 'VALIDATION_ERROR', message: 'Check the submitted fields.', fieldErrors } }, 400)
  }

  const { email, password, deviceName, platform } = parsed.data

  // Reserve the budget up front. A successful login releases the slot back, so
  // only failed credential attempts count — unchanged policy, but now the
  // reservation is atomic and pre-auth storage outages degrade to a bounded
  // per-instance window instead of failing authentication closed.
  const reservation = await reserveRateLimit('daily-login', `mobile-login:${email}:${getClientIp(request)}`)
  if (!reservation.ok) {
    return apiError('RATE_LIMITED', 'Too many login attempts. Try again later.', 429, {
      'Retry-After': String(reservation.retryAfter),
    })
  }

  try {
    const verified = await verifyMobileCredentials(email, password)
    if (verified.error || !verified.user) {
      // Keep the slot: this attempt was a failure and must count.
      return apiError('INVALID_CREDENTIALS', 'Invalid email or password.', 401)
    }

    await reservation.release()

    const refreshToken = generateRefreshToken()
    const session = await mobileSessionStore.create({
      userId: verified.user.id,
      refreshTokenHash: hashRefreshToken(refreshToken),
      deviceName,
      platform,
    })
    const accessToken = await signMobileAccessToken({
      userId: verified.user.id,
      sessionId: session.id,
      familyId: session.familyId,
    })

    const resolvedActor = await getMobileActor(verified.user.id)
    const actor = resolvedActor ?? {
      id: verified.user.id,
      email: verified.user.email,
      role: 'user' as const,
      permission_role: 'user' as const,
      hierarchy_role: 'user' as const,
      isActive: true,
    }
    const actorData = mapActorDto(actor)

    const accessTokenExpiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000).toISOString()
    return apiSuccess({
      accessToken,
      refreshToken,
      accessTokenExpiresAt,
      sessionId: session.id,
      actor: actorData,
    })
  } catch (err) {
    await reservation.release()
    return serverError(err)
  }
}
