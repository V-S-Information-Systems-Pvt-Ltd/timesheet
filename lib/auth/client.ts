// lib/auth/client.ts
// Client-side auth abstraction. Components call authClient instead of reaching
// into Supabase directly; the supabase implementation wraps the Supabase
// browser client and the native implementation calls the /api/auth route
// handlers (session cookie based).

'use client'

import { IS_NATIVE } from '@/lib/backend/client'
import type { createClient as createClientFn } from '@/lib/supabase/client'

export interface ClientSessionUser {
  id: string
  email: string
}

export type AuthStateEvent =
  | 'INITIAL_SESSION'
  | 'SIGNED_IN'
  | 'SIGNED_OUT'
  | 'PASSWORD_RECOVERY'
  | 'TOKEN_REFRESHED'
  | 'USER_UPDATED'

export interface AuthClient {
  getSession(): Promise<{ user: ClientSessionUser | null }>
  onAuthStateChange(cb: (user: ClientSessionUser | null, event?: AuthStateEvent) => void): () => void
  getPasswordRecoveryState(): Promise<{ ready: boolean }>
  signIn(email: string, password: string): Promise<{ error: string | null }>
  signUp(
    email: string,
    password: string,
    name: string
  ): Promise<{ error: string | null; message?: string; isActive?: boolean }>
  signOut(): Promise<void>
  changePassword(currentPassword: string, newPassword: string): Promise<{ error: string | null }>
  requestPasswordReset(email: string): Promise<{ error: string | null }>
  completePasswordReset(newPassword: string, token?: string): Promise<{ error: string | null }>
}

// --- supabase implementation -----------------------------------------------------

let supabase: ReturnType<typeof createClientFn> | null = null
let supabaseRecoverySession = false
const RECOVERY_STORAGE_KEY = 'vsis-password-recovery'

function setSupabaseRecoveryState(ready: boolean): void {
  supabaseRecoverySession = ready
  try {
    if (ready) window.sessionStorage.setItem(RECOVERY_STORAGE_KEY, '1')
    else window.sessionStorage.removeItem(RECOVERY_STORAGE_KEY)
  } catch {
    // Session storage may be unavailable in privacy-restricted browsers.
  }
}

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
async function getSupabase() {
  if (!supabase) {
    const { createClient } = await import('@/lib/supabase/client')
    supabase = createClient()
  }
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
    const sb = await getSupabase()
    const { data } = await sb.auth.getSession()
    return { user: mapSupabaseUser(data.session?.user) }
  },

  onAuthStateChange(cb) {
    let unsubscribe = () => {}
    void getSupabase().then((sb) => {
      const { data } = sb.auth.onAuthStateChange((event, session) => {
        if (event === 'PASSWORD_RECOVERY') setSupabaseRecoveryState(true)
        if (event === 'SIGNED_OUT') setSupabaseRecoveryState(false)
        const mapped = mapSupabaseUser(session?.user)
        if (event) cb(mapped, event as AuthStateEvent)
        else cb(mapped)
      })
      unsubscribe = () => data.subscription.unsubscribe()
    })
    return () => unsubscribe()
  },

  async getPasswordRecoveryState() {
    await getSupabase()
    if (!supabaseRecoverySession) {
      try {
        supabaseRecoverySession = window.sessionStorage.getItem(RECOVERY_STORAGE_KEY) === '1'
      } catch {
        // Session storage may be unavailable in privacy-restricted browsers.
      }
    }
    return { ready: supabaseRecoverySession }
  },

  async signIn(email, password) {
    const sb = await getSupabase()
    const { error } = await sb.auth.signInWithPassword({ email, password })
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
    const sb = await getSupabase()
    const { error } = await sb.auth.signUp({
      email,
      password,
      options: { data: { name } },
    })
    return { error: error ? error.message : null }
  },

  async signOut() {
    const sb = await getSupabase()
    await sb.auth.signOut()
    setSupabaseRecoveryState(false)
  },

  async changePassword(currentPassword, newPassword) {
    const sb = await getSupabase()
    const {
      data: { user },
    } = await sb.auth.getUser()
    if (!user?.email) return { error: 'You must be signed in.' }

    const check = await sb.auth.signInWithPassword({
      email: user.email,
      password: currentPassword,
    })
    if (check.error) return { error: 'Current password is incorrect.' }

    const { error } = await sb.auth.updateUser({ password: newPassword })
    return { error: error ? error.message : null }
  },

  async requestPasswordReset(email) {
    try {
      const sb = await getSupabase()
      const { error } = await sb.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
        redirectTo: `${window.location.origin}/reset-password`,
      })
      return { error: error ? 'Unable to send password reset email.' : null }
    } catch {
      return { error: 'Unable to send password reset email.' }
    }
  },

  async completePasswordReset(newPassword) {
    try {
      const sb = await getSupabase()
      if (!supabaseRecoverySession) return { error: 'This password reset link is invalid or has expired.' }
      const {
        data: { user },
      } = await sb.auth.getUser()
      if (!user) return { error: 'This password reset link is invalid or has expired.' }

      const revokeResponse = await fetch('/api/auth/revoke-mobile-sessions', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!revokeResponse.ok) return { error: 'Unable to complete password reset.' }

      const { error } = await sb.auth.updateUser({ password: newPassword })
      if (error) return { error: 'Unable to complete password reset.' }
      await sb.auth.signOut()
      setSupabaseRecoveryState(false)
      return { error: null }
    } catch {
      return { error: 'Unable to complete password reset.' }
    }
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
    nativeGetSession().then(({ user }) => cb(user, 'INITIAL_SESSION'))
    return () => {}
  },

  async getPasswordRecoveryState() {
    return { ready: false }
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

  async requestPasswordReset(email) {
    const data = await authFetch<{ error?: string | null }>('/api/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email: email.trim().toLowerCase() }),
    })
    return { error: data.error ?? null }
  },

  async completePasswordReset(newPassword, token) {
    const data = await authFetch<{ error?: string | null }>('/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, newPassword }),
    })
    return { error: data.error ?? null }
  },
}

export const authClient: AuthClient = IS_NATIVE ? nativeAuthClient : supabaseAuthClient
