import 'server-only'

import { createHash, randomBytes } from 'node:crypto'
import type { PoolClient } from 'pg'
import { hashPassword } from '@/lib/auth/password'
import { markEmailVerified } from './email-verification'
import { query, transaction } from './pool'

export const PASSWORD_RESET_TOKEN_TTL_MS = 30 * 60 * 1000

export interface IssuedPasswordResetToken {
  userId: string
  email: string
  token: string
  expiresAt: Date
}

export type ConsumePasswordResetResult =
  | { ok: true; userId: string }
  | { ok: false }

export function hashPasswordResetToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

/**
 * Create a reset token for a known account. The caller must send the raw token
 * immediately; only its digest is returned to the database layer.
 */
export async function issuePasswordResetToken(
  email: string,
  now = new Date()
): Promise<IssuedPasswordResetToken | null> {
  const rawToken = randomBytes(32).toString('base64url')
  const tokenHash = hashPasswordResetToken(rawToken)
  const expiresAt = new Date(now.getTime() + PASSWORD_RESET_TOKEN_TTL_MS)

  return transaction(async (client) => {
    const users = await client.query<{ id: string; email: string }>(
      'select id, email from public.profiles where lower(email) = lower($1) limit 1',
      [email]
    )
    const user = users.rows[0]
    if (!user) return null

    // A newer request invalidates every older link, including already expired
    // rows. This keeps the active-token invariant explicit and bounded.
    await client.query(
      'update public.password_reset_tokens set used_at = coalesce(used_at, $1) where user_id = $2 and used_at is null',
      [now.toISOString(), user.id]
    )
    await client.query(
      `insert into public.password_reset_tokens
         (user_id, token_hash, created_at, expires_at)
       values ($1, $2, $3, $4)`,
      [user.id, tokenHash, now.toISOString(), expiresAt.toISOString()]
    )
    await client.query(
      `delete from public.password_reset_tokens
        where expires_at <= $1
           or (used_at is not null and used_at <= $1 - interval '7 days')`,
      [now.toISOString()]
    )

    return { userId: user.id, email: user.email, token: rawToken, expiresAt }
  })
}

/**
 * Atomically consume a reset token and update every native session boundary.
 * Hashing happens before the transaction so invalid-token requests perform the
 * same expensive password work as valid ones without holding a DB lock.
 */
export async function consumePasswordResetToken(
  token: string,
  newPassword: string,
  now = new Date()
): Promise<ConsumePasswordResetResult> {
  const tokenHash = hashPasswordResetToken(token)
  const passwordHash = await hashPassword(newPassword)

  return transaction(async (client) => {
    const rows = await client.query<{ user_id: string }>(
      `select user_id
         from public.password_reset_tokens
        where token_hash = $1
          and used_at is null
          and expires_at > $2
        for update`,
      [tokenHash, now.toISOString()]
    )
    const row = rows.rows[0]
    if (!row) return { ok: false }

    if (!(await replacePassword(client, row.user_id, passwordHash, now))) return { ok: false }
    // The reset link reached this mailbox, which proves ownership as well as
    // the verification link would.
    await markEmailVerified(client, row.user_id, now)

    return { ok: true, userId: row.user_id }
  })
}

/** Admin-set password: same session and reset-link invalidation as a reset. */
export async function setPasswordByAdmin(
  userId: string,
  newPassword: string,
  now = new Date()
): Promise<boolean> {
  const passwordHash = await hashPassword(newPassword)
  return transaction((client) => replacePassword(client, userId, passwordHash, now))
}

/** Store the hash, end every web and mobile session, and void open reset links. */
async function replacePassword(
  client: PoolClient,
  userId: string,
  passwordHash: string,
  now: Date
): Promise<boolean> {
  // Lock session rows before the profile row, the same order changePassword
  // and refresh rotation use (lib/auth/native.ts), so these cannot deadlock.
  await client.query('select id from public.mobile_sessions where user_id = $1 for update', [userId])
  const profile = await client.query<{ id: string }>(
    `update public.profiles
        set password_hash = $1,
            session_version = session_version + 1
      where id = $2
    returning id`,
    [passwordHash, userId]
  )
  if (!profile.rows[0]) return false

  await client.query(
    `update public.password_reset_tokens
        set used_at = coalesce(used_at, $1)
      where user_id = $2
        and used_at is null`,
    [now.toISOString(), userId]
  )
  await client.query(
    `update public.mobile_sessions
        set revoked_at = coalesce(revoked_at, $1)
      where user_id = $2
        and revoked_at is null`,
    [now.toISOString(), userId]
  )
  return true
}

export async function cleanupPasswordResetTokens(now = new Date()): Promise<number> {
  const rows = await query<{ id: string }>(
    `delete from public.password_reset_tokens
      where expires_at <= $1
         or (used_at is not null and used_at <= $1 - interval '7 days')
    returning id`,
    [now.toISOString()]
  )
  return rows.length
}
