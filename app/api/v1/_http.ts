import { NextResponse } from 'next/server'
import { verifyMobileAccessToken, isLegacyMobileToken } from '@/lib/auth/mobile-tokens'
import { mobileSessionStore } from '@/lib/auth/mobile-session-store'
import { getActor } from '@/lib/auth'
import type { Actor } from '@/lib/db/repository'
import { logger, extractError } from '@/lib/logger'
import { isMobileBearerAuthEnabled } from '@/lib/auth/mobile-config'
import { IS_SUPABASE } from '@/lib/backend/config'
import { createMobileBearerClient, runWithMobileSupabaseClient } from '@/lib/supabase/bearer'
import { originCheck } from '@/app/api/_http'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import type { MobileServiceResult } from '@/lib/api/v1/services/_result'

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

export function apiSuccess<T>(data: T, status = 200, headers?: Record<string, string>) {
  return json({ data, error: null }, status, headers)
}

export function badRequest(message: string, headers?: Record<string, string>) {
  return apiError('VALIDATION_ERROR', message, 400, headers)
}

export function serviceResultResponse<T>(
  result: MobileServiceResult<T>,
  successStatus = 200
) {
  if (!result.success) {
    return apiError(result.code, result.message, result.status)
  }
  return apiSuccess(result.data, result.status ?? successStatus)
}

export type JsonBodyResult =
  | { ok: true; body: unknown }
  | { ok: false; response: Response }

export async function parseJsonBody(request: Request): Promise<JsonBodyResult> {
  try {
    return { ok: true, body: await request.json() }
  } catch {
    return { ok: false, response: badRequest('A JSON request body is required.') }
  }
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
  /**
   * Opt in to web-session-cookie authentication for requests that do not carry
   * an `Authorization` header. Only the versioned timesheet resources enable
   * this. An explicit Authorization header always selects bearer
   * authentication — including when it is malformed — and never falls back to
   * cookies. Cookie requests must not require the bearer feature gate or
   * `MOBILE_AUTH_SECRET`.
   */
  allowCookie?: boolean
}

/** Authenticated context resolved from an explicit mobile bearer token. */
export type MobileBearerActorSuccess = {
  ok: true
  /** Credential that produced this context. */
  via: 'bearer'
  actor: Actor
  sessionId: string
  requestId: string
  startTime: number
  token: string
  client?: SupabaseClient<Database>
  run: <T>(fn: () => Promise<T>) => Promise<T>
}

/**
 * Authenticated context resolved from a web session cookie. There is no mobile
 * session id or token: cookie callers authenticate through the web actor path.
 */
export type CookieActorSuccess = {
  ok: true
  /** Credential that produced this context. */
  via: 'cookie'
  actor: Actor
  requestId: string
  startTime: number
  run: <T>(fn: () => Promise<T>) => Promise<T>
}

export type MobileActorSuccess = MobileBearerActorSuccess | CookieActorSuccess

export type MobileActorFailure = {
  ok: false
  response: Response
  requestId: string
  startTime: number
}

export type MobileActorResult = MobileActorSuccess | MobileActorFailure

function failure(response: Response, requestId: string, startTime: number): MobileActorFailure {
  return { ok: false, response, requestId, startTime }
}

/**
 * Resolves a mobile bearer actor. An explicit Authorization header always
 * enters this path; it never falls back to a cookie.
 */
async function requireBearerActor(
  authHeader: string,
  requestId: string,
  startTime: number,
  options?: RequireMobileActorOptions
): Promise<MobileActorResult> {
  if (!isMobileBearerAuthEnabled()) {
    return failure(
      apiError('MOBILE_API_DISABLED', 'Mobile API access is temporarily disabled.', 503, {
        'x-request-id': requestId,
      }),
      requestId,
      startTime
    )
  }

  if (!/^Bearer\s+\S+$/i.test(authHeader)) {
    return failure(
      apiError('AUTH_REQUIRED', 'A bearer access token is required.', 401, {
        'x-request-id': requestId,
      }),
      requestId,
      startTime
    )
  }

  const token = authHeader.replace(/^Bearer\s+/i, '')
  const claims = await verifyMobileAccessToken(token)
  if (!claims) {
    if (IS_SUPABASE) {
      const isLegacy = await isLegacyMobileToken(token)
      if (isLegacy) {
        return failure(
          apiError(
            'UPGRADE_REQUIRED',
            'The access token format has changed. Please log in again to upgrade your session.',
            401,
            { 'x-request-id': requestId }
          ),
          requestId,
          startTime
        )
      }
    }
    return failure(
      apiError('ACCESS_TOKEN_EXPIRED', 'The access token is invalid or expired.', 401, {
        'x-request-id': requestId,
      }),
      requestId,
      startTime
    )
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
    return failure(
      apiError('SESSION_REVOKED', 'The mobile session is no longer valid.', 401, {
        'x-request-id': requestId,
      }),
      requestId,
      startTime
    )
  }

  if (!actor) {
    return failure(
      apiError('AUTH_REQUIRED', 'The account no longer exists.', 401, {
        'x-request-id': requestId,
      }),
      requestId,
      startTime
    )
  }
  if (!actor.isActive && !options?.allowInactive) {
    return failure(
      apiError('ACCOUNT_INACTIVE', 'The account is not active.', 403, {
        'x-request-id': requestId,
      }),
      requestId,
      startTime
    )
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
      return failure(
        apiError('SERVER_ERROR', 'Failed to initialize secure data client.', 500, {
          'x-request-id': requestId,
        }),
        requestId,
        startTime
      )
    }
  }

  return {
    ok: true,
    via: 'bearer',
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

/**
 * Resolves the actor for a cookie-authenticated request through the existing
 * web session/actor path. Cookie-authenticated mutations are origin-protected.
 * The returned context has no mobile session id or token, and its `run` does
 * not wrap Supabase calls in the mobile bearer client: in Supabase mode the
 * data layer falls back to the request-scoped cookie client
 * (`getMobileSupabaseClient()` is undefined), and in native mode no wrapper is
 * needed.
 */
async function requireCookieActor(
  request: Request,
  requestId: string,
  startTime: number,
  options?: RequireMobileActorOptions
): Promise<MobileActorResult> {
  // Reject cross-origin cookie mutations before resolving identity so a
  // forged site can never reach the actor or the data layer. `originCheck` is
  // method-aware, so safe methods (GET/HEAD/OPTIONS) pass through unchanged.
  const originErr = originCheck(request)
  if (originErr) {
    return failure(originErr, requestId, startTime)
  }

  let actor: Actor | null
  try {
    actor = await getActor()
  } catch (err) {
    logger.error('Failed to resolve web session actor for cookie request', {
      error: extractError(err),
      requestId,
    })
    return failure(
      apiError('SERVER_ERROR', 'Failed to resolve the signed-in account.', 500, {
        'x-request-id': requestId,
      }),
      requestId,
      startTime
    )
  }

  if (!actor) {
    return failure(
      apiError('AUTH_REQUIRED', 'You must be signed in.', 401, {
        'x-request-id': requestId,
      }),
      requestId,
      startTime
    )
  }
  if (!actor.isActive && !options?.allowInactive) {
    return failure(
      apiError('ACCOUNT_INACTIVE', 'The account is not active.', 403, {
        'x-request-id': requestId,
      }),
      requestId,
      startTime
    )
  }

  return {
    ok: true,
    via: 'cookie',
    actor,
    requestId,
    startTime,
    run: <T>(fn: () => Promise<T>): Promise<T> => fn(),
  }
}

export async function requireMobileActor(
  request: Request,
  options?: RequireMobileActorOptions
): Promise<MobileActorResult> {
  const requestId = getRequestId(request)
  const startTime = performance.now()

  const authHeader = request.headers.get('authorization')

  // An explicit Authorization header always selects bearer authentication,
  // including when it is malformed or the token is invalid. It must never fall
  // back to a web session cookie.
  if (authHeader !== null) {
    return requireBearerActor(authHeader, requestId, startTime, options)
  }

  // No Authorization header: only routes that opt in accept a web session
  // cookie. Cookie requests do not require the bearer feature gate.
  if (options?.allowCookie) {
    return requireCookieActor(request, requestId, startTime, options)
  }

  // Bearer-only routes keep their original ordering and behavior: the feature
  // gate is evaluated before the missing-credential error.
  if (!isMobileBearerAuthEnabled()) {
    return failure(
      apiError('MOBILE_API_DISABLED', 'Mobile API access is temporarily disabled.', 503, {
        'x-request-id': requestId,
      }),
      requestId,
      startTime
    )
  }
  return failure(
    apiError('AUTH_REQUIRED', 'A bearer access token is required.', 401, {
      'x-request-id': requestId,
    }),
    requestId,
    startTime
  )
}

/** Gate helper for routes that allow authenticated sessions of inactive/pending accounts (me, logout, logout-all). */
export async function requireMobileSession(request: Request) {
  return requireMobileActor(request, { allowInactive: true })
}

/**
 * Executes `handler` within the request's authenticated actor context, whether
 * that context came from an explicit bearer token or (only where the route opts
 * in via `allowCookie`) a web session cookie.
 *
 * In Supabase mode, bearer execution wraps the handler in
 * `runWithMobileSupabaseClient` so all PostgREST calls automatically execute
 * under the bearer token principal. Cookie execution is not wrapped so the data
 * layer can bind the request-scoped cookie client.
 */
// Overload 1: no options — the route is bearer-only, so the handler sees the
// bearer context (with `sessionId`/`token`).
export function withMobileActor<T = Response>(
  request: Request,
  handler: (auth: MobileBearerActorSuccess) => Promise<T>
): Promise<T | Response>
// Overload 2: options supplied (e.g. `{ allowCookie: true }` for the versioned
// timesheet resources) — the handler may receive either credential context.
export function withMobileActor<T = Response>(
  request: Request,
  handler: (auth: MobileActorSuccess) => Promise<T>,
  options: RequireMobileActorOptions
): Promise<T | Response>
// The implementation parameter is `any` so both narrower context overloads are
// compatible; callers still see the precise overload signature above.
export async function withMobileActor<T = Response>(
  request: Request,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (auth: any) => Promise<T>,
  options?: RequireMobileActorOptions
): Promise<T | Response> {
  const auth = await requireMobileActor(request, options)
  if (!auth.ok) {
    return auth.response
  }
  return auth.run(() => handler(auth))
}

/**
 * Executes `handler` within an authenticated mobile session context, allowing inactive accounts.
 * Session endpoints never opt into cookies, so the context is always a bearer token.
 */
export async function withMobileSession<T = Response>(
  request: Request,
  handler: (auth: MobileBearerActorSuccess) => Promise<T>
): Promise<T | Response> {
  const auth = await requireMobileActor(request, { allowInactive: true })
  if (!auth.ok) {
    return auth.response
  }
  // `allowCookie` is never set for session routes, so this is always bearer.
  const bearer = auth as MobileBearerActorSuccess
  return bearer.run(() => handler(bearer))
}
