// app/actions/admin-actions.ts
'use server'

import { isNonEmpty, type BackfillSettings } from '@/lib/validation'
import { ADMIN_TILE_IDS, TILE_IDS } from '@/app/constants'
import { repo } from '@/lib/db'
import { getActor } from '@/lib/auth'
import { logger } from '@/lib/logger'
import type { AdminDashboardLayout, DashboardLayout } from '@/app/types'
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

