// Canonical identity wire contracts shared by the web and mobile transports.
//
// This module is deliberately platform-neutral: it declares the inputs, error
// codes and capability surface of the authentication lifecycle only. Tokens,
// cookies, secure storage, credential hashing, provider clients and secrets all
// stay in the infrastructure that consumes these types, so no shared package
// ever imports an authentication implementation.

import { z } from 'zod'

/** Selected authentication backend. */
export type IdentityProvider = 'native' | 'supabase'

/** Mobile platform recorded on an application (refresh) session. */
export type IdentityPlatform = 'android' | 'ios' | 'windows'

/** Minimal provider-neutral authenticated principal. */
export interface IdentityPrincipal {
  id: string
  email: string
  /** Native session-token version; absent for provider-backed identities. */
  sessionVersion?: number
}

/** `POST /api/v1/auth/login` request body. */
export const identityLoginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
  deviceName: z.string().trim().max(120).optional(),
  platform: z.enum(['android', 'ios', 'windows']).optional(),
})

export type IdentityLoginInput = z.infer<typeof identityLoginSchema>

/** Signup request body shared by the web and mobile transports. */
export const identitySignupSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
  name: z.string().trim().optional(),
})

export type IdentitySignupInput = z.infer<typeof identitySignupSchema>

/** Change-password request body shared by the web and mobile transports. */
export const identityChangePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(1),
})

export type IdentityChangePasswordInput = z.infer<typeof identityChangePasswordSchema>

/** Password-recovery request body (`forgot-password`). */
export const identityPasswordResetRequestSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
})

export type IdentityPasswordResetRequestInput = z.infer<typeof identityPasswordResetRequestSchema>

/** Password-recovery completion body (`reset-password`). */
export const identityPasswordResetCompleteSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(1),
})

export type IdentityPasswordResetCompleteInput = z.infer<typeof identityPasswordResetCompleteSchema>

/** `POST /api/v1/auth/refresh` request body. */
export const identityRefreshSchema = z.object({
  refreshToken: z.string().min(1),
})

export type IdentityRefreshInput = z.infer<typeof identityRefreshSchema>

/** Body of the web two-phase mobile-session revocation (begin/complete). */
export interface IdentitySessionRevocationInput {
  complete?: boolean
}

/** Classification of a password change, matching the released server outcomes. */
export type IdentityPasswordChangeOutcome =
  | 'success'
  | 'invalid_credentials'
  | 'session_revoked'
  | 'update_failed'

export interface IdentityPasswordChangeSuccess {
  outcome: 'success'
  error: null
  sessionVersion: number
}

export interface IdentityPasswordChangeFailure {
  outcome: Exclude<IdentityPasswordChangeOutcome, 'success'>
  error: string
  sessionVersion?: undefined
}

/** Result of a native/provider password change. */
export type IdentityPasswordChangeResult =
  | IdentityPasswordChangeSuccess
  | IdentityPasswordChangeFailure

/** Canonical identity error codes emitted by the auth transports. */
export type IdentityErrorCode =
  | 'VALIDATION_ERROR'
  | 'AUTH_REQUIRED'
  | 'INVALID_CREDENTIALS'
  | 'ACCOUNT_INACTIVE'
  | 'SESSION_REVOKED'
  | 'ACCESS_TOKEN_EXPIRED'
  | 'REFRESH_TOKEN_REUSED'
  | 'INVALID_REFRESH_TOKEN'
  | 'RATE_LIMITED'
  | 'MOBILE_API_DISABLED'
  | 'UPGRADE_REQUIRED'
  | 'NOT_SUPPORTED'
  | 'ACCOUNT_EXISTS'
  | 'DOMAIN_NOT_ALLOWED'
  | 'REGISTRATION_UNAVAILABLE'
  | 'PASSWORD_UPDATE_FAILED'
  | 'SERVER_ERROR'

export interface IdentityError {
  code: IdentityErrorCode
  message: string
  status?: number
}

/** Runtime enumeration of the canonical error codes (for adapters and tests). */
export const IDENTITY_ERROR_CODES: readonly IdentityErrorCode[] = [
  'VALIDATION_ERROR',
  'AUTH_REQUIRED',
  'INVALID_CREDENTIALS',
  'ACCOUNT_INACTIVE',
  'SESSION_REVOKED',
  'ACCESS_TOKEN_EXPIRED',
  'REFRESH_TOKEN_REUSED',
  'INVALID_REFRESH_TOKEN',
  'RATE_LIMITED',
  'MOBILE_API_DISABLED',
  'UPGRADE_REQUIRED',
  'NOT_SUPPORTED',
  'ACCOUNT_EXISTS',
  'DOMAIN_NOT_ALLOWED',
  'REGISTRATION_UNAVAILABLE',
  'PASSWORD_UPDATE_FAILED',
  'SERVER_ERROR',
]

/**
 * Provider capability surface for the server identity lifecycle. A `false`
 * value means the operation is handled elsewhere (for example Supabase Auth
 * recovery is driven by the provider client), not that authentication is
 * unavailable.
 */
export interface IdentityCapabilities {
  login: boolean
  signup: boolean
  refresh: boolean
  logout: boolean
  logoutAll: boolean
  changePassword: boolean
  passwordRecovery: boolean
  mobileSessions: boolean
  bearerAuth: boolean
  cookieAuth: boolean
}
