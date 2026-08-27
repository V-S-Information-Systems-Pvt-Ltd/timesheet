// app/actions/_shared.ts
// Shared server-only primitives and security gates for Server Action modules.
import 'server-only'
import { getActor } from '@/lib/auth'
import { requireActive, requireRole, type Actor } from '@/lib/db/repository'
import { isAdminActor } from '@/lib/roles'
import type { PermissionRole } from '@/app/types'
import {
  peekWriteRateLimit as peekWriteBudget,
  consumeWriteRateLimit as consumeWriteBudget,
} from '@/lib/rate-limit'
import { logger, extractError } from '@/lib/logger'
import { repo } from '@/lib/db'

export type ActionResult = { error?: string; fieldErrors?: Record<string, string[]> }

/**
 * Peek the per-user daily write budget WITHOUT consuming. Rejects early when
 * the budget is already exhausted.
 */
export function peekWriteRateLimit(actor: Actor): { ok: true } | { ok: false; error: string } {
  const result = peekWriteBudget(actor.id)
  if (!result.ok) {
    logger.warn('rate limit: write exceeded', { userId: actor.id, retryAfter: result.retryAfter })
    return { ok: false, error: result.error }
  }
  return { ok: true }
}

/** Charge one unit of the per-user daily write budget (call on success). */
export function consumeWriteRateLimit(actor: Actor): void {
  consumeWriteBudget(actor.id)
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

/**
 * Super-admin: the single account configured via SUPER_ADMIN_EMAIL (must
 * also hold the admin role and be active). Extra powers: reset database, delete users,
 * delete activity types.
 */
export function isSuperAdmin(actor: Actor | null): boolean {
  const email = process.env.SUPER_ADMIN_EMAIL?.trim().toLowerCase()
  return !!actor && actor.isActive && !!email && isAdminActor(actor) && actor.email.toLowerCase() === email
}

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
