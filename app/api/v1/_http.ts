import { NextResponse } from 'next/server'
import { verifyMobileAccessToken, isLegacyMobileToken } from '@/lib/auth/mobile-tokens'
import { mobileSessionStore } from '@/lib/auth/mobile-session-store'
import type { Actor } from '@/lib/db/repository'
import { logger, extractError } from '@/lib/logger'
import { isMobileBearerAuthEnabled } from '@/lib/auth/mobile-config'
import { IS_SUPABASE } from '@/lib/backend/config'
import { createMobileBearerClient, runWithMobileSupabaseClient } from '@/lib/supabase/bearer'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'

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

export function badRequest(message: string, headers?: Record<string, string>) {
  return apiError('VALIDATION_ERROR', message, 400, headers)
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

export interface RequireMobileActorOptions {
  allowInactive?: boolean
}

export type MobileActorSuccess = {
  ok: true
  actor: Actor
  sessionId: string
  requestId: string
  startTime: number
  token: string
  client?: SupabaseClient<Database>
  run: <T>(fn: () => Promise<T>) => Promise<T>
}

export type MobileActorFailure = {
  ok: false
  response: Response
  requestId: string
  startTime: number
}

export type MobileActorResult = MobileActorSuccess | MobileActorFailure

export async function requireMobileActor(
  request: Request,
  options?: RequireMobileActorOptions
): Promise<MobileActorResult> {
  const requestId = getRequestId(request)
  const startTime = performance.now()

  if (!isMobileBearerAuthEnabled()) {
    return {
      ok: false,
      response: apiError('MOBILE_API_DISABLED', 'Mobile API access is temporarily disabled.', 503, {
        'x-request-id': requestId,
      }),
      requestId,
      startTime,
    }
  }

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
    if (IS_SUPABASE) {
      const isLegacy = await isLegacyMobileToken(token)
      if (isLegacy) {
        return {
          ok: false,
          response: apiError(
            'UPGRADE_REQUIRED',
            'The access token format has changed. Please log in again to upgrade your session.',
            401,
            { 'x-request-id': requestId }
          ),
          requestId,
          startTime,
        }
      }
    }
    return {
      ok: false,
      response: apiError('ACCESS_TOKEN_EXPIRED', 'The access token is invalid or expired.', 401, {
        'x-request-id': requestId,
      }),
      requestId,
      startTime,
    }
  }

  const { session, actor } = await mobileSessionStore.findSessionAndActorById(claims.sessionId)
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

  let client: SupabaseClient<Database> | undefined
  if (IS_SUPABASE) {
    try {
      client = createMobileBearerClient(token)
    } catch (err) {
      logger.error('Failed to create mobile Supabase bearer client', {
        error: extractError(err),
        requestId,
      })
      return {
        ok: false,
        response: apiError('SERVER_ERROR', 'Failed to initialize secure data client.', 500, {
          'x-request-id': requestId,
        }),
        requestId,
        startTime,
      }
    }
  }

  return {
    ok: true,
    actor,
    sessionId: claims.sessionId,
    requestId,
    startTime,
    token,
    client,
    run: <T>(fn: () => Promise<T>): Promise<T> => {
      if (IS_SUPABASE) {
        if (!client) {
          throw new Error('Missing mobile Supabase client under IS_SUPABASE')
        }
        return runWithMobileSupabaseClient(client, fn)
      }
      return fn()
    },
  }
}

/** Gate helper for routes that allow authenticated sessions of inactive/pending accounts (me, logout, logout-all). */
export async function requireMobileSession(request: Request) {
  return requireMobileActor(request, { allowInactive: true })
}

/**
 * Executes `handler` within the request's authenticated mobile actor context.
 * In Supabase mode, wraps the handler execution in `runWithMobileSupabaseClient` so
 * all PostgREST calls automatically execute under the bearer token principal.
 */
export async function withMobileActor<T = Response>(
  request: Request,
  handler: (auth: MobileActorSuccess) => Promise<T>,
  options?: RequireMobileActorOptions
): Promise<T | Response> {
  const auth = await requireMobileActor(request, options)
  if (!auth.ok) {
    return auth.response
  }
  if (typeof auth.run === 'function') {
    return auth.run(() => handler(auth))
  }
  return handler(auth)
}

/**
 * Executes `handler` within an authenticated mobile session context, allowing inactive accounts.
 */
export async function withMobileSession<T = Response>(
  request: Request,
  handler: (auth: MobileActorSuccess) => Promise<T>
): Promise<T | Response> {
  return withMobileActor(request, handler, { allowInactive: true })
}
