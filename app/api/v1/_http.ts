import { NextResponse } from 'next/server'
import { getMobileActor } from '@/lib/auth/mobile-actor'
import { verifyMobileAccessToken } from '@/lib/auth/mobile-tokens'
import { mobileSessionStore } from '@/lib/auth/mobile-session-store'
import type { Actor } from '@/lib/db/repository'

export function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers })
}

export function apiError(code: string, message: string, status: number, headers?: Record<string, string>) {
  return json({ data: null, error: { code, message } }, status, headers)
}

export function serverError(err: unknown) {
  // Keep the response generic. The existing application logger can be added
  // here once v1 request IDs are wired; never include token values in logs.
  void err
  return apiError('INTERNAL_ERROR', 'Internal server error.', 500)
}

export async function requireMobileActor(request: Request): Promise<
  | { ok: true; actor: Actor; sessionId: string }
  | { ok: false; response: Response }
> {
  const header = request.headers.get('authorization')
  if (!header || !/^Bearer\s+\S+$/i.test(header)) {
    return { ok: false, response: apiError('AUTH_REQUIRED', 'A bearer access token is required.', 401) }
  }

  const token = header.replace(/^Bearer\s+/i, '')
  const claims = await verifyMobileAccessToken(token)
  if (!claims) {
    return { ok: false, response: apiError('ACCESS_TOKEN_EXPIRED', 'The access token is invalid or expired.', 401) }
  }

  const session = await mobileSessionStore.findById(claims.sessionId)
  if (
    !session ||
    session.userId !== claims.userId ||
    session.familyId !== claims.familyId ||
    session.revokedAt ||
    session.rotatedAt ||
    new Date(session.absoluteExpiresAt).getTime() <= Date.now()
  ) {
    return { ok: false, response: apiError('SESSION_REVOKED', 'The mobile session is no longer valid.', 401) }
  }

  const actor = await getMobileActor(claims.userId)
  if (!actor) return { ok: false, response: apiError('AUTH_REQUIRED', 'The account no longer exists.', 401) }
  if (!actor.isActive) return { ok: false, response: apiError('ACCOUNT_INACTIVE', 'The account is not active.', 403) }
  return { ok: true, actor, sessionId: claims.sessionId }
}
