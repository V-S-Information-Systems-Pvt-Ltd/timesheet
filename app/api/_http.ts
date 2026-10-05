// app/api/_http.ts
// Small helpers shared by the native REST route handlers.

import { NextResponse } from 'next/server'
import { getActor } from '@/lib/auth'
import { writeGateResponse } from '@/lib/db/write-gate'
import { originCheck } from '@/lib/http/origin'
import { logger, extractError } from '@/lib/logger'
import type { Actor } from '@/lib/db/types'

export { originCheck }

export function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers })
}

/**
 * Parse a JSON request body, treating a missing or malformed body as `{}`.
 * Browser auth handlers validate individual fields afterward, so an empty
 * object is the safe stand-in for "no usable body".
 */
export async function readJsonLenient(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    return {}
  }
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

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
 *
 * State-mutating requests are additionally refused while the deployment is
 * fenced for a migration (C06B). Origin, session and active-account checks keep
 * their order; the fence is the last gate before the handler runs. Reads stay
 * available so the merge can be verified and users can still see their data.
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
  if (request && !SAFE_METHODS.has(request.method)) {
    const refusal = await writeGateRefusalResponse()
    if (refusal) return { ok: false, response: refusal }
  }
  return auth
}

/**
 * The fence refusal, or null when writes are admitted. An unreadable gate
 * refuses: a broken fence must never read as an open one.
 */
async function writeGateRefusalResponse(): Promise<Response | null> {
  const refusal = await writeGateResponse().catch(() => ({
    status: 503,
    body: { error: 'The deployment write gate could not be read; writes are refused until it can be.', code: 'WRITERS_FENCED' },
  }))
  if (!refusal) return null
  return json(refusal.body, refusal.status, { 'retry-after': '60' })
}
