// app/actions.ts
'use server'

import { addDaysISO, todayISO } from '@/lib/dates'
import {
  isNonEmpty,
  isOneOf,
  isWithinBackfillWindow,
  isValidISODate,
  sanitizeWorkDone,
  type BackfillSettings,
} from '@/lib/validation'
import { parseSchema, logEntrySchema, logYesterdaySchema } from '@/lib/validation-schemas'
import { RATE_LIMIT_DAILY, RATE_LIMIT_IMPORT, checkRateLimit, dailyWriteStore, dailyImportStore, getRetryAfter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { ADMIN_TILE_IDS, ROLES, TILE_IDS } from '@/app/constants'
import { parseBackup } from '@/lib/backup'
import { repo } from '@/lib/db'
import { getActor } from '@/lib/auth'
import { requireRole, type Actor, type TimesheetInput } from '@/lib/db/repository'
import type { AdminDashboardLayout, BackupCreatedCounts, BackupPayload, DashboardLayout, User, UserRole } from './types'

type ActionResult = { error?: string; fieldErrors?: Record<string, string[]> }

/** Check the per-user daily write budget. Logs and returns 429-style error on violation. */
function checkWriteRateLimit(actor: Actor): { ok: true } | { ok: false; error: string } {
  const result = checkRateLimit(dailyWriteStore, `writes:${actor.id}`, RATE_LIMIT_DAILY)
  if (!result.ok) {
    const retry = getRetryAfter(result.resetAt)
    logger.warn('rate limit: write exceeded', { userId: actor.id, retryAfter: retry })
    return { ok: false, error: `Rate limit exceeded. Try again in ${retry}s.` }
  }
  return { ok: true }
}

/** Resolve the actor and enforce that their role is allowed. */
async function requireActor(
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
function isSuperAdmin(actor: Actor | null): boolean {
  const email = process.env.SUPER_ADMIN_EMAIL?.trim().toLowerCase()
  return !!actor && !!email && actor.role === 'admin' && actor.email.toLowerCase() === email
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

  const rate = checkWriteRateLimit(actor)
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

  return result.error ? { error: result.error } : {}
}

/** Duplicate an existing entry: copy its project/activity/date/hours/description
 * as a new row for the same user. Same rules as logging: non-admins must be
 * inside the backfill window and the day's total must stay at or under 24h. */
export async function duplicateEntry(entryId: string): Promise<ActionResult> {
  const actor = await getActor()
  if (!actor) return { error: 'You must be signed in.' }
  if (!actor.isActive) return { error: 'Your account is not active.' }

  const rate = checkWriteRateLimit(actor)
  if (!rate.ok) return { error: rate.error }

  const target = await repo.getTimesheet(actor, entryId)
  if (!target) return { error: 'Entry not found.' }
  const canDuplicateOthers = actor.role === 'admin'
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

  const rate = checkWriteRateLimit(actor)
  if (!rate.ok) return { error: rate.error }

  let targetUserId = actor.id
  if (input.userId && input.userId !== actor.id) {
    if (actor.role !== 'admin') {
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

  return result.error ? { error: result.error } : {}
}

export async function deleteLastEntry(): Promise<ActionResult> {
  const actor = await getActor()
  if (!actor) return { error: 'You must be signed in.' }
  if (!actor.isActive) return { error: 'Your account is not active.' }

  const latest = await repo.getLatestTimesheet(actor, actor.id)
  if (!latest) return { error: 'No entries to undo.' }

  const result = await repo.deleteTimesheet(actor, latest.id)
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

  const rate = checkWriteRateLimit(actor)
  if (!rate.ok) return { error: rate.error }

  const parsed = parseSchema(logEntrySchema, input)
  if (!parsed.ok) return { error: parsed.error.error, fieldErrors: parsed.error.fieldErrors }

  const target = await repo.getTimesheet(actor, entryId)
  if (!target) return { error: 'Entry not found.' }
  const canEditOthers = actor.role === 'admin'
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

  return result.error ? { error: result.error } : {}
}

export async function deleteTimesheet(entryId: string): Promise<ActionResult> {
  const actor = await getActor()
  if (!actor) return { error: 'You must be signed in.' }
  if (!actor.isActive) return { error: 'Your account is not active.' }

  const rate = checkWriteRateLimit(actor)
  if (!rate.ok) return { error: rate.error }

  const target = await repo.getTimesheet(actor, entryId)
  if (!target) return { error: 'Entry not found.' }
  if (target.user_id !== actor.id && actor.role !== 'admin') {
    return { error: 'You can only delete your own entries.' }
  }

  const result = await repo.deleteTimesheet(actor, entryId)
  return result.error ? { error: result.error } : {}
}

export async function addUser(input: {
  email: string
  password: string
  name: string
  department: string
  title: string
  role: UserRole
  isActive: boolean
  /** Optional manager/team lead this user reports to. */
  managerId?: string | null
}): Promise<ActionResult> {
  const gate = await requireActor(['admin'])
  if ('error' in gate) return { error: gate.error }

  if (!isOneOf(input.role, ROLES)) {
    return { error: 'Invalid role.' }
  }
  if (!isNonEmpty(input.email) || !isNonEmpty(input.password) || input.password.length < 6) {
    return { error: 'Email and a password of at least 6 characters are required.' }
  }

  const email = input.email.trim().toLowerCase()
  const result = await repo.createUser(gate.actor, {
    email,
    password: input.password,
    name: input.name.trim(),
    department: input.department.trim(),
    title: input.title.trim(),
    role: input.role,
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

export async function updateUserRole(userId: string, role: UserRole): Promise<ActionResult> {
  const gate = await requireActor(['admin'])
  if ('error' in gate) return { error: gate.error }
  const actor = gate.actor

  if (!isOneOf(role, ROLES)) return { error: 'Invalid role.' }
  if (actor.id === userId) return { error: 'You cannot change your own role.' }

  const result = await repo.updateUserRole(actor, userId, role)
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

  const rate = checkRateLimit(dailyImportStore, `import:${actor.id}`, RATE_LIMIT_IMPORT)
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
