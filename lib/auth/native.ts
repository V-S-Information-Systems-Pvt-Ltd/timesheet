// lib/auth/native.ts
// Native (cloud-native) auth: signed session cookies (JWT via jose) plus
// scrypt-hashed passwords stored in profiles.password_hash. Used by the Auth
// facade and by the native route handlers (login/logout/change-password).

import { cookies } from 'next/headers'
import { query, transaction } from '@/lib/db/pool'
import { hashPassword, verifyPassword, verifyPasswordDetails, verifyDummyPassword } from './password'
import { signSessionToken, verifySessionToken, SESSION_COOKIE, SESSION_DAYS } from './jwt'
import type { HierarchyRole, PermissionRole, UserRole } from '@/app/types'
import type { Actor } from '@/lib/db/repository'
import type { Auth, SessionUser } from './index'

export { signSessionToken, verifySessionToken, SESSION_COOKIE }

async function getSessionUserImpl(): Promise<SessionUser | null> {
  const store = await cookies()
  const token = store.get(SESSION_COOKIE)?.value
  if (!token) return null
  const parsed = await verifySessionToken(token)
  if (!parsed) return null
  const rows = await query<{ session_version: number | null }>(
    'select session_version from public.profiles where id = $1',
    [parsed.user.id]
  )
  const currentVersion = Number(rows[0]?.session_version ?? 0)
  if (currentVersion !== parsed.sessionVersion) return null
  return { ...parsed.user, sessionVersion: parsed.sessionVersion }
}

export const nativeAuth: Auth = {
  getSessionUser: getSessionUserImpl,

  async getActor(): Promise<Actor | null> {
    const session = await getSessionUserImpl()
    if (!session) return null
    const rows = await query<{ role: UserRole; permission_role: PermissionRole; hierarchy_role: HierarchyRole; is_active: boolean }>(
      'select role, permission_role, hierarchy_role, is_active from public.profiles where id = $1',
      [session.id]
    )
    const profile = rows[0]
    if (!profile) return null
    return {
      id: session.id,
      email: session.email,
      role: profile.role,
      permission_role: profile.permission_role,
      hierarchy_role: profile.hierarchy_role,
      isActive: profile.is_active,
    }
  },
}

// --- route-handler helpers (native mode only) -----------------------------------

export async function setSessionCookie(token: string): Promise<void> {
  const store = await cookies()
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  })
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies()
  store.set(SESSION_COOKIE, '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 })
}

export async function signIn(
  email: string,
  password: string
): Promise<{ user: SessionUser | null; error: string | null; sessionVersion?: number }> {
  const rows = await query<{
    id: string
    email: string
    password_hash: string | null
    session_version: number | null
  }>('select id, email, password_hash, session_version from public.profiles where email = $1', [email])
  const row = rows[0]
  if (!row || !row.password_hash) {
    await verifyDummyPassword(password)
    return { user: null, error: 'Invalid email or password.' }
  }
  const { valid, needsRehash } = await verifyPasswordDetails(password, row.password_hash)
  if (!valid) return { user: null, error: 'Invalid email or password.' }

  // Transparently upgrade legacy or non-standard hashes upon successful authentication
  if (needsRehash) {
    try {
      const newHash = await hashPassword(password)
      await query('update public.profiles set password_hash = $1 where id = $2', [newHash, row.id])
    } catch {
      // Best-effort non-blocking upgrade
    }
  }

  // Note: inactive accounts may still sign in so they can reach the
  // "pending approval" screen; data endpoints reject them via requireActive.
  return { user: { id: row.id, email: row.email }, error: null, sessionVersion: Number(row.session_version ?? 0) }
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
  options?: { preserveSessionId?: string; expectedSessionVersion?: number }
): Promise<{ error: string | null; sessionVersion?: number }> {
  try {
    return await transaction<{ error: string | null; sessionVersion?: number }>(async (client) => {
      const q = (client as unknown as { query: (text: string, params?: unknown[]) => Promise<unknown> }).query.bind(client)
      // Lock live session rows BEFORE the profile row. Refresh rotation takes
      // its session-row lock first and then needs the profile row (foreign-key
      // check on insert), so locking profile-first here would deadlock with a
      // concurrent rotation (profile→sessions vs sessions→profile). With
      // sessions-first ordering both paths acquire locks in the same order:
      // whoever waits on a session row holds nothing the other needs.
      // Either the rotation completes first and its replacement row is also
      // revoked below, or it blocks until this transaction commits and then
      // observes the bumped version / revoked row. No post-revocation session
      // can be resurrected.
      await q(
        'select id from public.mobile_sessions where user_id = $1 and revoked_at is null for update',
        [userId]
      )
      const res = (await q(
        'select password_hash, session_version from public.profiles where id = $1 for update',
        [userId]
      )) as unknown
      const rows = Array.isArray(res)
        ? (res as Array<{ password_hash: string | null; session_version: number | null }>)
        : (res as { rows: Array<{ password_hash: string | null; session_version: number | null }> })?.rows ?? []
      const row = rows[0]
      if (!row || !row.password_hash) {
        await verifyDummyPassword(currentPassword)
        return { error: 'User not found.' }
      }

      const currentVersion = Number(row.session_version ?? 0)
      if (
        options?.expectedSessionVersion !== undefined &&
        currentVersion !== options.expectedSessionVersion
      ) {
        return { error: 'session revoked — sign in again' }
      }

      const ok = await verifyPassword(currentPassword, row.password_hash)
      if (!ok) return { error: 'Current password is incorrect.' }

      const hash = await hashPassword(newPassword)
      const newVersion = currentVersion + 1

      const updateRes = (await q(
        'update public.profiles set password_hash = $1, session_version = $2 where id = $3 and coalesce(session_version, 0) = $4 returning id',
        [hash, newVersion, userId, currentVersion]
      )) as unknown
      const updateRows = Array.isArray(updateRes)
        ? (updateRes as Array<{ id: string }>)
        : (updateRes as { rows?: Array<{ id: string }> })?.rows ?? []
      const rowCount = typeof (updateRes as { rowCount?: number })?.rowCount === 'number'
        ? (updateRes as { rowCount: number }).rowCount
        : updateRows.length
      if (rowCount === 0) {
        return { error: 'Password update conflict. Please try again.' }
      }

      const preserveId = options?.preserveSessionId
      if (preserveId) {
        await q(
          'update public.mobile_sessions set revoked_at = coalesce(revoked_at, now()) where user_id = $1 and id <> $2 and revoked_at is null',
          [userId, preserveId]
        )
      } else {
        await q(
          'update public.mobile_sessions set revoked_at = coalesce(revoked_at, now()) where user_id = $1 and revoked_at is null',
          [userId]
        )
      }

      return { error: null, sessionVersion: newVersion }
    })
  } catch {
    return { error: 'Failed to update password.' }
  }
}
