import 'server-only'

import { createHash, randomBytes } from 'node:crypto'
import type { PoolClient } from 'pg'
import { transaction } from './pool'

export const EMAIL_VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000

export function hashEmailVerificationToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

/**
 * Record that the account holder proved control of the mailbox, and apply the
 * domain's auto-activate policy that self-signup deferred until now. A no-op
 * for profiles that are already verified, so it never re-activates an account
 * an administrator deactivated later.
 */
export async function markEmailVerified(client: PoolClient, userId: string, now: Date): Promise<void> {
  await client.query(
    `update public.profiles p
        set email_verified_at = $2,
            is_active = p.is_active or exists (
              select 1 from public.whitelisted_domains d
               where lower(d.domain) = split_part(lower(p.email), '@', 2)
                 and d.auto_activate
            )
      where p.id = $1
        and p.email_verified_at is null`,
    [userId, now.toISOString()]
  )
}

/** Create a single-use verification token for `userId`; the raw token goes out by mail only. */
export async function issueEmailVerificationToken(
  userId: string,
  now = new Date()
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(now.getTime() + EMAIL_VERIFICATION_TOKEN_TTL_MS)
  await transaction(async (client) => {
    await client.query(
      'update public.email_verification_tokens set used_at = coalesce(used_at, $1) where user_id = $2 and used_at is null',
      [now.toISOString(), userId]
    )
    await client.query(
      `insert into public.email_verification_tokens (user_id, token_hash, created_at, expires_at)
       values ($1, $2, $3, $4)`,
      [userId, hashEmailVerificationToken(token), now.toISOString(), expiresAt.toISOString()]
    )
    await client.query(
      `delete from public.email_verification_tokens
        where expires_at <= $1 or (used_at is not null and used_at <= $1 - interval '7 days')`,
      [now.toISOString()]
    )
  })
  return { token, expiresAt }
}

/** Consume a verification token. Returns false for unknown, used or expired tokens. */
export async function consumeEmailVerificationToken(token: string, now = new Date()): Promise<boolean> {
  const tokenHash = hashEmailVerificationToken(token)
  return transaction(async (client) => {
    const rows = await client.query<{ user_id: string }>(
      `select user_id from public.email_verification_tokens
        where token_hash = $1 and used_at is null and expires_at > $2
        for update`,
      [tokenHash, now.toISOString()]
    )
    const userId = rows.rows[0]?.user_id
    if (!userId) return false
    await client.query(
      'update public.email_verification_tokens set used_at = $1 where user_id = $2 and used_at is null',
      [now.toISOString(), userId]
    )
    await markEmailVerified(client, userId, now)
    return true
  })
}
