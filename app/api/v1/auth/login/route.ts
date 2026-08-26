import { json, serverError } from '@/app/api/_http'
import { getClientIp } from '@/lib/ip'
import {
  consumeRateLimit,
  dailyLoginStore,
  getRetryAfter,
  peekRateLimit,
  RATE_LIMIT_LOGIN,
  WINDOWS,
} from '@/lib/rate-limit'
import { verifyMobileCredentials } from '@/lib/auth/mobile-credentials'
import {
  generateRefreshToken,
  hashRefreshToken,
  signMobileAccessToken,
  ACCESS_TOKEN_TTL_SECONDS,
} from '@/lib/auth/mobile-tokens'
import { mobileSessionStore } from '@/lib/auth/mobile-session-store'
import { mobileLoginSchema } from '@/lib/api/v1/contracts'
import { getMobileActor } from '@/lib/auth/mobile-actor'

export const runtime = 'nodejs'

function error(code: string, message: string, status: number, headers?: Record<string, string>) {
  return json({ data: null, error: { code, message } }, status, headers)
}

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return error('VALIDATION_ERROR', 'A JSON request body is required.', 400)
  }

  const parsed = mobileLoginSchema.safeParse(body)
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors as Record<string, string[]>
    return json({ data: null, error: { code: 'VALIDATION_ERROR', message: 'Check the submitted fields.', fieldErrors } }, 400)
  }

  const { email, password, deviceName, platform } = parsed.data
  const key = `mobile-login:${email}:${getClientIp(request)}`
  const peeked = peekRateLimit(dailyLoginStore, key, RATE_LIMIT_LOGIN, WINDOWS.hour)
  if (!peeked.ok) {
    return error('RATE_LIMITED', 'Too many login attempts. Try again later.', 429, {
      'Retry-After': String(getRetryAfter(peeked.resetAt)),
    })
  }

  try {
    const verified = await verifyMobileCredentials(email, password)
    if (verified.error || !verified.user) {
      consumeRateLimit(dailyLoginStore, key, RATE_LIMIT_LOGIN, WINDOWS.hour)
      return error('INVALID_CREDENTIALS', 'Invalid email or password.', 401)
    }

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

    const actor = await getMobileActor(verified.user.id)
    const actorData = actor
      ? {
          id: actor.id,
          email: actor.email,
          role: actor.role,
          permissionRole: actor.permission_role,
          hierarchyRole: actor.hierarchy_role,
          isActive: actor.isActive,
        }
      : {
          id: verified.user.id,
          email: verified.user.email,
          role: 'user',
          permissionRole: 'user',
          hierarchyRole: 'user',
          isActive: true,
        }

    const accessTokenExpiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000).toISOString()
    return json({
      data: {
        accessToken,
        refreshToken,
        accessTokenExpiresAt,
        sessionId: session.id,
        actor: actorData,
      },
      error: null,
    })
  } catch (err) {
    return serverError(err)
  }
}
