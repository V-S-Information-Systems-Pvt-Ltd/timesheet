// app/actions/superadmin.ts
// Server Actions for super-admin restricted lifecycle, domains, titles, and layout operations.
'use server'

import { ADMIN_TILE_IDS, TILE_IDS } from '@/app/constants'
import { repo } from '@/lib/db'
import { getActor } from '@/lib/auth'
import type { AdminDashboardLayout, DashboardLayout, HierarchyRole, WhitelistedDomain } from '@/app/types'
import {
  type ActionResult,
  isSuperAdmin,
  requireSuperAdmin,
  safeAudit,
} from './_shared'

function layoutTilesValid(tiles: { id: string; enabled: boolean }[] | undefined, known: readonly string[]): boolean {
  const seen = new Set<string>()
  return (
    Array.isArray(tiles) &&
    tiles.length === known.length &&
    tiles.every(
      (t) => !!t && known.includes(t.id) && !seen.has(t.id) && typeof t.enabled === 'boolean' && (seen.add(t.id), true)
    )
  )
}

/** Super-admin: persist the global default panel order. */
export async function setDefaultLayouts(
  dashboard: DashboardLayout,
  admin: AdminDashboardLayout
): Promise<ActionResult> {
  const gate = await requireSuperAdmin()
  if ('error' in gate) return { error: 'You do not have permission to perform this action.' }

  if (!layoutTilesValid(dashboard?.tiles, TILE_IDS)) return { error: 'Invalid dashboard layout.' }
  if (!layoutTilesValid(admin?.tiles, ADMIN_TILE_IDS)) return { error: 'Invalid admin layout.' }

  const result = await repo.setDefaultLayouts(gate.actor, { dashboard, admin })
  return result.error ? { error: result.error } : {}
}

/** Whether the signed-in user is the configured super-admin. */
export async function amISuperAdmin(): Promise<{ isSuperAdmin: boolean }> {
  const actor = await getActor()
  return { isSuperAdmin: isSuperAdmin(actor) }
}

/** Super-admin: wipe data. mode = timesheets | activity | all. */
export async function resetDatabase(mode: string): Promise<ActionResult> {
  const gate = await requireSuperAdmin()
  if ('error' in gate) return { error: 'You do not have permission to perform this action.' }

  let result: { error: string | null }
  if (mode === 'timesheets') result = await repo.resetTimesheets(gate.actor)
  else if (mode === 'activity') result = await repo.resetActivityData(gate.actor)
  else if (mode === 'all') result = await repo.resetAllData(gate.actor)
  else return { error: 'Invalid reset mode.' }

  if (!result.error) {
    await safeAudit(gate.actor, {
      action: 'database.reset',
      detail: { mode },
    })
  }

  return result.error ? { error: result.error } : {}
}

/** Super-admin: permanently delete a user (profile, entries, auth identity). */
export async function deleteUser(userId: string): Promise<ActionResult> {
  const gate = await requireSuperAdmin()
  if ('error' in gate) return { error: 'You do not have permission to perform this action.' }
  if (userId === gate.actor.id) return { error: 'You cannot delete your own account.' }

  const result = await repo.deleteUser(gate.actor, userId)
  if (!result.error) {
    await safeAudit(gate.actor, {
      action: 'user.delete',
      targetId: userId,
    })
  }
  return result.error ? { error: result.error } : {}
}

/** Super-admin: permanently delete an activity type. */
export async function deleteActivityType(id: string): Promise<ActionResult> {
  const gate = await requireSuperAdmin()
  if ('error' in gate) return { error: 'You do not have permission to perform this action.' }

  const result = await repo.deleteActivityType(gate.actor, id)
  if (!result.error) {
    await safeAudit(gate.actor, {
      action: 'activity_type.delete',
      targetId: id,
    })
  }
  return result.error ? { error: result.error } : {}
}

// --- email domain whitelist (super-admin only) ---

export async function getWhitelistedDomains(): Promise<{ domains: WhitelistedDomain[]; error?: string }> {
  const gate = await requireSuperAdmin()
  if ('error' in gate) return { domains: [], error: 'Super-admin access required.' }

  try {
    const domains = await repo.listWhitelistedDomains(gate.actor)
    return { domains }
  } catch (err) {
    return { domains: [], error: err instanceof Error ? err.message : 'Failed to fetch domains.' }
  }
}

export async function addWhitelistedDomain(domain: string, autoActivate: boolean): Promise<ActionResult> {
  const gate = await requireSuperAdmin()
  if ('error' in gate) return { error: 'Super-admin access required.' }

  const clean = domain.trim().toLowerCase().replace(/^@/, '')
  if (!clean || !clean.includes('.')) {
    return { error: 'Please enter a valid domain (e.g. company.com).' }
  }

  const result = await repo.addWhitelistedDomain(gate.actor, clean, autoActivate)
  if (!result.error) {
    await safeAudit(gate.actor, {
      action: 'domain.whitelist_add',
      detail: { domain: clean, autoActivate },
    })
  }
  return result.error ? { error: result.error } : {}
}

export async function toggleDomainAutoActivate(id: string, autoActivate: boolean): Promise<ActionResult> {
  const gate = await requireSuperAdmin()
  if ('error' in gate) return { error: 'Super-admin access required.' }

  const result = await repo.updateWhitelistedDomain(gate.actor, id, autoActivate)
  if (!result.error) {
    await safeAudit(gate.actor, {
      action: 'domain.whitelist_toggle',
      targetId: id,
      detail: { autoActivate },
    })
  }
  return result.error ? { error: result.error } : {}
}

export async function deleteWhitelistedDomain(id: string): Promise<ActionResult> {
  const gate = await requireSuperAdmin()
  if ('error' in gate) return { error: 'Super-admin access required.' }

  const result = await repo.deleteWhitelistedDomain(gate.actor, id)
  if (!result.error) {
    await safeAudit(gate.actor, {
      action: 'domain.whitelist_delete',
      targetId: id,
    })
  }
  return result.error ? { error: result.error } : {}
}

// --- titles management (super-admin for add/delete/reclassify) ---

export async function addTitle(name: string, hierarchyRole: HierarchyRole = 'user'): Promise<ActionResult> {
  const gate = await requireSuperAdmin()
  if ('error' in gate) return { error: 'Super-admin access required.' }

  const clean = name.trim()
  if (!clean) return { error: 'Title name is required.' }

  const result = await repo.addTitle(gate.actor, clean, hierarchyRole)
  if (!result.error) {
    await safeAudit(gate.actor, {
      action: 'title.add',
      detail: { title: clean, hierarchyRole },
    })
  }
  return result.error ? { error: result.error } : {}
}

export async function reclassifyTitle(
  name: string,
  hierarchyRole: HierarchyRole,
  syncUsers = false
): Promise<ActionResult & { affectedCount?: number }> {
  const gate = await requireSuperAdmin()
  if ('error' in gate) return { error: 'Super-admin access required.' }

  const clean = name.trim()
  if (!clean) return { error: 'Title name is required.' }

  const result = await repo.reclassifyTitle(gate.actor, clean, hierarchyRole, syncUsers)
  if (!result.error) {
    await safeAudit(gate.actor, {
      action: 'title.reclassify',
      detail: { title: clean, hierarchyRole, syncUsers, affectedCount: result.affectedCount },
    })
  }
  return result.error
    ? { error: result.error }
    : { affectedCount: result.affectedCount }
}

export async function deleteTitle(name: string): Promise<ActionResult> {
  const gate = await requireSuperAdmin()
  if ('error' in gate) return { error: 'Super-admin access required.' }

  const clean = name.trim()
  if (!clean) return { error: 'Title name is required.' }

  const result = await repo.deleteTitle(gate.actor, clean)
  if (!result.error) {
    await safeAudit(gate.actor, {
      action: 'title.delete',
      detail: { title: clean },
    })
  }
  return result.error ? { error: result.error } : {}
}
