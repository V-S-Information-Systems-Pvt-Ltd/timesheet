// app/actions/_shared.ts
// Shared server-only primitives and security gates for Server Action modules.
import 'server-only'
import { getActor } from '@/lib/auth'
import { requireActive, requireRole, type Actor } from '@/lib/db/types'
import type { PermissionRole } from '@/app/types'
import { writeGateResponse } from '@/lib/db/write-gate'
export { safeAudit } from '@/lib/audit'

export type ActionResult = { error?: string; fieldErrors?: Record<string, string[]> }

/**
 * Resolve the actor and enforce that their account is active.
 *
 * This is an authentication/active-account check only. Reads may use it while
 * the deployment write fence is closed; mutations must use
 * `requireMutatingActiveActor` instead.
 */
export async function requireActiveActor(): Promise<{ actor: Actor } | { error: string }> {
  const gate = requireActive(await getActor())
  if (!gate.ok) return { error: gate.error }
  return { actor: gate.actor }
}

async function writeFenceError(): Promise<string | null> {
  const refusal = await writeGateResponse().catch(() => ({
    status: 503,
    body: { error: 'The deployment write gate could not be read; writes are refused until it can be.' },
  }))
  return refusal
    ? (refusal.body as { error?: string }).error ??
      'This deployment is temporarily read-only for a data migration.'
    : null
}

/** `requireActiveActor` plus the fail-closed deployment write fence. */
export async function requireMutatingActiveActor(): Promise<{ actor: Actor } | { error: string }> {
  const gate = await requireActiveActor()
  if ('error' in gate) return gate
  const error = await writeFenceError()
  return error ? { error } : gate
}

/**
 * Resolve the actor and enforce that their role is allowed (and active).
 *
 * Read-only: this gate deliberately does not consult the write fence, so
 * read-only actions such as `exportBackup` keep working while the deployment
 * is fenced. Mutating role-gated actions use `requireMutatingActor`.
 */
export async function requireActor(
  allowed: PermissionRole[]
): Promise<{ actor: Actor } | { error: string }> {
  const gate = requireRole(await getActor(), allowed)
  if (!gate.ok) return { error: gate.error }
  return { actor: gate.actor }
}

/**
 * `requireActor` for a mutating action: same role gate, plus the C06B write
 * fence, so a role-gated mutation cannot bypass the fence that the REST and
 * `requireActiveActor` surfaces already obey. An unreadable gate refuses.
 */
export async function requireMutatingActor(
  allowed: PermissionRole[]
): Promise<{ actor: Actor } | { error: string }> {
  const gate = await requireActor(allowed)
  if ('error' in gate) return gate
  const error = await writeFenceError()
  return error ? { error } : gate
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

/** `requireSuperAdmin` plus the fail-closed deployment write fence. */
export async function requireMutatingSuperAdmin(): Promise<{ actor: Actor } | { error: string }> {
  const gate = await requireSuperAdmin()
  if ('error' in gate) return gate
  const error = await writeFenceError()
  return error ? { error } : gate
}
