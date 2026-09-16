// app/actions/superadmin.ts
// Server Actions for super-admin restricted lifecycle, domains, titles, and layout operations.
'use server'

import { referenceDeps } from '@/lib/db/reference'
import { operationsDeps } from '@/lib/db/operations'
import { peopleDeps } from '@/lib/db/people'
import { workspaceDeps } from '@/lib/db/workspace'
import { resetOperationalData } from '@/lib/domain/operations'
import { saveDefaultLayouts } from '@/lib/domain/workspace'
import { getActor } from '@/lib/auth'
import type { AdminDashboardLayout, DashboardLayout, HierarchyRole, MobileLayout, WhitelistedDomain } from '@/app/types'
import {
  addTitle as addTitleDomain,
  addWhitelistedDomain as addWhitelistedDomainDomain,
  deleteActivityType as deleteActivityTypeDomain,
  deleteTitle as deleteTitleDomain,
  deleteWhitelistedDomain as deleteWhitelistedDomainDomain,
  getTitleImpact as getTitleImpactDomain,
  listWhitelistedDomains as listWhitelistedDomainsDomain,
  reclassifyTitle as reclassifyTitleDomain,
  updateWhitelistedDomain as updateWhitelistedDomainDomain,
} from '@/lib/domain/reference'
import { deletePersonDomain } from '@/lib/domain/people'
import {
  type ActionResult,
  isSuperAdmin,
  requireSuperAdmin,
  safeAudit,
} from './_shared'

/** Super-admin: persist the global default panel order. */
export async function setDefaultLayouts(
  dashboard: DashboardLayout,
  admin: AdminDashboardLayout,
  mobile?: MobileLayout | null
): Promise<ActionResult> {
  const gate = await requireSuperAdmin()
  if ('error' in gate) return { error: 'You do not have permission to perform this action.' }

  const result = await saveDefaultLayouts(gate.actor, { dashboard, admin, mobile }, workspaceDeps())
  return result.ok ? {} : { error: result.error.message }
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

  // Destructive reset orchestration (mode dispatch + audit) is owned by the
  // operations coordinator; this transport only maps the domain error shape.
  const result = await resetOperationalData(gate.actor, mode, operationsDeps())
  return result.ok ? {} : { error: result.error.message }
}

/** Super-admin: permanently delete a user (profile, entries, auth identity). */
export async function deleteUser(userId: string): Promise<ActionResult> {
  const gate = await requireSuperAdmin()
  if ('error' in gate) return { error: 'You do not have permission to perform this action.' }

  const result = await deletePersonDomain(gate.actor, userId, peopleDeps())
  return result.ok ? {} : { error: result.error.message }
}

/** Super-admin: permanently delete an activity type. */
export async function deleteActivityType(id: string): Promise<ActionResult> {
  const gate = await requireSuperAdmin()
  if ('error' in gate) return { error: 'You do not have permission to perform this action.' }

  const result = await deleteActivityTypeDomain(gate.actor, id, referenceDeps())
  if (!result.ok) return { error: result.error.message }

  await safeAudit(gate.actor, {
    action: 'activity_type.delete',
    targetId: id,
  })
  return {}
}

// --- email domain whitelist (super-admin only) ---

export async function getWhitelistedDomains(): Promise<{ domains: WhitelistedDomain[]; error?: string }> {
  const gate = await requireSuperAdmin()
  if ('error' in gate) return { domains: [], error: 'Super-admin access required.' }

  const result = await listWhitelistedDomainsDomain(gate.actor, referenceDeps())
  return result.ok ? { domains: result.data } : { domains: [], error: result.error.message }
}

export async function addWhitelistedDomain(domain: string, autoActivate: boolean): Promise<ActionResult> {
  const gate = await requireSuperAdmin()
  if ('error' in gate) return { error: 'Super-admin access required.' }

  const result = await addWhitelistedDomainDomain(gate.actor, domain, autoActivate, referenceDeps())
  if (result.ok) {
    await safeAudit(gate.actor, {
      action: 'domain.whitelist_add',
      detail: { domain: result.data.domain, autoActivate },
    })
  }
  return result.ok ? {} : { error: result.error.message }
}

export async function toggleDomainAutoActivate(id: string, autoActivate: boolean): Promise<ActionResult> {
  const gate = await requireSuperAdmin()
  if ('error' in gate) return { error: 'Super-admin access required.' }

  const result = await updateWhitelistedDomainDomain(gate.actor, id, autoActivate, referenceDeps())
  if (result.ok) {
    await safeAudit(gate.actor, {
      action: 'domain.whitelist_toggle',
      targetId: id,
      detail: { autoActivate },
    })
  }
  return result.ok ? {} : { error: result.error.message }
}

export async function deleteWhitelistedDomain(id: string): Promise<ActionResult> {
  const gate = await requireSuperAdmin()
  if ('error' in gate) return { error: 'Super-admin access required.' }

  const result = await deleteWhitelistedDomainDomain(gate.actor, id, referenceDeps())
  if (result.ok) {
    await safeAudit(gate.actor, {
      action: 'domain.whitelist_delete',
      targetId: id,
    })
  }
  return result.ok ? {} : { error: result.error.message }
}

// --- titles management (super-admin for add/delete/reclassify) ---

export async function addTitle(name: string, hierarchyRole: HierarchyRole = 'user'): Promise<ActionResult> {
  const gate = await requireSuperAdmin()
  if ('error' in gate) return { error: 'Super-admin access required.' }

  const result = await addTitleDomain(gate.actor, name, hierarchyRole, referenceDeps())
  if (!result.ok) return { error: result.error.message }

  await safeAudit(gate.actor, {
    action: 'title.add',
    detail: { title: name.trim(), hierarchyRole },
  })
  return {}
}

export async function getTitleImpact(
  name: string,
  proposedRole?: HierarchyRole
): Promise<{
  title: string
  currentHierarchyRole: HierarchyRole
  proposedHierarchyRole: HierarchyRole
  affectedCount: number
  syncRequired: boolean
  error?: string
}> {
  const gate = await requireSuperAdmin()
  if ('error' in gate) {
    return {
      title: name,
      currentHierarchyRole: 'user',
      proposedHierarchyRole: proposedRole || 'user',
      affectedCount: 0,
      syncRequired: false,
      error: 'Super-admin access required.',
    }
  }

  const clean = name.trim()
  if (!clean) {
    return {
      title: name,
      currentHierarchyRole: 'user',
      proposedHierarchyRole: proposedRole || 'user',
      affectedCount: 0,
      syncRequired: false,
      error: 'Title name is required.',
    }
  }

  const result = await getTitleImpactDomain(gate.actor, clean, proposedRole, referenceDeps())
  if (!result.ok) {
    return {
      title: clean,
      currentHierarchyRole: 'user',
      proposedHierarchyRole: proposedRole || 'user',
      affectedCount: 0,
      syncRequired: false,
      error: result.error.message,
    }
  }
  return result.data
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

  const result = await reclassifyTitleDomain(gate.actor, clean, hierarchyRole, syncUsers, referenceDeps())
  if (!result.ok) return { error: result.error.message }

  await safeAudit(gate.actor, {
    action: 'title.reclassify',
    detail: { title: clean, hierarchyRole, syncUsers, affectedCount: result.data.affectedCount },
  })
  return { affectedCount: result.data.affectedCount }
}

export async function deleteTitle(name: string): Promise<ActionResult> {
  const gate = await requireSuperAdmin()
  if ('error' in gate) return { error: 'Super-admin access required.' }

  const clean = name.trim()
  if (!clean) return { error: 'Title name is required.' }

  const result = await deleteTitleDomain(gate.actor, clean, referenceDeps())
  if (!result.ok) return { error: result.error.message }

  await safeAudit(gate.actor, {
    action: 'title.delete',
    detail: { title: clean },
  })
  return {}
}
