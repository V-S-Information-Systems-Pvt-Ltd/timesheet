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
  signUp(
    email: string,
    password: string,
    name: string
  ): Promise<{ error: string | null; message?: string; isActive?: boolean }>
  signOut(): Promise<void>
  changePassword(currentPassword: string, newPassword: string): Promise<{ error: string | null }>
}

// --- supabase implementation -----------------------------------------------------

let supabase: ReturnType<typeof createClient> | null = null

/** Pre-signup whitelist lookup for the Supabase client flow. */
interface DomainCheckResult {
  allowed: boolean
  autoActivate: boolean
  error?: string
}

async function domainCheck(email: string): Promise<DomainCheckResult> {
  const params = new URLSearchParams({ email })
  const res = await fetch(`/api/auth/domain-check?${params.toString()}`, {
    credentials: 'same-origin',
  })
  if (!res.ok) {
    try {
      const body = (await res.json()) as { error?: string }
      if (body.error) return { allowed: false, autoActivate: false, error: body.error }
    } catch {
      /* fall through to generic error */
    }
    return { allowed: false, autoActivate: false, error: 'Failed to check registration domain.' }
  }
  const data = (await res.json()) as DomainCheckResult
  return { allowed: Boolean(data.allowed), autoActivate: Boolean(data.autoActivate) }
}

/**
 * Lazily create the Supabase browser client.
 *
 * Deliberately NOT at module scope: `next build` evaluates module top-level
 * code even in the native backend, and creating the client without the
 * Supabase env vars crashes prerendering (see .github/workflows/ci.yml,
 * container-build). The client is only ever needed at runtime in the browser.
 */
function getSupabase() {
  if (!supabase) supabase = createClient()
  return supabase
}

function mapSupabaseUser(
  u: { id: string; email?: string | null } | null | undefined
): ClientSessionUser | null {
  if (!u) return null
  return { id: u.id, email: u.email ?? '' }
}

const supabaseAuthClient: AuthClient = {
  async getSession() {
    const { data } = await getSupabase().auth.getSession()
    return { user: mapSupabaseUser(data.session?.user) }
  },

  onAuthStateChange(cb) {
    const { data } = getSupabase().auth.onAuthStateChange((_event, session) => {
      cb(mapSupabaseUser(session?.user))
    })
    return () => data.subscription.unsubscribe()
  },

  async signIn(email, password) {
    const { error } = await getSupabase().auth.signInWithPassword({ email, password })
    return { error: error ? error.message : null }
  },

  async signUp(email, password, name) {
    // Pre-check the domain whitelist before hitting Supabase so
    // non-whitelisted registrations fail fast with a friendly message. The DB
    // trigger is the actual enforcement backstop; this is the UX layer.
    const check = await domainCheck(email)
    if (check.error) return { error: check.error }
    if (!check.allowed) {
      return {
        error: `Registration is not allowed for @${email.split('@')[1] ?? ''}. Contact an administrator.`,
      }
    }
    const { error } = await getSupabase().auth.signUp({
      email,
      password,
      options: { data: { name } },
    })
    return { error: error ? error.message : null }
  },

  async signOut() {
    await getSupabase().auth.signOut()
  },

  async changePassword(currentPassword, newPassword) {
    const {
      data: { user },
    } = await getSupabase().auth.getUser()
    if (!user?.email) return { error: 'You must be signed in.' }

    const check = await getSupabase().auth.signInWithPassword({
      email: user.email,
      password: currentPassword,
    })
    if (check.error) return { error: 'Current password is incorrect.' }

    const { error } = await getSupabase().auth.updateUser({ password: newPassword })
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

  async signUp(email, password, name) {
    const data = await authFetch<{ error?: string | null; message?: string; isActive?: boolean }>('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email, password, name }),
    })
    return { error: data.error ?? null, message: data.message, isActive: data.isActive }
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
