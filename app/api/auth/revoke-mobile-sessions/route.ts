import { json, originCheck, serverError } from '@/app/api/_http'
import { getSessionUser } from '@/lib/auth'
import { mobileSessionStore } from '@/lib/auth/mobile-session-store'

export const runtime = 'nodejs'

/**
 * Password-change mobile-session revocation for the web transport.
 *
 * The browser makes its provider password write after this endpoint returns,
 * so the revocation cannot be atomic with it. Two phases close the gap:
 *
 *   begin    (default): revoke every custom mobile session and set the
 *            database insert guard, so a concurrent mobile refresh cannot
 *            mint a replacement session during the provider write.
 *   complete ({ complete: true }): clear the guard and sweep any session
 *            that was minted in the window.
 *
 * An abandoned begin (tab closed, crash) self-heals after the bounded guard
 * window; see 20260925000000_password_change_bounded_guard_and_revoke_all.sql.
 */
export async function POST(request: Request) {
  const originError = originCheck(request)
  if (originError) return originError

  try {
    const user = await getSessionUser()
    if (!user) return json({ error: 'You must be signed in.' }, 401, { 'Cache-Control': 'no-store' })

    let complete = false
    try {
      const body = (await request.json()) as { complete?: unknown } | null
      complete = body?.complete === true
    } catch {
      // No body (or invalid JSON) is the begin phase.
    }

    if (complete) {
      await mobileSessionStore.completePasswordChange(user.id, null)
    } else {
      await mobileSessionStore.beginPasswordChange(user.id)
    }

    return json({ ok: true }, 200, { 'Cache-Control': 'no-store' })
  } catch (err) {
    return serverError(err)
  }
}
