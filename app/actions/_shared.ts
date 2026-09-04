// app/actions/_shared.ts
// Shared server-only primitives and security gates for Server Action modules.
import 'server-only'
import { getActor } from '@/lib/auth'
import { requireActive, requireRole, type Actor } from '@/lib/db/repository'
import type { PermissionRole } from '@/app/types'
import { reserveWriteRateLimit as reserveWriteBudget, type RateLimitReservation } from '@/lib/rate-limit'
import { logger, extractError } from '@/lib/logger'
import { repo } from '@/lib/db'

export type ActionResult = { error?: string; fieldErrors?: Record<string, string[]> }

/**
 * Reserve one unit of the per-user daily write budget.
 *
 * The slot is held from here on. Call `releaseWriteRateLimit` when the guarded
 * write turns out not to be chargeable, so failed and aborted attempts do not
 * burn budget — the same policy as before, but now the reservation is atomic, so
 * concurrent requests cannot both pass a check that only one of them should.
 */
export async function reserveWriteRateLimit(
  actor: Actor
): Promise<{ ok: true; reservation: RateLimitReservation } | { ok: false; error: string }> {
  const result = await reserveWriteBudget(actor.id)
  if (!result.ok) {
    logger.warn('rate limit: write exceeded', { userId: actor.id, retryAfter: result.retryAfter })
    return { ok: false, error: result.error }
  }
  return { ok: true, reservation: result.reservation }
}

/** Return an unused write slot. Safe to call more than once. */
export async function releaseWriteRateLimit(
  reservation: RateLimitReservation | null | undefined
): Promise<void> {
  await reservation?.release()
}

/**
 * Run a guarded write with the per-user daily budget reserved for its duration.
 *
 * The slot is released unless `isChargeable` says the work counted, so validation
 * failures, permission rejections, and thrown errors all cost nothing — the same
 * policy the peek/consume pair had, but leak-proof: every exit path runs through
 * the `finally` here instead of needing its own release call.
 *
 * `isChargeable` defaults to "no error", which matches the single-entity actions.
 * Batch actions override it (a batch that updated nothing is not chargeable).
 */
export async function withWriteBudget<T extends ActionResult>(
  actor: Actor,
  run: () => Promise<T>,
  isChargeable: (result: T) => boolean = (result) => !result.error
): Promise<T | { error: string }> {
  const gate = await reserveWriteRateLimit(actor)
  if (!gate.ok) return { error: gate.error }

  let chargeable = false
  try {
    const result = await run()
    chargeable = isChargeable(result)
    return result
  } finally {
    if (!chargeable) await gate.reservation.release()
  }
}

/** Resolve the actor and enforce that their account is active. */
export async function requireActiveActor(): Promise<{ actor: Actor } | { error: string }> {
  const gate = requireActive(await getActor())
  if (!gate.ok) return { error: gate.error }
  return { actor: gate.actor }
}

/** Resolve the actor and enforce that their role is allowed (and active). */
export async function requireActor(
  allowed: PermissionRole[]
): Promise<{ actor: Actor } | { error: string }> {
  const gate = requireRole(await getActor(), allowed)
  if (!gate.ok) return { error: gate.error }
  return { actor: gate.actor }
}

import { isSuperAdmin } from '@/lib/auth/super-admin'
export { isSuperAdmin }

/** Resolve the actor and enforce super-admin permissions. */
export async function requireSuperAdmin(): Promise<{ actor: Actor } | { error: string }> {
  const gate = await requireActiveActor()
  if ('error' in gate) return gate
  if (!isSuperAdmin(gate.actor)) {
    return { error: 'Super-admin access required.' }
  }
  return gate
}

/** Best-effort audit logging that records operational failures without failing the user mutation. */
export async function safeAudit(
  actor: Actor,
  entry: { action: string; targetId?: string; detail?: Record<string, unknown> }
): Promise<void> {
  try {
    await repo.writeAuditLog(actor, entry)
  } catch (err) {
    logger.error('audit log write failed', { action: entry.action, error: extractError(err) })
  }
}
