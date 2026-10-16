// lib/auth/client.ts
// Client-side auth abstraction. Components call authClient, which calls the
// versioned browser route handlers (session cookie based). Account creation
// goes through the server registration port.

'use client'

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

// --- shared server-backed helpers ------------------------------------------------

async function authFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    credentials: 'same-origin',
  })
  return (await res.json()) as T
}

/**
 * Create an account through the server registration port.
 *
 * The server owns email normalization, the domain whitelist check and the
 * per-IP rate limit. The browser never creates an identity itself.
 */
async function serverSignUp(
  email: string,
  password: string,
  name: string
): Promise<{ error: string | null; message?: string; isActive?: boolean }> {
  const data = await authFetch<{ error?: string | null; message?: string; isActive?: boolean }>(
    '/api/v1/auth/browser/signup',
    { method: 'POST', body: JSON.stringify({ email, password, name }) }
  )
  return { error: data.error ?? null, message: data.message, isActive: data.isActive }
}

// --- native implementation -------------------------------------------------------

async function nativeGetSession(): Promise<{ user: ClientSessionUser | null }> {
  const data = await authFetch<{ user: ClientSessionUser | null }>('/api/v1/auth/browser/me')
  return { user: data.user ?? null }
}

const nativeAuthClient: AuthClient = {
  getSession: nativeGetSession,

  onAuthStateChange(cb) {
    // There are no cross-tab auth events; emit the current session once.
    nativeGetSession().then(({ user }) => cb(user, 'INITIAL_SESSION'))
    return () => {}
  },

  async getPasswordRecoveryState() {
    return { ready: false }
  },

  async signIn(email, password) {
    const data = await authFetch<{ error: string | null }>('/api/v1/auth/browser/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    })
    return { error: data.error ?? null }
  },

  async signUp(email, password, name) {
    return serverSignUp(email, password, name)
  },

  async signOut() {
    await authFetch('/api/v1/auth/browser/logout', { method: 'POST' })
  },

  async changePassword(currentPassword, newPassword) {
    const data = await authFetch<{ error: string | null }>('/api/v1/auth/browser/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    })
    return { error: data.error ?? null }
  },

  async requestPasswordReset(email) {
    const data = await authFetch<{ error?: string | null }>('/api/v1/auth/browser/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email: email.trim().toLowerCase() }),
    })
    return { error: data.error ?? null }
  },

  async completePasswordReset(newPassword, token) {
    const data = await authFetch<{ error?: string | null }>('/api/v1/auth/browser/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, newPassword }),
    })
    return { error: data.error ?? null }
  },
}

export const authClient: AuthClient = nativeAuthClient
