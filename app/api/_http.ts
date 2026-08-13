// app/api/_http.ts
// Small helpers shared by the native REST route handlers.

import { NextResponse } from 'next/server'
import { getActor } from '@/lib/auth'
import type { Actor } from '@/lib/db/repository'

export function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status })
}

export function serverError(err: unknown) {
  const message =
    err instanceof Error && err.message ? err.message : 'Internal server error.'
  return json({ error: message }, 500)
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
