import { serverError } from '@/app/api/_http'
import { apiError, apiSuccess, getRequestId } from '@/app/api/v1/_http'
import { mobileRefreshSchema } from '@/lib/api/v1/contracts'
import {
  generateRefreshToken,
  hashRefreshToken,
  signMobileAccessToken,
  ACCESS_TOKEN_TTL_SECONDS,
} from '@/lib/auth/mobile-tokens'
import { mobileSessionStore } from '@/lib/auth/mobile-session-store'
import { isMobileBearerAuthEnabled } from '@/lib/auth/mobile-config'
import { refreshMobileIdentity } from '@/lib/auth/identity-service'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  if (!isMobileBearerAuthEnabled()) {
    return apiError('MOBILE_API_DISABLED', 'Mobile API access is temporarily disabled.', 503, { 'x-request-id': getRequestId(request) })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return apiError('VALIDATION_ERROR', 'A JSON request body is required.', 400)
  }

  const parsed = mobileRefreshSchema.safeParse(body)
  if (!parsed.success) {
    return apiError('VALIDATION_ERROR', 'A refresh token is required.', 400)
  }

  try {
    const outcome = await refreshMobileIdentity(
      { refreshToken: parsed.data.refreshToken },
      {
        sessions: mobileSessionStore,
        tokens: { generateRefreshToken, hashRefreshToken, signMobileAccessToken },
      }
    )
    if (!outcome.ok) {
      return apiError(outcome.code, outcome.message, 401)
    }

    return apiSuccess({
      accessToken: outcome.accessToken,
      refreshToken: outcome.refreshToken,
      accessTokenExpiresAt: new Date(Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000).toISOString(),
      sessionId: outcome.sessionId,
    })
  } catch (err) {
    return serverError(err)
  }
}
