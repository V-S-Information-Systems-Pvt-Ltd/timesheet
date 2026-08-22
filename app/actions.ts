// app/actions.ts
'use server'

import { addDaysISO, todayISO } from '@/lib/dates'
import {
  isNonEmpty,
  isOneOf,
  isValidEmail,
  isWithinBackfillWindow,
  isValidISODate,
  sanitizeWorkDone,
  type BackfillSettings,
} from '@/lib/validation'
import { parseSchema, logEntrySchema, logYesterdaySchema } from '@/lib/validation-schemas'
import { RATE_LIMIT_DAILY, RATE_LIMIT_IMPORT, peekRateLimit, consumeRateLimit, dailyWriteStore, dailyImportStore, getRetryAfter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { ADMIN_TILE_IDS, TILE_IDS, roleForTitle } from '@/app/constants'
import { parseBackup } from '@/lib/backup'
import { repo } from '@/lib/db'
import { getActor } from '@/lib/auth'
import { requireRole, type Actor, type TimesheetInput } from '@/lib/db/repository'
import { HIERARCHY_ROLES, isAdminActor, PERMISSION_ROLES } from '@/lib/roles'
import { wouldCreateHierarchyCycle } from '@/lib/hierarchy'
import type { AdminDashboardLayout, BackupCreatedCounts, BackupPayload, DashboardLayout, HierarchyRole, PermissionRole, User, WhitelistedDomain } from './types'

type ActionResult = { error?: string; fieldErrors?: Record<string, string[]> }

/**
 * Peek the per-user daily write budget WITHOUT consuming. Rejects early when
 * the budget is already exhausted, so a user over the limit never starts a
 * write. The budget itself is charged (see `consumeWriteRateLimit`) only after
 * a write actually succeeds — failed/aborted writes don't burn it.
 */
function peekWriteRateLimit(actor: Actor): { ok: true } | { ok: false; error: string } {
  const result = peekRateLimit(dailyWriteStore, `writes:${actor.id}`, RATE_LIMIT_DAILY)
  if (!result.ok) {
    const retry = getRetryAfter(result.resetAt)
    logger.warn('rate limit: write exceeded', { userId: actor.id, retryAfter: retry })
    return { ok: false, error: `Rate limit exceeded. Try again in ${retry}s.` }
  }
  return { ok: true }
}

/** Charge one unit of the per-user daily write budget (call on success). */
function consumeWriteRateLimit(actor: Actor): void {
  consumeRateLimit(dailyWriteStore, `writes:${actor.id}`, RATE_LIMIT_DAILY)
}

/** Resolve the actor and enforce that their role is allowed. */
async function requireActor(
  allowed: PermissionRole[]
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
function isSuperAdmin(actor: Actor | null): boolean {
  const email = process.env.SUPER_ADMIN_EMAIL?.trim().toLowerCase()
  return !!actor && !!email && isAdminActor(actor) && actor.email.toLowerCase() === email
}

export async function logEntry(input: {
  projectId: string
  activityTypeId: string
  hoursWorked: number
  workDone: string
  logDate: string
}): Promise<ActionResult> {
  const actor = await getActor()
  if (!actor) return { error: 'You must be signed in.' }
  if (!actor.isActive) return { error: 'Your account is not active.' }

  const rate = peekWriteRateLimit(actor)
  if (!rate.ok) return { error: rate.error }

  const parsed = parseSchema(logEntrySchema, input)
  if (!parsed.ok) return { error: parsed.error.error, fieldErrors: parsed.error.fieldErrors }

  // Backfill window: one writable entry per day, only for recent dates.
  const today = todayISO()
  const settings = await repo.getBackfillWindow(actor)
  if (!isWithinBackfillWindow(parsed.data.logDate, today, settings)) {
    return { error: 'This date is outside the writable backfill window.' }
  }

  // Multiple entries per day are allowed, but the day's total hours must
  // stay at or under 24 (enforced here and on edit/import).
  const total = await repo.sumHoursForUserDate(actor, actor.id, parsed.data.logDate)
  if (total + parsed.data.hoursWorked > 24) {
    return {
      error: `Daily total would exceed 24 hours (${total}h already logged on ${parsed.data.logDate}).`,
    }
  }

  const result = await repo.createTimesheet(actor, {
    userId: actor.id,
    projectId: parsed.data.projectId,
    activityTypeId: parsed.data.activityTypeId,
    hoursWorked: parsed.data.hoursWorked,
    workDone: sanitizeWorkDone(parsed.data.workDone),
    logDate: parsed.data.logDate,
  })

  if (!result.error) consumeWriteRateLimit(actor)
  return result.error ? { error: result.error } : {}
}

/** Duplicate an existing entry: copy its project/activity/date/hours/description
 * as a new row for the same user. Same rules as logging: non-admins must be
 * inside the backfill window and the day's total must stay at or under 24h. */
export async function duplicateEntry(entryId: string): Promise<ActionResult> {
  const actor = await getActor()
  if (!actor) return { error: 'You must be signed in.' }
  if (!actor.isActive) return { error: 'Your account is not active.' }

  const rate = peekWriteRateLimit(actor)
  if (!rate.ok) return { error: rate.error }

  const target = await repo.getTimesheet(actor, entryId)
  if (!target) return { error: 'Entry not found.' }
  const canDuplicateOthers = isAdminActor(actor)
  if (target.user_id !== actor.id && !canDuplicateOthers) {
    return { error: 'You can only duplicate your own entries.' }
  }

  // The backfill window applies to regular users; admins may duplicate any entry.
  if (!canDuplicateOthers) {
    const settings = await repo.getBackfillWindow(actor)
    if (!isWithinBackfillWindow(target.log_date, todayISO(), settings)) {
      return { error: 'This date is outside the writable backfill window.' }
    }
  }

  const total = await repo.sumHoursForUserDate(actor, target.user_id, target.log_date)
  if (total + Number(target.hours_worked) > 24) {
    return {
      error: `Daily total would exceed 24 hours (${total}h already logged on ${target.log_date}).`,
    }
  }

  const result = await repo.createTimesheet(actor, {
    userId: target.user_id,
    projectId: target.project_id,
    activityTypeId: target.activity_type_id,
    hoursWorked: Number(target.hours_worked),
    workDone: target.work_done,
    logDate: target.log_date,
  })
  if (!result.error) consumeWriteRateLimit(actor)
  return result.error ? { error: result.error } : {}
}

export async function addProject(name: string): Promise<ActionResult> {
  const gate = await requireActor(['admin', 'pm'])
  if ('error' in gate) return { error: gate.error }
  if (!isNonEmpty(name)) return { error: 'Project name is required.' }

  const result = await repo.createProject(gate.actor, name.trim())
  return result.error ? { error: result.error } : {}
}

export async function renameProject(projectId: string, name: string): Promise<ActionResult> {
  const gate = await requireActor(['admin', 'pm'])
  if ('error' in gate) return { error: gate.error }
  if (!isNonEmpty(name)) return { error: 'Project name is required.' }

  const result = await repo.renameProject(gate.actor, projectId, name.trim())
  return result.error ? { error: result.error } : {}
}

export async function setProjectSO(projectId: string, soNumber: string): Promise<ActionResult> {
  const gate = await requireActor(['admin', 'pm'])
  if ('error' in gate) return { error: gate.error }

  const result = await repo.setProjectSO(gate.actor, projectId, soNumber.trim() || null)
  return result.error ? { error: result.error } : {}
}

/** Admin/pm: set (or clear) the Telegram bot number for a project. */
export async function setProjectTelegramNo(
  projectId: string,
  telegramNo: number | null
): Promise<ActionResult> {
  const gate = await requireActor(['admin', 'pm'])
  if ('error' in gate) return { error: gate.error }
  if (telegramNo !== null && (!Number.isInteger(telegramNo) || telegramNo <= 0)) {
    return { error: 'Bot number must be a positive whole number.' }
  }

  const result = await repo.setProjectTelegramNo(gate.actor, projectId, telegramNo)
  return result.error ? { error: result.error } : {}
}

export async function deleteProject(projectId: string): Promise<ActionResult> {
  const gate = await requireActor(['admin', 'pm'])
  if ('error' in gate) return { error: gate.error }

  const result = await repo.deleteProject(gate.actor, projectId)
  return result.error ? { error: result.error } : {}
}

export async function logYesterday(input: {
  projectId: string
  activityTypeId: string
  hoursWorked: number
  workDone: string
  userId?: string
}): Promise<ActionResult> {
  const actor = await getActor()
  if (!actor) return { error: 'You must be signed in.' }
  if (!actor.isActive) return { error: 'Your account is not active.' }

  const rate = peekWriteRateLimit(actor)
  if (!rate.ok) return { error: rate.error }

  let targetUserId = actor.id
  if (input.userId && input.userId !== actor.id) {
    if (!isAdminActor(actor)) {
      return { error: 'Only admins can backfill for other users.' }
    }
    targetUserId = input.userId
  }

  const parsed = parseSchema(logYesterdaySchema, input)
  if (!parsed.ok) return { error: parsed.error.error, fieldErrors: parsed.error.fieldErrors }

  const today = todayISO()
  const yesterdayStr = addDaysISO(today, -1)

  // Window check: admins backfilling for other users are exempt; everyone
  // else must be inside the configured window for yesterday to be writable.
  const isAdminBackfill = !!input.userId && input.userId !== actor.id
  if (!isAdminBackfill) {
    const settings = await repo.getBackfillWindow(actor)
    if (!isWithinBackfillWindow(yesterdayStr, today, settings)) {
      return { error: 'Yesterday is outside the writable backfill window.' }
    }
  }

  // Multiple entries per day are allowed; the day's total must stay ≤ 24h.
  const total = await repo.sumHoursForUserDate(actor, targetUserId, yesterdayStr)
  if (total + parsed.data.hoursWorked > 24) {
    return {
      error: `Daily total would exceed 24 hours (${total}h already logged for yesterday).`,
    }
  }

  const result = await repo.createTimesheet(actor, {
    userId: targetUserId,
    projectId: parsed.data.projectId,
    activityTypeId: parsed.data.activityTypeId,
    hoursWorked: parsed.data.hoursWorked,
    workDone: sanitizeWorkDone(parsed.data.workDone),
    logDate: yesterdayStr,
  })

  if (!result.error) consumeWriteRateLimit(actor)
  return result.error ? { error: result.error } : {}
}

export async function deleteLastEntry(): Promise<ActionResult> {
  const actor = await getActor()
  if (!actor) return { error: 'You must be signed in.' }
  if (!actor.isActive) return { error: 'Your account is not active.' }

  const rate = peekWriteRateLimit(actor)
  if (!rate.ok) return { error: rate.error }

  const latest = await repo.getLatestTimesheet(actor, actor.id)
  if (!latest) return { error: 'No entries to undo.' }

  const result = await repo.deleteTimesheet(actor, latest.id)
  if (!result.error) consumeWriteRateLimit(actor)
  return result.error ? { error: result.error } : {}
}

export async function updateTimesheet(
  entryId: string,
  input: {
    projectId: string
    activityTypeId: string
    hoursWorked: number
    workDone: string
    logDate: string
  }
): Promise<ActionResult> {
  const actor = await getActor()
  if (!actor) return { error: 'You must be signed in.' }
  if (!actor.isActive) return { error: 'Your account is not active.' }

  const rate = peekWriteRateLimit(actor)
  if (!rate.ok) return { error: rate.error }

  const parsed = parseSchema(logEntrySchema, input)
  if (!parsed.ok) return { error: parsed.error.error, fieldErrors: parsed.error.fieldErrors }

  const target = await repo.getTimesheet(actor, entryId)
  if (!target) return { error: 'Entry not found.' }
  const canEditOthers = isAdminActor(actor)
  if (target.user_id !== actor.id && !canEditOthers) {
    return { error: 'You can only modify your own entries.' }
  }

  // The backfill window applies to regular users; admins may edit any entry.
  if (!canEditOthers) {
    const settings = await repo.getBackfillWindow(actor)
    if (!isWithinBackfillWindow(parsed.data.logDate, todayISO(), settings)) {
      return { error: 'This date is outside the writable backfill window.' }
    }
  }

  // Moving an entry onto another date is allowed, but the target day's total
  // (excluding this entry) must stay at or under 24 hours.
  const others = await repo.sumHoursForUserDate(actor, target.user_id, parsed.data.logDate, entryId)
  if (others + parsed.data.hoursWorked > 24) {
    return {
      error: `Daily total would exceed 24 hours (${others}h already logged on ${parsed.data.logDate}).`,
    }
  }

  const result = await repo.updateTimesheet(actor, entryId, {
    userId: target.user_id,
    projectId: parsed.data.projectId,
    activityTypeId: parsed.data.activityTypeId,
    hoursWorked: parsed.data.hoursWorked,
    workDone: sanitizeWorkDone(parsed.data.workDone),
    logDate: parsed.data.logDate,
  })

  if (!result.error) consumeWriteRateLimit(actor)
  return result.error ? { error: result.error } : {}
}

export async function deleteTimesheet(entryId: string): Promise<ActionResult> {
  const actor = await getActor()
  if (!actor) return { error: 'You must be signed in.' }
  if (!actor.isActive) return { error: 'Your account is not active.' }

  const rate = peekWriteRateLimit(actor)
  if (!rate.ok) return { error: rate.error }

  const target = await repo.getTimesheet(actor, entryId)
  if (!target) return { error: 'Entry not found.' }
  if (target.user_id !== actor.id && !isAdminActor(actor)) {
    return { error: 'You can only delete your own entries.' }
  }

  const result = await repo.deleteTimesheet(actor, entryId)
  if (!result.error) consumeWriteRateLimit(actor)
  return result.error ? { error: result.error } : {}
}

/**
 * Bulk-edit a batch of timesheet entries (project / activity type change).
 * Validates and applies every row with the same rules as `updateTimesheet`,
 * but charges the per-user write budget ONCE for the whole batch (so a large
 * bulk edit cannot exhaust the daily write budget) and reports per-row errors
 * so the UI can tell the user which rows failed.
 */
export async function bulkUpdateTimesheets(
  entries: Array<{
    id: string
    projectId: string
    activityTypeId: string
    hoursWorked: number
    workDone: string
    logDate: string
  }>
): Promise<ActionResult & { updated?: number; errors?: string[] }> {
  const actor = await getActor()
  if (!actor) return { error: 'You must be signed in.' }
  if (!actor.isActive) return { error: 'Your account is not active.' }

  if (!Array.isArray(entries) || entries.length === 0) return { error: 'No entries selected.' }
  if (entries.length > 500) return { error: 'Too many entries for one edit (max 500).' }

  const rate = peekWriteRateLimit(actor)
  if (!rate.ok) return { error: rate.error }

  const errors: string[] = []
  let updated = 0

  for (const entry of entries) {
    const parsed = parseSchema(logEntrySchema, {
      projectId: entry.projectId,
      activityTypeId: entry.activityTypeId,
      hoursWorked: entry.hoursWorked,
      workDone: entry.workDone,
      logDate: entry.logDate,
    })
    if (!parsed.ok) {
      errors.push(`Entry ${entry.id}: ${parsed.error.error}`)
      continue
    }

    const target = await repo.getTimesheet(actor, entry.id)
    if (!target) {
      errors.push(`Entry ${entry.id}: not found`)
      continue
    }
    const canEditOthers = isAdminActor(actor)
    if (target.user_id !== actor.id && !canEditOthers) {
      errors.push(`Entry ${entry.id}: you can only modify your own entries`)
      continue
    }

    if (!canEditOthers) {
      const settings = await repo.getBackfillWindow(actor)
      if (!isWithinBackfillWindow(parsed.data.logDate, todayISO(), settings)) {
        errors.push(`Entry ${entry.id}: outside the writable backfill window`)
        continue
      }
    }

    const others = await repo.sumHoursForUserDate(actor, target.user_id, parsed.data.logDate, entry.id)
    if (others + parsed.data.hoursWorked > 24) {
      errors.push(`Entry ${entry.id}: daily total would exceed 24 hours`)
      continue
    }

    const result = await repo.updateTimesheet(actor, entry.id, {
      userId: target.user_id,
      projectId: parsed.data.projectId,
      activityTypeId: parsed.data.activityTypeId,
      hoursWorked: parsed.data.hoursWorked,
      workDone: sanitizeWorkDone(parsed.data.workDone),
      logDate: parsed.data.logDate,
    })
    if (result.error) {
      errors.push(`Entry ${entry.id}: ${result.error}`)
    } else {
      updated++
    }
  }

  if (updated > 0) consumeWriteRateLimit(actor)
  return {
    error: errors.length > 0 && updated === 0 ? 'No entries could be updated.' : undefined,
    updated,
    errors,
  }
}

export async function addUser(input: {
  email: string
  password: string
  name: string
  department: string
  title: string
  permissionRole: PermissionRole
  hierarchyRole: HierarchyRole
  isActive: boolean
  /** Optional manager/team lead this user reports to. */
  managerId?: string | null
}): Promise<ActionResult> {
  const gate = await requireActor(['admin'])
  if ('error' in gate) return { error: gate.error }

  if (!isOneOf(input.permissionRole, PERMISSION_ROLES)) {
    return { error: 'Invalid permission role.' }
  }
  if (!isOneOf(input.hierarchyRole, HIERARCHY_ROLES)) {
    return { error: 'Invalid hierarchy role.' }
  }
  if (!isNonEmpty(input.email) || !isNonEmpty(input.password) || input.password.length < 6) {
    return { error: 'Email and a password of at least 6 characters are required.' }
  }
  if (!isValidEmail(input.email)) {
    return { error: 'Please enter a valid email address.' }
  }

  const email = input.email.trim().toLowerCase()
  const result = await repo.createUser(gate.actor, {
    email,
    password: input.password,
    name: input.name.trim(),
    department: input.department.trim(),
    title: input.title.trim(),
    permissionRole: input.permissionRole,
    hierarchyRole: input.hierarchyRole,
    isActive: input.isActive,
    managerId: input.managerId || null,
  })

  return result.error ? { error: result.error } : {}
}

export async function toggleUserStatus(userId: string): Promise<ActionResult> {
  const gate = await requireActor(['admin'])
  if ('error' in gate) return { error: gate.error }
  const actor = gate.actor

  const target = await repo.getProfileById(userId)
  if (!target) return { error: 'User not found.' }

  if (actor.id === userId && target.is_active) {
    return { error: 'You cannot deactivate your own account.' }
  }

  const result = await repo.updateUserStatus(actor, userId, !target.is_active)
  return result.error ? { error: result.error } : {}
}

export async function updateUserRoles(
  userId: string,
  permissionRole: PermissionRole,
  hierarchyRole: HierarchyRole
): Promise<ActionResult> {
  const gate = await requireActor(['admin'])
  if ('error' in gate) return { error: gate.error }
  const actor = gate.actor

  if (!isOneOf(permissionRole, PERMISSION_ROLES)) return { error: 'Invalid permission role.' }
  if (!isOneOf(hierarchyRole, HIERARCHY_ROLES)) return { error: 'Invalid hierarchy role.' }
  if (actor.id === userId) return { error: 'You cannot change your own roles.' }

  const result = await repo.updateUserRoles(actor, userId, permissionRole, hierarchyRole)
  return result.error ? { error: result.error } : {}
}

/** Admin-only: change a user's full name. */
export async function updateUserName(userId: string, name: string): Promise<ActionResult> {
  const gate = await requireActor(['admin'])
  if ('error' in gate) return { error: gate.error }
  if (!isNonEmpty(name)) return { error: 'Name is required.' }

  const result = await repo.updateUserName(gate.actor, userId, name.trim())
  return result.error ? { error: result.error } : {}
}

/**
 * Admin-only: set who a user reports to (manager or team lead).
 * Guards against self-assignment and reporting cycles.
 */
export async function setUserManager(
  userId: string,
  managerId: string | null
): Promise<ActionResult> {
  const gate = await requireActor(['admin'])
  if ('error' in gate) return { error: gate.error }
  const actor = gate.actor

  if (userId === actor.id) return { error: 'You cannot change your own reporting line.' }
  if (managerId === userId) return { error: 'A user cannot report to themselves.' }

  if (managerId) {
    // Cycle guard: walk the manager chain upward from the proposed manager; if
    // it ever reaches `userId`, assigning would create a loop.
    const users = await repo.listProfiles(actor)
    const byId = new Map(users.map(u => [u.id, u]))
    let current: User | undefined = byId.get(managerId)
    const seen = new Set<string>()
    while (current && current.manager_id && !seen.has(current.id)) {
      if (current.manager_id === userId) {
        return { error: 'That assignment would create a reporting cycle.' }
      }
      seen.add(current.id)
      current = byId.get(current.manager_id)
    }
  }

  const result = await repo.updateUserManager(actor, userId, managerId)
  return result.error ? { error: result.error } : {}
}

/** User edits their own department/title. */
export async function updateMyProfile(input: {
  department: string
  title: string
}): Promise<ActionResult> {
  const actor = await getActor()
  if (!actor) return { error: 'You must be signed in.' }

  const result = await repo.updateMyProfile(actor, {
    department: input.department.trim(),
    title: input.title.trim(),
  })
  return result.error ? { error: result.error } : {}
}

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

// --- global default panel order (super-admin) ---

/** Validate an ordered, deduped, complete tile list (length must equal the known set). */
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

/** Read the global default panel order (any signed-in user). */
export async function getDefaultLayouts(): Promise<
  { dashboard: DashboardLayout; admin: AdminDashboardLayout } | { error: string }
> {
  const actor = await getActor()
  if (!actor) return { error: 'You must be signed in.' }
  try {
    return await repo.getDefaultLayouts(actor)
  } catch {
    return { error: 'Could not load default panel layouts.' }
  }
}

/** Super-admin: persist the global default panel order. */
export async function setDefaultLayouts(
  dashboard: DashboardLayout,
  admin: AdminDashboardLayout
): Promise<ActionResult> {
  const actor = await getActor()
  if (!actor) return { error: 'You must be signed in.' }
  if (!isSuperAdmin(actor)) return { error: 'You do not have permission to perform this action.' }

  if (!layoutTilesValid(dashboard?.tiles, TILE_IDS)) return { error: 'Invalid dashboard layout.' }
  if (!layoutTilesValid(admin?.tiles, ADMIN_TILE_IDS)) return { error: 'Invalid admin layout.' }

  const result = await repo.setDefaultLayouts(actor, { dashboard, admin })
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
  return result.error ? { error: result.error } : {}
}

/** Super-admin: permanently delete a user (profile, entries, auth identity). */
export async function deleteUser(userId: string): Promise<ActionResult> {
  const actor = await getActor()
  if (!actor) return { error: 'You must be signed in.' }
  if (!isSuperAdmin(actor)) return { error: 'You do not have permission to perform this action.' }
  if (userId === actor.id) return { error: 'You cannot delete your own account.' }

  const result = await repo.deleteUser(actor, userId)
  return result.error ? { error: result.error } : {}
}

/** Super-admin: permanently delete an activity type. */
export async function deleteActivityType(id: string): Promise<ActionResult> {
  const actor = await getActor()
  if (!actor) return { error: 'You must be signed in.' }
  if (!isSuperAdmin(actor)) return { error: 'You do not have permission to perform this action.' }

  const result = await repo.deleteActivityType(actor, id)
  return result.error ? { error: result.error } : {}
}

/** Admin: delete all timesheet entries belonging to a user (deactivate flow). */
export async function deleteUserTimesheets(userId: string): Promise<ActionResult> {
  const gate = await requireActor(['admin'])
  if ('error' in gate) return { error: gate.error }

  const result = await repo.deleteUserTimesheets(gate.actor, userId)
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

// --- hierarchy & reporting structure (admin, hierarchy axis) ---

export async function updateUserHierarchy(
  userId: string,
  data: { managerId: string | null; title?: string; hierarchyRole?: HierarchyRole }
): Promise<ActionResult> {
  const gate = await requireActor(['admin'])
  if ('error' in gate) return { error: gate.error }

  if (!userId) return { error: 'User ID is required.' }
  if (data.hierarchyRole !== undefined && !isOneOf(data.hierarchyRole, HIERARCHY_ROLES)) {
    return { error: 'Invalid hierarchy role.' }
  }

  const targetUser = await repo.getProfileById(userId)
  if (!targetUser) return { error: 'User not found.' }

  // Determine the hierarchy role: if the title is updated and no hierarchy
  // role is explicitly provided, auto-sync it from the title. The permission
  // axis is never touched by this action.
  let targetHierarchyRole = data.hierarchyRole
  if (data.title && !targetHierarchyRole) {
    targetHierarchyRole = roleForTitle(data.title)
  }

  // Reject a contradictory title+hierarchy-role save (e.g. title "Manager"
  // with hierarchy role "user").
  const effectiveTitle = data.title !== undefined ? data.title : targetUser.title
  if (
    data.hierarchyRole !== undefined &&
    effectiveTitle &&
    roleForTitle(effectiveTitle) !== data.hierarchyRole
  ) {
    return {
      error: `Hierarchy role "${data.hierarchyRole}" is inconsistent with the title "${effectiveTitle}". Set the title to "Manager" or "Team Lead" to grant a leadership role.`,
    }
  }

  const selfEdit = userId === gate.actor.id
  if (selfEdit) {
    if (targetHierarchyRole && targetHierarchyRole !== targetUser.hierarchy_role) {
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
    hierarchyRole: targetHierarchyRole,
  })

  if (!result.error) {
    await repo.writeAuditLog(gate.actor, {
      action: 'user.hierarchy_update',
      targetId: userId,
      detail: { managerId: data.managerId, title: data.title, hierarchyRole: targetHierarchyRole },
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

/** Raw CSV row shape for the import (client sends parsed rows). */
export interface CsvTimesheetRow {
  email: string
  logDate: string
  project: string
  activityType: string
  hours: string
  workDone: string
}

/** Admin: import timesheet rows; unknown references and bad rows are reported. */
export async function importTimesheets(
  rows: CsvTimesheetRow[]
): Promise<ActionResult & { imported?: number; skipped?: number; errors?: string[] }> {
  const gate = await requireActor(['admin'])
  if ('error' in gate) return { error: gate.error }
  const actor = gate.actor

  const rate = peekRateLimit(dailyImportStore, `import:${actor.id}`, RATE_LIMIT_IMPORT)
  if (!rate.ok) {
    const retry = getRetryAfter(rate.resetAt)
    return { error: `Import rate limit exceeded. Try again in ${retry}s.` }
  }

  if (!Array.isArray(rows) || rows.length === 0) return { error: 'No rows to import.' }
  if (rows.length > 2000) return { error: 'Too many rows (max 2000).' }

  const [users, projects, types] = await Promise.all([
    repo.listProfiles(actor),
    repo.listProjects(actor),
    repo.listAllActivityTypes(actor),
  ])
  const userByEmail = new Map(users.map(u => [u.email.toLowerCase(), u]))
  const projectByName = new Map(projects.map(p => [p.name, p]))
  const typeByName = new Map(types.map(t => [t.name, t]))

  const out: TimesheetInput[] = []
  const errors: string[] = []
  rows.forEach((raw, i) => {
    const line = i + 2 // CSV line numbers start after the header row
    const r = (raw ?? {}) as CsvTimesheetRow
    const email = typeof r.email === 'string' ? r.email.trim().toLowerCase() : ''
    const user = userByEmail.get(email)
    if (!user) {
      errors.push(`Row ${line}: unknown email "${email || '(empty)'}"`)
      return
    }
    const projectName = typeof r.project === 'string' ? r.project.trim() : ''
    const project = projectByName.get(projectName)
    if (!project) {
      errors.push(`Row ${line}: unknown project "${projectName || '(empty)'}"`)
      return
    }
    let activityTypeId: string | null = null
    if (typeof r.activityType === 'string' && r.activityType.trim()) {
      const type = typeByName.get(r.activityType.trim())
      if (!type) {
        errors.push(`Row ${line}: unknown activity type "${r.activityType}"`)
        return
      }
      activityTypeId = type.id
    }
    const hours = Number(r.hours)
    if (!Number.isFinite(hours) || hours <= 0 || hours > 24) {
      errors.push(`Row ${line}: invalid hours "${r.hours}"`)
      return
    }
    if (typeof r.logDate !== 'string' || !isValidISODate(r.logDate)) {
      errors.push(`Row ${line}: invalid date "${r.logDate}"`)
      return
    }
    const workDone = typeof r.workDone === 'string' ? r.workDone.trim() : ''
    if (!workDone) {
      errors.push(`Row ${line}: missing work description`)
      return
    }
    out.push({
      userId: user.id,
      projectId: project.id,
      activityTypeId,
      hoursWorked: hours,
      workDone,
      logDate: r.logDate,
    })
  })

  if (out.length === 0 && errors.length > 0) {
    return { error: 'Nothing to import.', errors }
  }

  // Enforce the 24h daily cap across existing and incoming rows: rows that
  // would push a user's day above 24 hours are skipped and reported.
  const totals = await repo.getTimesheetDailyTotals(actor)
  const byKey = new Map(totals.map(t => [`${t.userId}|${t.logDate}`, t.hours]))
  const running = new Map<string, number>()
  const finalRows: TimesheetInput[] = []
  for (const row of out) {
    const key = `${row.userId}|${row.logDate}`
    const current = (byKey.get(key) ?? 0) + (running.get(key) ?? 0)
    if (current + row.hoursWorked > 24) {
      errors.push(`${row.logDate}: daily total would exceed 24 hours (${row.hoursWorked}h).`)
      continue
    }
    running.set(key, current + row.hoursWorked)
    finalRows.push(row)
  }

  const result = await repo.importTimesheets(actor, finalRows)
  if (!result.error) {
    // Only charge the budget when the import actually wrote data.
    consumeRateLimit(dailyImportStore, `import:${actor.id}`, RATE_LIMIT_IMPORT)
  }
  return {
    error: result.error ?? undefined,
    imported: result.imported,
    skipped: out.length - finalRows.length,
    errors,
  }
}

const MAX_BACKUP_SIZE = 20 * 1024 * 1024 // 20 MB

/** Admin: export all work data as a backup payload (JSON). */
export async function exportBackup(): Promise<{ payload: BackupPayload | null; error?: string }> {
  const gate = await requireActor(['admin'])
  if ('error' in gate) return { payload: null, error: gate.error }

  const result = await repo.exportBackup(gate.actor)
  return { payload: result.payload, error: result.error ?? undefined }
}

/** Admin: validate a backup JSON document and merge it into the database. */
export async function restoreBackup(
  json: string
): Promise<
  ActionResult & {
    created?: BackupCreatedCounts
    skipped?: number
  }
> {
  const gate = await requireActor(['admin'])
  if ('error' in gate) return { error: gate.error }

  if (typeof json !== 'string' || json.length === 0) return { error: 'No backup file selected.' }
  if (json.length > MAX_BACKUP_SIZE) return { error: 'Backup file is too large.' }

  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return { error: 'Invalid backup file (not valid JSON).' }
  }
  const check = parseBackup(parsed)
  if (!check.ok || !check.payload) return { error: check.error ?? 'Invalid backup file.' }

  const result = await repo.restoreBackup(gate.actor, check.payload)
  return {
    error: result.error ?? undefined,
    created: result.created,
    skipped: result.skipped,
  }
}
