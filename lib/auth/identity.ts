// lib/auth/identity.ts
// Explicit identity boundary for the authentication lifecycle.
//
// These ports are the ONLY surface the identity operations depend on. Provider
// mechanics — scrypt hashing, JWT/session secrets, cookie writing, Supabase
// clients and secure token storage — live in the adapters under `lib/auth`
// that satisfy them and are injected by the transports at composition time.
//
// Nothing in this module imports a provider client, cookie API, password hash,
// token store or secret at runtime (all imports below are type-only), so the
// boundary is safe to share between the web and mobile transports.

import type { Actor } from '@/lib/db/repository'
import type {
  IdentityCapabilities,
  IdentityProvider,
} from '@vsis/contracts'
import type { SessionUser } from './index'
import type {
  CreateMobileSessionInput,
  MobileSession,
  RevokeOtherSessionsResult,
  RotateMobileSessionInput,
  RotateMobileSessionResult,
} from './mobile-session-store'
import type { MobileAccessTokenInput } from './mobile-tokens'
import type { ChangePasswordResult } from './native'

/** Verify email/password credentials against the active provider. */
export interface IdentityCredentialPort {
  verifyCredentials(
    email: string,
    password: string
  ): Promise<{ user: SessionUser | null; error: string | null }>
}

/** Resolve the current actor (role axes + active flag) for a principal. */
export interface IdentityActorPort {
  resolve(userId: string): Promise<Actor | null>
}

/** Application session (mobile refresh-session) lifecycle. */
export interface IdentitySessionPort {
  create(input: CreateMobileSessionInput): Promise<MobileSession>
  rotate(input: RotateMobileSessionInput): Promise<RotateMobileSessionResult>
  revokeSession(id: string): Promise<void>
  revokeAll(userId: string): Promise<void>
  revokeOtherSessions(userId: string, preserveSessionId: string): Promise<RevokeOtherSessionsResult>
  beginPasswordChange(userId: string): Promise<void>
  completePasswordChange(userId: string, preserveSessionId: string | null): Promise<void>
  cleanupExpired(now?: Date): Promise<number>
}

/** Opaque bearer-token minting. Raw secrets never leave the adapter. */
export interface IdentityTokenPort {
  generateRefreshToken(): string
  hashRefreshToken(token: string): string
  signMobileAccessToken(input: MobileAccessTokenInput): Promise<string>
}

/** Password write for the active provider (native scrypt / Supabase Auth). */
export interface IdentityPasswordPort {
  changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    options?: { preserveSessionId?: string; expectedSessionVersion?: number }
  ): Promise<ChangePasswordResult>
}

/**
 * Outcome of an individual provider-side step. `provider_error` carries the
 * provider's own message; `request_failed` means the request itself could not
 * complete (for example the provider client threw).
 */
export type IdentityProviderStepResult =
  | { ok: true }
  | { ok: false; kind: 'provider_error' | 'request_failed'; message: string }

/**
 * Provider-side password-change sequence used by the mobile transport:
 * authenticate a temporary provider session with the current password, write
 * the new password, revoke the actor's other provider sessions, then clean the
 * temporary session up. The Supabase client stays inside the adapter that
 * builds this port.
 */
export interface IdentityMobileProviderPasswordPort {
  authenticate(input: {
    email: string
    currentPassword: string
  }): Promise<{ ok: true } | { ok: false; message: string }>
  updatePassword(input: {
    currentPassword: string
    newPassword: string
  }): Promise<IdentityProviderStepResult>
  revokeOtherProviderSessions(): Promise<IdentityProviderStepResult>
  /** Returns a cleanup error message, or null when cleanup succeeded/no-op. */
  cleanup(): Promise<string | null>
}

/** Dependencies of the mobile login operation. */
export interface LoginIdentityDeps {
  credentials: IdentityCredentialPort
  sessions: IdentitySessionPort
  tokens: IdentityTokenPort
  actors: IdentityActorPort
}

/** Dependencies of the mobile refresh operation. */
export interface RefreshIdentityDeps {
  sessions: IdentitySessionPort
  tokens: IdentityTokenPort
}

/** Dependencies of the session-revocation operations. */
export interface SessionRevocationDeps {
  sessions: Pick<
    IdentitySessionPort,
    'revokeSession' | 'revokeAll' | 'beginPasswordChange' | 'completePasswordChange'
  >
}

/** Dependencies of the mobile password-change session guard. */
export interface MobileSessionPasswordChangeDeps {
  sessions: Pick<IdentitySessionPort, 'revokeOtherSessions' | 'completePasswordChange'>
}

/** Dependencies of the provider password write. */
export interface PasswordChangeDeps {
  passwords: IdentityPasswordPort
}

export type IdentityLoginOutcome =
  | { ok: true; accessToken: string; refreshToken: string; sessionId: string; actor: Actor }
  | { ok: false; code: 'INVALID_CREDENTIALS'; message: string }

export type IdentityRefreshOutcome =
  | { ok: true; accessToken: string; refreshToken: string; sessionId: string }
  | { ok: false; code: 'REFRESH_TOKEN_REUSED' | 'INVALID_REFRESH_TOKEN'; message: string }

/**
 * Provider capability matrix. A `false` entry means the operation is handled
 * outside the server identity boundary for that provider (for example Supabase
 * Auth recovery is driven by the provider client), not that it is unavailable.
 */
export const IDENTITY_CAPABILITIES: Record<IdentityProvider, IdentityCapabilities> = {
  native: {
    login: true,
    signup: true,
    refresh: true,
    logout: true,
    logoutAll: true,
    changePassword: true,
    passwordRecovery: true,
    mobileSessions: true,
    bearerAuth: true,
    cookieAuth: true,
  },
  supabase: {
    login: true,
    signup: true,
    refresh: true,
    logout: true,
    logoutAll: true,
    changePassword: true,
    passwordRecovery: false,
    mobileSessions: true,
    bearerAuth: true,
    cookieAuth: true,
  },
}

export function getIdentityCapabilities(provider: IdentityProvider): IdentityCapabilities {
  return IDENTITY_CAPABILITIES[provider]
}
