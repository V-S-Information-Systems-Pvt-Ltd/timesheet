// app/actions.ts
'use server'

import { addDaysISO, todayISO } from '@/lib/dates'
import {
  isNonEmpty,
  isOneOf,
  isReasonableHours,
  isWithinBackfillWindow,
  isValidISODate,
  type BackfillSettings,
} from '@/lib/validation'
import { ROLES } from '@/app/constants'
import { repo } from '@/lib/db'
import { getActor } from '@/lib/auth'
import { requireRole, type Actor } from '@/lib/db/repository'
import type { UserRole } from './types'

type ActionResult = { error?: string }

/** Resolve the actor and enforce that their role is allowed. */
async function requireActor(
  allowed: UserRole[]
): Promise<{ actor: Actor } | { error: string }> {
  const gate = requireRole(await getActor(), allowed)
  if (!gate.ok) return { error: gate.error }
  return { actor: gate.actor }
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

  if (!isNonEmpty(input.projectId) || !isNonEmpty(input.workDone) || !isNonEmpty(input.activityTypeId)) {
    return { error: 'Project, activity type, and work description are required.' }
  }
  if (!isReasonableHours(input.hoursWorked)) {
    return { error: 'Hours must be greater than zero and at most 24.' }
  }
  if (!isValidISODate(input.logDate)) {
    return { error: 'Invalid date.' }
  }

  // Backfill window: one writable entry per day, only for recent dates.
  const today = todayISO()
  const settings = await repo.getBackfillWindow(actor)
  if (!isWithinBackfillWindow(input.logDate, today, settings)) {
    return { error: 'This date is outside the writable backfill window.' }
  }

  // One entry per user per day: update the existing row instead of inserting
  // a duplicate (enforced at the DB level by the (user_id, log_date) index).
  const existing = await repo.findTimesheetByUserDate(actor, actor.id, input.logDate)

  const payload = {
    userId: actor.id,
    projectId: input.projectId,
    activityTypeId: input.activityTypeId,
    hoursWorked: input.hoursWorked,
    workDone: input.workDone,
    logDate: input.logDate,
  }
  const result = existing
    ? await repo.updateTimesheet(actor, existing.id, payload)
    : await repo.createTimesheet(actor, payload)

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

  let targetUserId = actor.id
  if (input.userId && input.userId !== actor.id) {
    if (actor.role !== 'admin') {
      return { error: 'Only admins can backfill for other users.' }
    }
    targetUserId = input.userId
  }

  if (!isNonEmpty(input.projectId) || !isNonEmpty(input.activityTypeId) || !isNonEmpty(input.workDone)) {
    return { error: 'All fields are required.' }
  }
  if (!isReasonableHours(input.hoursWorked)) {
    return { error: 'Hours must be greater than zero and at most 24.' }
  }

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

  const existing = await repo.findTimesheetByUserDate(actor, targetUserId, yesterdayStr)
  if (existing) {
    return { error: 'An entry for yesterday already exists (one entry per day).' }
  }

  const result = await repo.createTimesheet(actor, {
    userId: targetUserId,
    projectId: input.projectId,
    activityTypeId: input.activityTypeId,
    hoursWorked: input.hoursWorked,
    workDone: input.workDone,
    logDate: yesterdayStr,
  })

  return result.error ? { error: result.error } : {}
}

export async function deleteLastEntry(): Promise<ActionResult> {
  const actor = await getActor()
  if (!actor) return { error: 'You must be signed in.' }

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

  if (!isNonEmpty(input.projectId) || !isNonEmpty(input.activityTypeId) || !isNonEmpty(input.workDone)) {
    return { error: 'All fields are required.' }
  }
  if (!isReasonableHours(input.hoursWorked)) {
    return { error: 'Hours must be greater than zero and at most 24.' }
  }
  if (!isValidISODate(input.logDate)) {
    return { error: 'Invalid date.' }
  }

  const target = await repo.getTimesheet(actor, entryId)
  if (!target) return { error: 'Entry not found.' }
  const canEditOthers = actor.role === 'admin'
  if (target.user_id !== actor.id && !canEditOthers) {
    return { error: 'You can only modify your own entries.' }
  }

  // The backfill window applies to regular users; admins may edit any entry.
  if (!canEditOthers) {
    const settings = await repo.getBackfillWindow(actor)
    if (!isWithinBackfillWindow(input.logDate, todayISO(), settings)) {
      return { error: 'This date is outside the writable backfill window.' }
    }
  }

  // Moving an entry onto a date that already has one is not allowed.
  const clash = await repo.findTimesheetByUserDate(actor, target.user_id, input.logDate)
  if (clash && clash.id !== entryId) {
    return { error: 'An entry for that date already exists (one entry per day).' }
  }

  const result = await repo.updateTimesheet(actor, entryId, {
    userId: target.user_id,
    projectId: input.projectId,
    activityTypeId: input.activityTypeId,
    hoursWorked: input.hoursWorked,
    workDone: input.workDone,
    logDate: input.logDate,
  })

  return result.error ? { error: result.error } : {}
}

export async function deleteTimesheet(entryId: string): Promise<ActionResult> {
  const actor = await getActor()
  if (!actor) return { error: 'You must be signed in.' }

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
