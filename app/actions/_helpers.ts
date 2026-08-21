// app/actions/_helpers.ts
'use server'

import { RATE_LIMIT_DAILY, peekRateLimit, consumeRateLimit, dailyWriteStore, getRetryAfter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { getActor } from '@/lib/auth'
import { requireRole, type Actor } from '@/lib/db/repository'
import type { UserRole } from '@/app/types'

export type ActionResult = { error?: string; fieldErrors?: Record<string, string[]> }

/**
 * Peek the per-user daily write budget WITHOUT consuming. Rejects early when
 * the budget is already exhausted, so a user over the limit never starts a
 * write. The budget itself is charged (see `consumeWriteRateLimit`) only after
 * a write actually succeeds — failed/aborted writes don't burn it.
 */
export async function peekWriteRateLimit(actor: Actor): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = peekRateLimit(dailyWriteStore, `writes:${actor.id}`, RATE_LIMIT_DAILY)
  if (!result.ok) {
    const retry = getRetryAfter(result.resetAt)
    logger.warn('rate limit: write exceeded', { userId: actor.id, retryAfter: retry })
    return { ok: false, error: `Rate limit exceeded. Try again in ${retry}s.` }
  }
  return { ok: true }
}

/** Charge one unit of the per-user daily write budget (call on success). */
export async function consumeWriteRateLimit(actor: Actor): Promise<void> {
  consumeRateLimit(dailyWriteStore, `writes:${actor.id}`, RATE_LIMIT_DAILY)
}

/** Resolve the actor and enforce that their role is allowed. */
export async function requireActor(
  allowed: UserRole[]
): Promise<{ actor: Actor } | { error: string }> {
  const gate = requireRole(await getActor(), allowed)
  if (!gate.ok) return { error: gate.error }
  return { actor: gate.actor }
}

/**
 * Super-admin: the single account configured via SUPER_ADMIN_EMAIL (must
 * also hold the admin role). Extra powers: reset database, delete users,
 * delete activity types.
 */
export function isSuperAdmin(actor: Actor | null): boolean {
  const email = process.env.SUPER_ADMIN_EMAIL?.trim().toLowerCase()
  return !!actor && !!email && actor.role === 'admin' && actor.email.toLowerCase() === email
}
