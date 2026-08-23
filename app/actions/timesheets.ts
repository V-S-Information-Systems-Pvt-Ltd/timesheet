// app/actions/timesheets.ts
// Server Actions for timesheet entry operations.
'use server'

import { addDaysISO, todayISO } from '@/lib/dates'
import { isWithinBackfillWindow, sanitizeWorkDone } from '@/lib/validation'
import { parseSchema, logEntrySchema, logYesterdaySchema } from '@/lib/validation-schemas'
import { repo } from '@/lib/db'
import { isAdminActor } from '@/lib/roles'
import {
  type ActionResult,
  peekWriteRateLimit,
  consumeWriteRateLimit,
  requireActiveActor,
} from './_shared'

export async function logEntry(input: {
  projectId: string
  activityTypeId: string
  hoursWorked: number
  workDone: string
  logDate: string
}): Promise<ActionResult> {
  const gate = await requireActiveActor()
  if ('error' in gate) return { error: gate.error }
  const actor = gate.actor

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
  const gate = await requireActiveActor()
  if ('error' in gate) return { error: gate.error }
  const actor = gate.actor

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

export async function logYesterday(input: {
  projectId: string
  activityTypeId: string
  hoursWorked: number
  workDone: string
  userId?: string
}): Promise<ActionResult> {
  const gate = await requireActiveActor()
  if ('error' in gate) return { error: gate.error }
  const actor = gate.actor

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

  // Multiple entries per day are allowed; the day's total must stay <= 24h.
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
  const gate = await requireActiveActor()
  if ('error' in gate) return { error: gate.error }
  const actor = gate.actor

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
  const gate = await requireActiveActor()
  if ('error' in gate) return { error: gate.error }
  const actor = gate.actor

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
  const gate = await requireActiveActor()
  if ('error' in gate) return { error: gate.error }
  const actor = gate.actor

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
  const gate = await requireActiveActor()
  if ('error' in gate) return { error: gate.error }
  const actor = gate.actor

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
    error: errors.length > 0 && updated === 0 ? 'All edits failed.' : undefined,
    updated,
    errors: errors.length > 0 ? errors : undefined,
  }
}
