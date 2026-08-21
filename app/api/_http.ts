// app/api/_http.ts
// Small helpers shared by the native REST route handlers.

import { NextResponse } from 'next/server'
import { getActor } from '@/lib/auth'
import { logger, extractError } from '@/lib/logger'
import type { Actor } from '@/lib/db/repository'

export function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers })
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/** Reject cross-origin state-mutating requests (CSRF protection for native REST routes). */
export function originCheck(req: Request): Response | null {
  if (SAFE_METHODS.has(req.method)) return null

  const origin = req.headers.get('origin')
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host')
  const referer = req.headers.get('referer')
  const target = origin || referer

  if (!target || !host) {
    if (process.env.NODE_ENV === 'production') {
      return json({ error: 'Missing Origin or Referer header.' }, 403)
    }
    return null
  }

  try {
    const originHost = new URL(target).host
    const hostName = host.split(':')[0].toLowerCase()
    const originHostName = originHost.split(':')[0].toLowerCase()
    if (originHostName !== hostName) {
      return json({ error: 'Cross-origin request rejected.' }, 403)
    }
  } catch {
    return json({ error: 'Invalid Origin header.' }, 403)
  }
  return null
}

export function serverError(err: unknown) {

  // Log the real error (with stack) server-side; never expose internals.
  logger.error(extractError(err), {
    stack: err instanceof Error ? err.stack : undefined,
  })
  return json({ error: 'Internal server error.' }, 500)
}

export async function requireSignedIn(request?: Request): Promise<
  { ok: true; actor: Actor } | { ok: false; response: Response }
> {
  if (request) {
    const originErr = originCheck(request)
    if (originErr) return { ok: false, response: originErr }
  }
  const actor = await getActor()
  if (!actor) {
    return { ok: false, response: json({ error: 'You must be signed in.' }, 401) }
  }
  return { ok: true, actor }
}

/**
 * Signed-in AND active. Data endpoints use this so deactivated accounts
 * (which may still hold a valid session) cannot read or mutate app data,
 * mirroring the dashboard's pending-approval gate.
 */
export async function requireActive(request?: Request): Promise<
  { ok: true; actor: Actor } | { ok: false; response: Response }
> {
  const auth = await requireSignedIn(request)
  if (!auth.ok) return auth
  if (!auth.actor.isActive) {
    return {
      ok: false,
      response: json({ error: 'Your account is not active yet.' }, 403),
    }
  }
  return auth
}

