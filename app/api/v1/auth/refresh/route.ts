import { json, serverError } from '@/app/api/_http'
import { mobileRefreshSchema } from '@/lib/api/v1/contracts'
import {
  generateRefreshToken,
  hashRefreshToken,
  signMobileAccessToken,
  ACCESS_TOKEN_TTL_SECONDS,
} from '@/lib/auth/mobile-tokens'
import { mobileSessionStore } from '@/lib/auth/mobile-session-store'

import { withRequestLogging } from '../../_observability'
export const runtime = 'nodejs'

function authError(code: string, message: string) {
  return json({ data: null, error: { code, message } }, 401)
}

export const POST = withRequestLogging('POST /api/v1/auth/refresh', async (request: Request) => {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json({ data: null, error: { code: 'VALIDATION_ERROR', message: 'A JSON request body is required.' } }, 400)
  }

  const parsed = mobileRefreshSchema.safeParse(body)
  if (!parsed.success) {
    return json({ data: null, error: { code: 'VALIDATION_ERROR', message: 'A refresh token is required.' } }, 400)
  }

  try {
    const replacementToken = generateRefreshToken()
    const result = await mobileSessionStore.rotate({
      presentedTokenHash: hashRefreshToken(parsed.data.refreshToken),
      replacementTokenHash: hashRefreshToken(replacementToken),
    })
    if (result.status !== 'rotated') {
      const code = result.status === 'reused' ? 'REFRESH_TOKEN_REUSED' : 'INVALID_REFRESH_TOKEN'
      return authError(code, 'The refresh session is no longer valid. Please sign in again.')
    }

    const accessToken = await signMobileAccessToken({
      userId: result.session.userId,
      sessionId: result.session.id,
      familyId: result.session.familyId,
    })

    // Hardening (WP-07): opportunistically bound the session table. Bounded
    // and best-effort; a scheduled job can call the same store method.
    void Promise.resolve(mobileSessionStore.purgeExpired?.()).catch(() => undefined)

    return json({
      data: {
        accessToken,
        refreshToken: replacementToken,
        accessTokenExpiresAt: new Date(Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000).toISOString(),
        sessionId: result.session.id,
      },
      error: null,
    })
  } catch (err) {
    return serverError(err)
  }
})
