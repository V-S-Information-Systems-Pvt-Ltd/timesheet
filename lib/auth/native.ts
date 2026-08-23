// lib/auth/native.ts
// Native (cloud-native) auth: signed session cookies (JWT via jose) plus
// scrypt-hashed passwords stored in profiles.password_hash. Used by the Auth
// facade and by the native route handlers (login/logout/change-password).

import { cookies } from 'next/headers'
import { query } from '@/lib/db/pool'
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
  return verifySessionToken(token)
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
): Promise<{ user: SessionUser | null; error: string | null }> {
  const rows = await query<{
    id: string
    email: string
    password_hash: string | null
  }>('select id, email, password_hash from public.profiles where email = $1', [email])
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
  return { user: { id: row.id, email: row.email }, error: null }
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string
): Promise<{ error: string | null }> {
  const rows = await query<{ password_hash: string | null }>(
    'select password_hash from public.profiles where id = $1',
    [userId]
  )
  const row = rows[0]
  if (!row || !row.password_hash) {
    await verifyDummyPassword(currentPassword)
    return { error: 'User not found.' }
  }

  const ok = await verifyPassword(currentPassword, row.password_hash)
  if (!ok) return { error: 'Current password is incorrect.' }

  const hash = await hashPassword(newPassword)
  await query('update public.profiles set password_hash = $1 where id = $2', [hash, userId])
  return { error: null }
}
