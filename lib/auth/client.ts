// lib/auth/client.ts
// Client-side auth abstraction. Components call authClient instead of reaching
// into Supabase directly; the supabase implementation wraps the Supabase
// browser client and the native implementation calls the /api/auth route
// handlers (session cookie based).

'use client'

import { IS_NATIVE } from '@/lib/backend/client'
import { createClient } from '@/lib/supabase/client'

export interface ClientSessionUser {
  id: string
  email: string
}

export interface AuthClient {
  getSession(): Promise<{ user: ClientSessionUser | null }>
  onAuthStateChange(cb: (user: ClientSessionUser | null) => void): () => void
  signIn(email: string, password: string): Promise<{ error: string | null }>
  signUp(email: string, password: string, name: string): Promise<{ error: string | null }>
  signOut(): Promise<void>
  changePassword(currentPassword: string, newPassword: string): Promise<{ error: string | null }>
}

// --- supabase implementation -----------------------------------------------------

const supabase = createClient()

function mapSupabaseUser(
  u: { id: string; email?: string | null } | null | undefined
): ClientSessionUser | null {
  if (!u) return null
  return { id: u.id, email: u.email ?? '' }
}

const supabaseAuthClient: AuthClient = {
  async getSession() {
    const { data } = await supabase.auth.getSession()
    return { user: mapSupabaseUser(data.session?.user) }
  },

  onAuthStateChange(cb) {
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      cb(mapSupabaseUser(session?.user))
    })
    return () => data.subscription.unsubscribe()
  },

  async signIn(email, password) {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error: error ? error.message : null }
  },

  async signUp(email, password, name) {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { name } },
    })
    return { error: error ? error.message : null }
  },

  async signOut() {
    await supabase.auth.signOut()
  },

  async changePassword(currentPassword, newPassword) {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user?.email) return { error: 'You must be signed in.' }

    const check = await supabase.auth.signInWithPassword({
      email: user.email,
      password: currentPassword,
    })
    if (check.error) return { error: 'Current password is incorrect.' }

    const { error } = await supabase.auth.updateUser({ password: newPassword })
    return { error: error ? error.message : null }
  },
}

// --- native implementation -------------------------------------------------------

async function authFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    credentials: 'same-origin',
  })
  return (await res.json()) as T
}

async function nativeGetSession(): Promise<{ user: ClientSessionUser | null }> {
  const data = await authFetch<{ user: ClientSessionUser | null }>('/api/auth/me')
  return { user: data.user ?? null }
}

const nativeAuthClient: AuthClient = {
  getSession: nativeGetSession,

  onAuthStateChange(cb) {
    // Native mode has no cross-tab auth events; emit the current session once.
    nativeGetSession().then(({ user }) => cb(user))
    return () => {}
  },

  async signIn(email, password) {
    const data = await authFetch<{ error: string | null }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    })
    return { error: data.error ?? null }
  },

  async signUp() {
    return { error: 'Account creation is disabled in this deployment. Contact an administrator.' }
  },

  async signOut() {
    await authFetch('/api/auth/logout', { method: 'POST' })
  },

  async changePassword(currentPassword, newPassword) {
    const data = await authFetch<{ error: string | null }>('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    })
    return { error: data.error ?? null }
  },
}

export const authClient: AuthClient = IS_NATIVE ? nativeAuthClient : supabaseAuthClient
