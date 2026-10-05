import { json, originCheck, readJsonLenient, serverError } from '@/app/api/_http'
import { getSessionUser } from '@/lib/auth'
import { revokeMobileSessionsForPasswordChange } from '@/lib/auth/identity-service'
import { mobileSessionStore } from '@/lib/auth/mobile-session-store'

/**
 * Begin revokes sessions and installs the bounded insert guard before the
 * provider password write. Complete clears the guard and sweeps late sessions,
 * even after provider failure. An abandoned begin self-heals after the guard
 * window (20260925000000_password_change_bounded_guard_and_revoke_all.sql).
 */
export async function browserRevokeMobileSessions(request: Request) {
  const originError = originCheck(request)
  if (originError) return originError

  try {
    const user = await getSessionUser()
    if (!user) return json({ error: 'You must be signed in.' }, 401, { 'Cache-Control': 'no-store' })

    // No body (or invalid JSON) is the begin phase.
    const body = (await readJsonLenient(request)) as { complete?: unknown } | null
    const complete = body?.complete === true

    await revokeMobileSessionsForPasswordChange(
      user.id,
      { complete },
      { sessions: mobileSessionStore }
    )

    return json({ ok: true }, 200, { 'Cache-Control': 'no-store' })
  } catch (err) {
    return serverError(err)
  }
}
