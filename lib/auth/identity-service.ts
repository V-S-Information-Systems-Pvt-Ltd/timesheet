// lib/auth/identity-service.ts
// Provider-neutral identity lifecycle operations.
//
// Every operation receives its dependencies explicitly (the ports defined in
// `./identity`). This module imports no provider client, cookie API, password
// hash, token store, native module or secret — not even type-runtime — so the
// transports own Request/cookie parsing and HTTP response/cookie writing while
// the injected adapters own provider mechanics.

import type { Actor } from '@/lib/db/repository'
import type { IdentityLoginInput, IdentityRefreshInput } from '@vsis/contracts'
import type {
  IdentityLoginOutcome,
  IdentityRefreshOutcome,
  LoginIdentityDeps,
  MobileSessionPasswordChangeDeps,
  PasswordChangeDeps,
  RefreshIdentityDeps,
  SessionRevocationDeps,
} from './identity'
import type { ChangePasswordResult } from './native'

/**
 * Verify credentials, mint an application session and a bearer access token,
 * and resolve the actor DTO. Returns a generic invalid-credentials outcome so
 * the transport cannot become an account-existence oracle.
 */
export async function loginMobileIdentity(
  input: IdentityLoginInput,
  deps: LoginIdentityDeps
): Promise<IdentityLoginOutcome> {
  const verified = await deps.credentials.verifyCredentials(input.email, input.password)
  if (verified.error || !verified.user) {
    return {
      ok: false,
      code: 'INVALID_CREDENTIALS',
      message: verified.error ?? 'Invalid email or password.',
    }
  }

  const refreshToken = deps.tokens.generateRefreshToken()
  const session = await deps.sessions.create({
    userId: verified.user.id,
    refreshTokenHash: deps.tokens.hashRefreshToken(refreshToken),
    deviceName: input.deviceName,
    platform: input.platform,
  })
  const accessToken = await deps.tokens.signMobileAccessToken({
    userId: verified.user.id,
    sessionId: session.id,
    familyId: session.familyId,
  })

  const resolvedActor = await deps.actors.resolve(verified.user.id)
  const actor: Actor = resolvedActor ?? {
    id: verified.user.id,
    email: verified.user.email,
    role: 'user',
    permission_role: 'user',
    hierarchy_role: 'user',
    isActive: true,
  }

  return { ok: true, accessToken, refreshToken, sessionId: session.id, actor }
}

/**
 * Rotate the presented refresh token and mint a replacement pair. The rotation
 * itself is atomic in the session port; reuse/expiry/revocation are reported
 * without issuing another access token.
 */
export async function refreshMobileIdentity(
  input: IdentityRefreshInput,
  deps: RefreshIdentityDeps
): Promise<IdentityRefreshOutcome> {
  const replacementToken = deps.tokens.generateRefreshToken()
  const result = await deps.sessions.rotate({
    presentedTokenHash: deps.tokens.hashRefreshToken(input.refreshToken),
    replacementTokenHash: deps.tokens.hashRefreshToken(replacementToken),
  })
  if (result.status !== 'rotated') {
    const code = result.status === 'reused' ? 'REFRESH_TOKEN_REUSED' : 'INVALID_REFRESH_TOKEN'
    return {
      ok: false,
      code,
      message: 'The refresh session is no longer valid. Please sign in again.',
    }
  }

  const accessToken = await deps.tokens.signMobileAccessToken({
    userId: result.session.userId,
    sessionId: result.session.id,
    familyId: result.session.familyId,
  })
  return { ok: true, accessToken, refreshToken: replacementToken, sessionId: result.session.id }
}

/** Revoke exactly one application session (mobile logout). */
export async function revokeMobileSession(
  sessionId: string,
  deps: SessionRevocationDeps
): Promise<void> {
  await deps.sessions.revokeSession(sessionId)
}

/** Revoke every session for an actor (mobile logout-all). */
export async function revokeAllMobileSessions(
  userId: string,
  deps: SessionRevocationDeps
): Promise<void> {
  await deps.sessions.revokeAll(userId)
}

/**
 * Web-transport password-change revocation phases. `begin` revokes every
 * application session and sets the database insert guard; `complete` clears
 * the guard and sweeps anything minted while the provider write ran.
 */
export async function revokeMobileSessionsForPasswordChange(
  userId: string,
  options: { complete?: boolean },
  deps: SessionRevocationDeps
): Promise<void> {
  if (options.complete) {
    await deps.sessions.completePasswordChange(userId, null)
  } else {
    await deps.sessions.beginPasswordChange(userId)
  }
}

/**
 * Revoke the actor's other application sessions while preserving the caller's
 * live session. Returns `conflict` when the preserved session is no longer
 * live, so the caller stops before the provider password write.
 */
export async function revokeOtherMobileSessions(
  userId: string,
  preserveSessionId: string,
  deps: MobileSessionPasswordChangeDeps
): Promise<'revoked' | 'conflict'> {
  return deps.sessions.revokeOtherSessions(userId, preserveSessionId)
}

/** Clear the mobile password-change guard and sweep late sessions. */
export async function completeMobilePasswordChange(
  userId: string,
  preserveSessionId: string | null,
  deps: MobileSessionPasswordChangeDeps
): Promise<void> {
  await deps.sessions.completePasswordChange(userId, preserveSessionId)
}

/**
 * Apply the provider password write for the authenticated actor. The transport
 * passes the actor (web) or the current mobile session (mobile) guard options;
 * provider semantics stay in the injected port.
 */
export async function changePasswordForActor(
  userId: string,
  input: { currentPassword: string; newPassword: string },
  options: { preserveSessionId?: string; expectedSessionVersion?: number } | undefined,
  deps: PasswordChangeDeps
): Promise<ChangePasswordResult> {
  return deps.passwords.changePassword(userId, input.currentPassword, input.newPassword, options)
}
