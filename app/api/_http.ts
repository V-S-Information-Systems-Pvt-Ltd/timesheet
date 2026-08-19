// app/api/_http.ts
// Small helpers shared by the native REST route handlers.
import { NextResponse } from 'next/server'
import { getActor } from '@/lib/auth'
import { logger, extractError } from '@/lib/logger'
import type { Actor } from '@/lib/db/repository'

export function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers })
}

export function serverError(err: unknown) {
  // Log the real error server-side but never expose internal details
  // (SQLSTATEs, connection strings, file paths) to API clients.
  logger.error('api unhandled error', { error: extractError(err), stack: err instanceof Error ? err.stack : undefined })
  return json({ error: 'Internal server error.' }, 500)
}

export async function requireSignedIn(): Promise<
  { ok: true; actor: Actor } | { ok: false; response: Response }
> {
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
export async function requireActive(): Promise<
  { ok: true; actor: Actor } | { ok: false; response: Response }
> {
  const auth = await requireSignedIn()
  if (!auth.ok) return auth
  if (!auth.actor.isActive) {
    return {
      ok: false,
      response: json({ error: 'Your account is not active yet.' }, 403),
    }
  }
  return auth
}
