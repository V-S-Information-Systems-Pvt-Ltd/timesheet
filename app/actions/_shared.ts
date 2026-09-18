// app/actions/_shared.ts
// Shared server-only primitives and security gates for Server Action modules.
import 'server-only'
import { getActor } from '@/lib/auth'
import { requireActive, requireRole, type Actor } from '@/lib/db/repository'
import type { PermissionRole } from '@/app/types'
import { logger, extractError } from '@/lib/logger'
import { operationsPersistence } from '@/lib/db/operations'

export type ActionResult = { error?: string; fieldErrors?: Record<string, string[]> }

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
    await operationsPersistence.writeAuditLog(actor, entry)
  } catch (err) {
    logger.error('audit log write failed', { action: entry.action, error: extractError(err) })
  }
}
