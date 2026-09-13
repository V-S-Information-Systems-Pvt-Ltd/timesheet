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
    const replacementToken = generateRefreshToken()
    const result = await mobileSessionStore.rotate({
      presentedTokenHash: hashRefreshToken(parsed.data.refreshToken),
      replacementTokenHash: hashRefreshToken(replacementToken),
    })
    if (result.status !== 'rotated') {
      const code = result.status === 'reused' ? 'REFRESH_TOKEN_REUSED' : 'INVALID_REFRESH_TOKEN'
      return apiError(code, 'The refresh session is no longer valid. Please sign in again.', 401)
    }

    const accessToken = await signMobileAccessToken({
      userId: result.session.userId,
      sessionId: result.session.id,
      familyId: result.session.familyId,
    })
    return apiSuccess({
      accessToken,
      refreshToken: replacementToken,
      accessTokenExpiresAt: new Date(Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000).toISOString(),
      sessionId: result.session.id,
    })
  } catch (err) {
    return serverError(err)
  }
}
