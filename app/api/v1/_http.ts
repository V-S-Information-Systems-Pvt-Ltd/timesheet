import { NextResponse } from 'next/server'
import { getMobileActor } from '@/lib/auth/mobile-actor'
import { verifyMobileAccessToken } from '@/lib/auth/mobile-tokens'
import { mobileSessionStore } from '@/lib/auth/mobile-session-store'
import type { Actor } from '@/lib/db/repository'
import { logger, extractError } from '@/lib/logger'

export function getRequestId(request: Request): string {
  const header = request.headers.get('x-request-id')
  if (header && header.trim().length > 0 && header.length <= 128) {
    return header.trim()
  }
  return crypto.randomUUID()
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers })
}

export function apiError(code: string, message: string, status: number, headers?: Record<string, string>) {
  return json({ data: null, error: { code, message } }, status, headers)
}

export function serverError(err: unknown, meta?: { requestId?: string; [key: string]: unknown }) {
  logger.error('Unhandled v1 server error', {
    error: extractError(err),
    ...(meta ?? {}),
  })
  return apiError(
    'INTERNAL_ERROR',
    'Internal server error.',
    500,
    meta?.requestId ? { 'x-request-id': meta.requestId } : undefined
  )
}

export async function requireMobileActor(
  request: Request,
  options?: { allowInactive?: boolean }
): Promise<
  | { ok: true; actor: Actor; sessionId: string; requestId: string; startTime: number }
  | { ok: false; response: Response; requestId: string; startTime: number }
> {
  const requestId = getRequestId(request)
  const startTime = performance.now()

  const header = request.headers.get('authorization')
  if (!header || !/^Bearer\s+\S+$/i.test(header)) {
    return {
      ok: false,
      response: apiError('AUTH_REQUIRED', 'A bearer access token is required.', 401, {
        'x-request-id': requestId,
      }),
      requestId,
      startTime,
    }
  }

  const token = header.replace(/^Bearer\s+/i, '')
  const claims = await verifyMobileAccessToken(token)
  if (!claims) {
    return {
      ok: false,
      response: apiError('ACCESS_TOKEN_EXPIRED', 'The access token is invalid or expired.', 401, {
        'x-request-id': requestId,
      }),
      requestId,
      startTime,
    }
  }

  const session = await mobileSessionStore.findById(claims.sessionId)
  if (
    !session ||
    session.userId !== claims.userId ||
    session.familyId !== claims.familyId ||
    session.revokedAt ||
    session.rotatedAt ||
    new Date(session.absoluteExpiresAt).getTime() <= Date.now() ||
    new Date(session.idleExpiresAt).getTime() <= Date.now()
  ) {
    return {
      ok: false,
      response: apiError('SESSION_REVOKED', 'The mobile session is no longer valid.', 401, {
        'x-request-id': requestId,
      }),
      requestId,
      startTime,
    }
  }

  const actor = await getMobileActor(claims.userId)
  if (!actor) {
    return {
      ok: false,
      response: apiError('AUTH_REQUIRED', 'The account no longer exists.', 401, {
        'x-request-id': requestId,
      }),
      requestId,
      startTime,
    }
  }
  if (!actor.isActive && !options?.allowInactive) {
    return {
      ok: false,
      response: apiError('ACCOUNT_INACTIVE', 'The account is not active.', 403, {
        'x-request-id': requestId,
      }),
      requestId,
      startTime,
    }
  }
  return { ok: true, actor, sessionId: claims.sessionId, requestId, startTime }
}

/** Gate helper for routes that allow authenticated sessions of inactive/pending accounts (me, logout, logout-all). */
export async function requireMobileSession(request: Request) {
  return requireMobileActor(request, { allowInactive: true })
}
