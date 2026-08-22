// app/actions/admin-actions.ts
'use server'

import { isNonEmpty, isOneOf, type BackfillSettings } from '@/lib/validation'
import { ADMIN_TILE_IDS, ROLES, TILE_IDS, roleForTitle } from '@/app/constants'
import { repo } from '@/lib/db'
import { getActor } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { wouldCreateHierarchyCycle } from '@/lib/hierarchy'
import type { AdminDashboardLayout, DashboardLayout, UserRole, WhitelistedDomain } from '@/app/types'
import { ActionResult, isSuperAdmin, requireActor } from './_helpers'

// --- activity types ---

export async function addActivityType(name: string): Promise<ActionResult> {
  const gate = await requireActor(['admin'])
  if ('error' in gate) return { error: gate.error }
  if (!isNonEmpty(name)) return { error: 'Activity type name is required.' }

  const result = await repo.createActivityType(gate.actor, name.trim())
  return result.error ? { error: result.error } : {}
}

export async function renameActivityType(id: string, name: string): Promise<ActionResult> {
  const gate = await requireActor(['admin'])
  if ('error' in gate) return { error: gate.error }
  if (!isNonEmpty(name)) return { error: 'Activity type name is required.' }

  const result = await repo.renameActivityType(gate.actor, id, name.trim())
  return result.error ? { error: result.error } : {}
}

export async function setActivityTypeActive(id: string, isActive: boolean): Promise<ActionResult> {
  const gate = await requireActor(['admin'])
  if ('error' in gate) return { error: gate.error }

  const result = await repo.setActivityTypeActive(gate.actor, id, isActive)
  return result.error ? { error: result.error } : {}
}

/** Admin: set (or clear) the Telegram bot number for an activity type. */
export async function setActivityTypeTelegramNo(
  id: string,
  telegramNo: number | null
): Promise<ActionResult> {
  const gate = await requireActor(['admin'])
  if ('error' in gate) return { error: gate.error }
  if (telegramNo !== null && (!Number.isInteger(telegramNo) || telegramNo <= 0)) {
    return { error: 'Bot number must be a positive whole number.' }
  }

  const result = await repo.setActivityTypeTelegramNo(gate.actor, id, telegramNo)
  return result.error ? { error: result.error } : {}
}

// --- global reminders ---

export async function addGlobalReminder(input: {
  message: string
  remindAt: string
}): Promise<ActionResult> {
  const gate = await requireActor(['admin'])
  if ('error' in gate) return { error: gate.error }
  if (!isNonEmpty(input.message) || !isNonEmpty(input.remindAt)) {
    return { error: 'Message and time are required.' }
  }
  const remindAt = new Date(input.remindAt)
  if (Number.isNaN(remindAt.getTime())) {
    return { error: 'Invalid reminder time.' }
  }

  const result = await repo.createGlobalReminder(gate.actor, {
    message: input.message.trim(),
    remindAt: remindAt.toISOString(),
  })
  return result.error ? { error: result.error } : {}
}

export async function deleteGlobalReminder(id: string): Promise<ActionResult> {
  const gate = await requireActor(['admin'])
  if ('error' in gate) return { error: gate.error }

  const result = await repo.deleteGlobalReminder(gate.actor, id)
  return result.error ? { error: result.error } : {}
}

export async function dismissGlobalReminder(reminderId: string): Promise<ActionResult> {
  const actor = await getActor()
  if (!actor) return { error: 'You must be signed in.' }

  const result = await repo.dismissGlobalReminder(actor, reminderId)
  return result.error ? { error: result.error } : {}
}

/**
 * Set the app-wide backfill window. Admin only.
 */
export async function setBackfillWindow(settings: BackfillSettings): Promise<ActionResult> {
  const gate = await requireActor(['admin'])
  if ('error' in gate) return { error: gate.error }

  if (settings.mode !== 'days' && settings.mode !== 'month_start') {
    return { error: 'Invalid backfill mode.' }
  }
  if (!Number.isInteger(settings.windowDays) || settings.windowDays < 0 || settings.windowDays > 365) {
    return { error: 'Days window must be a whole number between 0 and 365.' }
  }
  if (!Number.isInteger(settings.extraDays) || settings.extraDays < 0 || settings.extraDays > 365) {
    return { error: 'Extra days must be a whole number between 0 and 365.' }
  }

  const result = await repo.setBackfillWindow(gate.actor, settings)
  if (!result.error) {
    const audit = await repo.writeAuditLog(gate.actor, {
      action: 'settings.backfill_change',
      detail: { mode: settings.mode, windowDays: settings.windowDays, extraDays: settings.extraDays },
    })
    if (audit.error) {
      logger.warn('audit log failed', { action: 'settings.backfill_change', error: audit.error })
    }
  }
  return result.error ? { error: result.error } : {}
}

// --- dashboard layout (own profile) ---

/** Save the current user's dashboard tile order/visibility. */
export async function saveDashboardLayout(layout: DashboardLayout): Promise<ActionResult> {
  const actor = await getActor()
  if (!actor) return { error: 'You must be signed in.' }
  if (!actor.isActive) return { error: 'Your account is not active.' }

  const tiles = layout?.tiles
  const known = new Set<string>(TILE_IDS)
  const seen = new Set<string>()
  const valid =
    Array.isArray(tiles) &&
    tiles.length === known.size &&
    tiles.every(t => !!t && known.has(t.id) && !seen.has(t.id) && typeof t.enabled === 'boolean' && (seen.add(t.id), true))
  if (!valid) return { error: 'Invalid layout.' }

  const result = await repo.setDashboardLayout(actor, layout)
  return result.error ? { error: result.error } : {}
}

/** Save the current user's admin-panel tile order/visibility. */
export async function saveAdminLayout(layout: AdminDashboardLayout): Promise<ActionResult> {
  const actor = await getActor()
  if (!actor) return { error: 'You must be signed in.' }
  if (!actor.isActive) return { error: 'Your account is not active.' }

  // The Super Admin tile is reserved for the configured super-admin: strip it
  // from the payload for everyone else so it never reaches the database.
  const allowed = isSuperAdmin(actor)
    ? ADMIN_TILE_IDS
    : ADMIN_TILE_IDS.filter(id => id !== 'super-admin')
  const tiles = (layout?.tiles ?? []).filter(
    t => !!t && (allowed as string[]).includes(t.id)
  )
  const known = new Set<string>(allowed)
  const seen = new Set<string>()
  const valid =
    Array.isArray(tiles) &&
    tiles.length === known.size &&
    tiles.every(t => !!t && known.has(t.id) && !seen.has(t.id) && typeof t.enabled === 'boolean' && (seen.add(t.id), true))
  if (!valid) return { error: 'Invalid layout.' }

  const result = await repo.setAdminLayout(actor, { tiles })
  return result.error ? { error: result.error } : {}
}

// --- super-admin / admin data lifecycle ---

/** Whether the signed-in user is the configured super-admin. */
export async function amISuperAdmin(): Promise<{ isSuperAdmin: boolean }> {
  return { isSuperAdmin: isSuperAdmin(await getActor()) }
}

/** Super-admin: wipe data. mode = timesheets | activity | all. */
export async function resetDatabase(mode: string): Promise<ActionResult> {
  const actor = await getActor()
  if (!actor) return { error: 'You must be signed in.' }
  if (!isSuperAdmin(actor)) return { error: 'You do not have permission to perform this action.' }

  let result: { error: string | null }
  if (mode === 'timesheets') result = await repo.resetTimesheets(actor)
  else if (mode === 'activity') result = await repo.resetActivityData(actor)
  else if (mode === 'all') result = await repo.resetAllData(actor)
  else return { error: 'Invalid reset mode.' }

  if (!result.error) {
    const audit = await repo.writeAuditLog(actor, {
      action: 'database.reset',
      detail: { mode },
    })
    if (audit.error) {
      logger.warn('audit log failed', { action: 'database.reset', error: audit.error })
    }
  }

  return result.error ? { error: result.error } : {}
}

/** Super-admin: permanently delete a user (profile, entries, auth identity). */
export async function deleteUser(userId: string): Promise<ActionResult> {
  const actor = await getActor()
  if (!actor) return { error: 'You must be signed in.' }
  if (!isSuperAdmin(actor)) return { error: 'You do not have permission to perform this action.' }
  if (userId === actor.id) return { error: 'You cannot delete your own account.' }

  const result = await repo.deleteUser(actor, userId)
  if (!result.error) {
    const audit = await repo.writeAuditLog(actor, {
      action: 'user.delete',
      targetId: userId,
    })
    if (audit.error) {
      logger.warn('audit log failed', { action: 'user.delete', error: audit.error })
    }
  }
  return result.error ? { error: result.error } : {}
}

/** Super-admin: permanently delete an activity type. */
export async function deleteActivityType(id: string): Promise<ActionResult> {
  const actor = await getActor()
  if (!actor) return { error: 'You must be signed in.' }
  if (!isSuperAdmin(actor)) return { error: 'You do not have permission to perform this action.' }

  const result = await repo.deleteActivityType(actor, id)
  if (!result.error) {
    const audit = await repo.writeAuditLog(actor, {
      action: 'activity_type.delete',
      targetId: id,
    })
    if (audit.error) {
      logger.warn('audit log failed', { action: 'activity_type.delete', error: audit.error })
    }
  }
  return result.error ? { error: result.error } : {}
}

/** Admin: delete all timesheet entries belonging to a user (deactivate flow). */
export async function deleteUserTimesheets(userId: string): Promise<ActionResult> {
  const gate = await requireActor(['admin'])
  if ('error' in gate) return { error: gate.error }

  const result = await repo.deleteUserTimesheets(gate.actor, userId)
  if (!result.error) {
    const audit = await repo.writeAuditLog(gate.actor, {
      action: 'timesheets.delete_user',
      targetId: userId,
    })
    if (audit.error) {
      logger.warn('audit log failed', { action: 'timesheets.delete_user', error: audit.error })
    }
  }
  return result.error ? { error: result.error } : {}
}

// --- email domain whitelist (super-admin only) ---

export async function getWhitelistedDomains(): Promise<{ domains: WhitelistedDomain[]; error?: string }> {
  const actor = await getActor()
  if (!actor) return { domains: [], error: 'You must be signed in.' }
  if (!isSuperAdmin(actor)) return { domains: [], error: 'Super-admin access required.' }

  try {
    const domains = await repo.listWhitelistedDomains(actor)
    return { domains }
  } catch (err) {
    return { domains: [], error: err instanceof Error ? err.message : 'Failed to fetch domains.' }
  }
}

export async function addWhitelistedDomain(domain: string, autoActivate: boolean): Promise<ActionResult> {
  const actor = await getActor()
  if (!actor) return { error: 'You must be signed in.' }
  if (!isSuperAdmin(actor)) return { error: 'Super-admin access required.' }

  const clean = domain.trim().toLowerCase().replace(/^@/, '')
  if (!clean || !clean.includes('.')) {
    return { error: 'Please enter a valid domain (e.g. company.com).' }
  }

  const result = await repo.addWhitelistedDomain(actor, clean, autoActivate)
  if (!result.error) {
    await repo.writeAuditLog(actor, {
      action: 'domain.whitelist_add',
      detail: { domain: clean, autoActivate },
    })
  }
  return result.error ? { error: result.error } : {}
}

export async function toggleDomainAutoActivate(id: string, autoActivate: boolean): Promise<ActionResult> {
  const actor = await getActor()
  if (!actor) return { error: 'You must be signed in.' }
  if (!isSuperAdmin(actor)) return { error: 'Super-admin access required.' }

  const result = await repo.updateWhitelistedDomain(actor, id, autoActivate)
  if (!result.error) {
    await repo.writeAuditLog(actor, {
      action: 'domain.whitelist_toggle',
      targetId: id,
      detail: { autoActivate },
    })
  }
  return result.error ? { error: result.error } : {}
}

export async function deleteWhitelistedDomain(id: string): Promise<ActionResult> {
  const actor = await getActor()
  if (!actor) return { error: 'You must be signed in.' }
  if (!isSuperAdmin(actor)) return { error: 'Super-admin access required.' }

  const result = await repo.deleteWhitelistedDomain(actor, id)
  if (!result.error) {
    await repo.writeAuditLog(actor, {
      action: 'domain.whitelist_delete',
      targetId: id,
    })
  }
  return result.error ? { error: result.error } : {}
}

// --- hierarchy & reporting structure (admin) ---

export async function updateUserHierarchy(
  userId: string,
  data: { managerId: string | null; title?: string; role?: UserRole }
): Promise<ActionResult> {
  const gate = await requireActor(['admin'])
  if ('error' in gate) return { error: gate.error }

  if (!userId) return { error: 'User ID is required.' }
  if (data.role !== undefined && !isOneOf(data.role, ROLES)) {
    return { error: 'Invalid role.' }
  }

  const targetUser = await repo.getProfileById(userId)
  if (!targetUser) return { error: 'User not found.' }

  // Determine role: if title is updated and role is not explicitly provided,
  // auto-sync role from the title (preserving admin/pm/co).
  let targetRole = data.role
  if (data.title && !targetRole) {
    targetRole = roleForTitle(data.title, targetUser.role)
  }

  // Reject a contradictory title+role save (e.g. title "Manager" with role
  // "user"). roleForTitle preserves admin/pm/co, so those overrides pass.
  // Applies to the new title (if sent) and to the persisted title when a
  // role-only edit would contradict it.
  const effectiveTitle = data.title !== undefined ? data.title : targetUser.title
  if (
    data.role !== undefined &&
    effectiveTitle &&
    roleForTitle(effectiveTitle, data.role) !== data.role
  ) {
    return {
      error: `Role "${data.role}" is inconsistent with the title "${effectiveTitle}". Set the title to "Manager" or "Team Lead" to grant a leadership role (or use an admin/pm/co role).`,
    }
  }

  const selfEdit = userId === gate.actor.id
  if (selfEdit) {
    if (targetRole && targetRole !== targetUser.role) {
      return { error: 'You cannot change your own role.' }
    }
    if (data.managerId !== undefined && data.managerId !== targetUser.manager_id) {
      return { error: 'You cannot change your own reporting line.' }
    }
  }

  // Check for circular hierarchy loop
  if (data.managerId) {
    const allUsers = await repo.listProfiles(gate.actor)
    if (wouldCreateHierarchyCycle(allUsers, userId, data.managerId)) {
      return { error: 'Invalid reporting line: assigning this manager creates a circular reporting loop.' }
    }
  }

  const result = await repo.updateUserHierarchy(gate.actor, userId, {
    managerId: data.managerId,
    title: data.title,
    role: targetRole,
  })

  if (!result.error) {
    await repo.writeAuditLog(gate.actor, {
      action: 'user.hierarchy_update',
      targetId: userId,
      detail: { managerId: data.managerId, title: data.title, role: targetRole },
    })
  }

  return result.error ? { error: result.error } : {}
}

// --- titles management (super-admin for add/remove, any user for get) ---

export async function getTitles(): Promise<{ titles: string[]; error?: string }> {
  try {
    const titles = await repo.listTitles()
    return { titles }
  } catch (err) {
    return { titles: [], error: err instanceof Error ? err.message : 'Failed to fetch titles.' }
  }
}

export async function addTitle(name: string): Promise<ActionResult> {
  const actor = await getActor()
  if (!actor) return { error: 'You must be signed in.' }
  if (!isSuperAdmin(actor)) return { error: 'Super-admin access required.' }

  const clean = name.trim()
  if (!clean) return { error: 'Title name is required.' }

  const result = await repo.addTitle(actor, clean)
  if (!result.error) {
    await repo.writeAuditLog(actor, {
      action: 'title.add',
      detail: { title: clean },
    })
  }
  return result.error ? { error: result.error } : {}
}

export async function deleteTitle(name: string): Promise<ActionResult> {
  const actor = await getActor()
  if (!actor) return { error: 'You must be signed in.' }
  if (!isSuperAdmin(actor)) return { error: 'Super-admin access required.' }

  const clean = name.trim()
  if (!clean) return { error: 'Title name is required.' }

  const result = await repo.deleteTitle(actor, clean)
  if (!result.error) {
    await repo.writeAuditLog(actor, {
      action: 'title.delete',
      detail: { title: clean },
    })
  }
  return result.error ? { error: result.error } : {}
}



