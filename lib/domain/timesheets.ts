import 'server-only'

import type { Actor, TimesheetListOptions, TimesheetListResult } from '@/lib/db/repository'
import type { TimesheetRow } from '@/app/types'
import { repo as defaultRepo } from '@/lib/db'
import { todayISO } from '@/lib/dates'
import { isWithinBackfillWindow, sanitizeWorkDone } from '@/lib/validation'
import { isAdminActor } from '@/lib/roles'
import { parseSchema, logEntrySchema } from '@/lib/validation-schemas'

export interface DomainTimesheetInput {
  userId?: string
  projectId: string
  activityTypeId?: string | null
  hoursWorked: number
  workDone: string
  logDate: string
}

export type TimesheetDomainErrorCode =
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'OUTSIDE_WINDOW'
  | 'DAILY_HOURS_EXCEEDED'
  | 'VALIDATION_ERROR'
  | 'STORAGE_ERROR'

export interface TimesheetDomainError {
  code: TimesheetDomainErrorCode
  message: string
  details?: {
    currentTotal?: number
    logDate?: string
    [key: string]: unknown
  }
}

export type DomainResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: TimesheetDomainError }

export interface TimesheetDomainDeps {
  repo?: typeof defaultRepo
  today?: () => string
}

function resolveDeps(deps?: TimesheetDomainDeps) {
  return {
    repo: deps?.repo ?? defaultRepo,
    today: deps?.today ?? todayISO,
  }
}

/**
 * List timesheet entries with actor scoping and filtering options.
 */
export async function listTimesheetsDomain(
  actor: Actor,
  options: TimesheetListOptions = {},
  deps?: TimesheetDomainDeps
): Promise<DomainResult<TimesheetListResult>> {
  const { repo } = resolveDeps(deps)
  const result = await repo.listTimesheets(actor, options)
  return { ok: true, data: result }
}

/**
 * Core business logic for creating a single timesheet entry.
 * Enforces ownership/role checks, backfill window, daily 24h cap, and sanitization.
 */
export async function createTimesheetEntry(
  actor: Actor,
  input: DomainTimesheetInput,
  deps?: TimesheetDomainDeps
): Promise<DomainResult<{ success: true; id?: string }>> {
  const { repo, today } = resolveDeps(deps)

  let targetUserId = actor.id
  const isAdminBackfill = !!input.userId && input.userId !== actor.id
  if (isAdminBackfill) {
    if (!isAdminActor(actor)) {
      return {
        ok: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Only admins can log time for other users.',
        },
      }
    }
    targetUserId = input.userId!
  }

  const currentDate = today()
  if (!isAdminActor(actor) && !isAdminBackfill) {
    const settings = await repo.getBackfillWindow(actor)
    if (!isWithinBackfillWindow(input.logDate, currentDate, settings)) {
      return {
        ok: false,
        error: {
          code: 'OUTSIDE_WINDOW',
          message: 'This date is outside the writable backfill window.',
        },
      }
    }
  }

  const total = await repo.sumHoursForUserDate(actor, targetUserId, input.logDate)
  if (total + input.hoursWorked > 24) {
    return {
      ok: false,
      error: {
        code: 'DAILY_HOURS_EXCEEDED',
        message: `Daily total would exceed 24 hours (${total}h already logged on ${input.logDate}).`,
        details: { currentTotal: total, logDate: input.logDate },
      },
    }
  }

  const sanitizedWorkDone = sanitizeWorkDone(input.workDone ?? '')
  const result = await repo.createTimesheet(actor, {
    userId: targetUserId,
    projectId: input.projectId,
    activityTypeId: input.activityTypeId || null,
    hoursWorked: input.hoursWorked,
    workDone: sanitizedWorkDone,
    logDate: input.logDate,
  })

  if (result.error) {
    return {
      ok: false,
      error: {
        code: 'STORAGE_ERROR',
        message: result.error,
      },
    }
  }

  const createdId = result.id
  return { ok: true, data: { success: true, id: createdId } }
}

/**
 * Core business logic for updating a timesheet entry.
 * Validates ownership, historical and replacement date backfill window, and daily 24h cap.
 */
export async function updateTimesheetEntry(
  actor: Actor,
  id: string,
  input: DomainTimesheetInput,
  deps?: TimesheetDomainDeps
): Promise<DomainResult<{ success: true }>> {
  const { repo, today } = resolveDeps(deps)

  const existing = await repo.getTimesheet(actor, id)
  if (!existing) {
    return {
      ok: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Timesheet entry not found.',
      },
    }
  }

  const canEditOthers = isAdminActor(actor)
  if (existing.user_id !== actor.id && !canEditOthers) {
    return {
      ok: false,
      error: {
        code: 'FORBIDDEN',
        message: 'You can only edit your own entries.',
      },
    }
  }

  if (!canEditOthers) {
    const settings = await repo.getBackfillWindow(actor)
    const currentDate = today()
    if (
      !isWithinBackfillWindow(existing.log_date, currentDate, settings) ||
      !isWithinBackfillWindow(input.logDate, currentDate, settings)
    ) {
      return {
        ok: false,
        error: {
          code: 'OUTSIDE_WINDOW',
          message: 'This date is outside the writable backfill window.',
        },
      }
    }
  }

  const total = await repo.sumHoursForUserDate(actor, existing.user_id, input.logDate, id)
  if (total + input.hoursWorked > 24) {
    return {
      ok: false,
      error: {
        code: 'DAILY_HOURS_EXCEEDED',
        message: `Daily total would exceed 24 hours (${total}h already logged on ${input.logDate}).`,
        details: { currentTotal: total, logDate: input.logDate },
      },
    }
  }

  const sanitizedWorkDone = sanitizeWorkDone(input.workDone ?? '')
  const result = await repo.updateTimesheet(actor, id, {
    userId: existing.user_id,
    projectId: input.projectId,
    activityTypeId: input.activityTypeId || null,
    hoursWorked: input.hoursWorked,
    workDone: sanitizedWorkDone,
    logDate: input.logDate,
  })

  if (result.error) {
    return {
      ok: false,
      error: {
        code: 'STORAGE_ERROR',
        message: result.error,
      },
    }
  }

  return { ok: true, data: { success: true } }
}

/**
 * Core business logic for deleting a timesheet entry.
 * Validates ownership and backfill window for non-admins.
 */
export async function deleteTimesheetEntry(
  actor: Actor,
  id: string,
  deps?: TimesheetDomainDeps
): Promise<DomainResult<{ success: true }>> {
  const { repo, today } = resolveDeps(deps)

  const existing = await repo.getTimesheet(actor, id)
  if (!existing) {
    return {
      ok: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Timesheet entry not found.',
      },
    }
  }

  const canDeleteOthers = isAdminActor(actor)
  if (existing.user_id !== actor.id && !canDeleteOthers) {
    return {
      ok: false,
      error: {
        code: 'FORBIDDEN',
        message: 'You can only delete your own entries.',
      },
    }
  }

  if (!canDeleteOthers) {
    const settings = await repo.getBackfillWindow(actor)
    if (!isWithinBackfillWindow(existing.log_date, today(), settings)) {
      return {
        ok: false,
        error: {
          code: 'OUTSIDE_WINDOW',
          message: 'This date is outside the writable backfill window.',
        },
      }
    }
  }

  const result = await repo.deleteTimesheet(actor, id)
  if (result.error) {
    return {
      ok: false,
      error: {
        code: 'STORAGE_ERROR',
        message: result.error,
      },
    }
  }

  return { ok: true, data: { success: true } }
}

/**
 * Core business logic for duplicating an existing timesheet entry.
 */
export async function duplicateTimesheetEntry(
  actor: Actor,
  id: string,
  targetDate?: string | null,
  deps?: TimesheetDomainDeps
): Promise<DomainResult<{ success: true; entry: TimesheetRow }>> {
  const { repo, today } = resolveDeps(deps)

  const existing = await repo.getTimesheet(actor, id)
  if (!existing) {
    return {
      ok: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Timesheet entry not found.',
      },
    }
  }

  const canEditOthers = isAdminActor(actor)
  if (existing.user_id !== actor.id && !canEditOthers) {
    return {
      ok: false,
      error: {
        code: 'FORBIDDEN',
        message: 'You can only duplicate your own entries.',
      },
    }
  }

  const logDate = targetDate?.trim() || existing.log_date
  if (!canEditOthers) {
    const settings = await repo.getBackfillWindow(actor)
    if (!isWithinBackfillWindow(logDate, today(), settings)) {
      return {
        ok: false,
        error: {
          code: 'OUTSIDE_WINDOW',
          message: 'This date is outside the writable backfill window.',
        },
      }
    }
  }

  const targetUserId = canEditOthers ? existing.user_id : actor.id
  const total = await repo.sumHoursForUserDate(actor, targetUserId, logDate)
  const hours = Number(existing.hours_worked)
  if (total + hours > 24) {
    return {
      ok: false,
      error: {
        code: 'DAILY_HOURS_EXCEEDED',
        message: `Daily total would exceed 24 hours (${total}h already logged on ${logDate}).`,
        details: { currentTotal: total, logDate },
      },
    }
  }

  const sanitizedWorkDone = sanitizeWorkDone(existing.work_done ?? '')
  const result = await repo.createTimesheet(actor, {
    userId: targetUserId,
    projectId: existing.project_id,
    activityTypeId: existing.activity_type_id || null,
    hoursWorked: hours,
    workDone: sanitizedWorkDone,
    logDate,
  })

  if (result.error) {
    return {
      ok: false,
      error: {
        code: 'STORAGE_ERROR',
        message: result.error,
      },
    }
  }

  const createdId = result.id
  let createdEntry = createdId ? await repo.getTimesheet(actor, createdId) : null
  if (!createdEntry && createdId) {
    // Fallback only when the created row cannot be re-read; use the real DB id,
    // never a fabricated one, so client references resolve to a persisted row.
    createdEntry = {
      ...existing,
      id: createdId,
      user_id: targetUserId,
      log_date: logDate,
      hours_worked: hours,
      work_done: sanitizedWorkDone,
    }
  }
  if (!createdEntry) {
    return {
      ok: false,
      error: { code: 'STORAGE_ERROR', message: 'The duplicated entry could not be read back.' },
    }
  }

  return { ok: true, data: { success: true, entry: createdEntry } }
}

/**
 * Undo / delete the user's latest logged timesheet entry.
 */
export async function deleteLastTimesheetEntryDomain(
  actor: Actor,
  deps?: TimesheetDomainDeps
): Promise<DomainResult<{ success: true }>> {
  const { repo, today } = resolveDeps(deps)

  const latest = await repo.getLatestTimesheet(actor, actor.id)
  if (!latest) {
    return {
      ok: false,
      error: {
        code: 'NOT_FOUND',
        message: 'No entries to undo.',
      },
    }
  }

  if (!isAdminActor(actor)) {
    const settings = await repo.getBackfillWindow(actor)
    if (!isWithinBackfillWindow(latest.log_date, today(), settings)) {
      return {
        ok: false,
        error: {
          code: 'OUTSIDE_WINDOW',
          message: 'This date is outside the writable backfill window.',
        },
      }
    }
  }

  const result = await repo.deleteTimesheet(actor, latest.id)
  if (result.error) {
    return {
      ok: false,
      error: {
        code: 'STORAGE_ERROR',
        message: result.error,
      },
    }
  }

  return { ok: true, data: { success: true } }
}

export interface BulkUpdateTimesheetItem {
  id: string
  projectId: string
  activityTypeId: string
  hoursWorked: number
  workDone: string
  logDate: string
}

export interface BulkUpdateDomainResult {
  updated: number
  errors?: string[]
}

/**
 * Bulk-edit a batch of timesheet entries with prefetching and running daily totals.
 */
export async function bulkUpdateTimesheetsDomain(
  actor: Actor,
  entries: BulkUpdateTimesheetItem[],
  deps?: TimesheetDomainDeps
): Promise<DomainResult<BulkUpdateDomainResult>> {
  const { repo, today } = resolveDeps(deps)

  if (!Array.isArray(entries) || entries.length === 0) {
    return {
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: 'No entries selected.' },
    }
  }
  if (entries.length > 500) {
    return {
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: 'Too many entries for one edit (max 500).' },
    }
  }

  const errors: string[] = []
  const updates: Array<{
    id: string
    projectId: string
    activityTypeId: string | null
    hoursWorked: number
    workDone: string
    logDate: string
  }> = []

  const canEditOthers = isAdminActor(actor)
  const settings = !canEditOthers ? await repo.getBackfillWindow(actor) : null
  const currentDate = today()
  const dayTotals = new Map<string, number>()

  const targetTimesheets = await repo.getTimesheetsByIds(
    actor,
    entries.map((e) => e.id)
  )
  const targetById = new Map<string, NonNullable<(typeof targetTimesheets)[number]>>()
  targetTimesheets.forEach((t) => {
    if (t) targetById.set(t.id, t)
  })

  // Collect distinct (user_id, log_date) pairs
  const distinctDayKeys = new Map<string, { userId: string; logDate: string }>()
  for (const entry of entries) {
    const target = targetById.get(entry.id)
    if (!target) continue
    const key = `${target.user_id}:${entry.logDate}`
    if (!distinctDayKeys.has(key)) {
      distinctDayKeys.set(key, { userId: target.user_id, logDate: entry.logDate })
    }
  }

  // Pre-fetch daily sums for distinct pairs
  const prefetchSums = await repo.sumHoursForUserDates(
    actor,
    Array.from(distinctDayKeys.values())
  )

  for (const [key, sum] of prefetchSums.entries()) {
    let baseline = sum
    for (const entry of entries) {
      const target = targetById.get(entry.id)
      if (target && `${target.user_id}:${target.log_date}` === key) {
        baseline -= target.hours_worked
      }
    }
    dayTotals.set(key, Math.max(0, baseline))
  }

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

    const target = targetById.get(entry.id)
    if (!target) {
      errors.push(`Entry ${entry.id}: not found`)
      continue
    }
    if (target.user_id !== actor.id && !canEditOthers) {
      errors.push(`Entry ${entry.id}: you can only modify your own entries`)
      continue
    }

    if (!canEditOthers && settings) {
      if (
        !isWithinBackfillWindow(target.log_date, currentDate, settings) ||
        !isWithinBackfillWindow(parsed.data.logDate, currentDate, settings)
      ) {
        errors.push(`Entry ${entry.id}: outside the writable backfill window`)
        continue
      }
    }

    const dayKey = `${target.user_id}:${parsed.data.logDate}`
    const currentDayTotal = dayTotals.get(dayKey) ?? 0

    if (currentDayTotal + parsed.data.hoursWorked > 24) {
      errors.push(`Entry ${entry.id}: daily total would exceed 24 hours`)
      continue
    }
    dayTotals.set(dayKey, currentDayTotal + parsed.data.hoursWorked)

    updates.push({
      id: entry.id,
      projectId: parsed.data.projectId,
      activityTypeId: parsed.data.activityTypeId,
      hoursWorked: parsed.data.hoursWorked,
      workDone: sanitizeWorkDone(parsed.data.workDone ?? ''),
      logDate: parsed.data.logDate,
    })
  }

  let updated = 0
  if (updates.length > 0) {
    const result = await repo.bulkUpdateTimesheets(actor, updates)
    for (const rowError of result.rowErrors) {
      errors.push(`Entry ${rowError.id}: ${rowError.error}`)
    }
    updated = result.updated
  }

  return {
    ok: true,
    data: {
      updated,
      errors: errors.length > 0 ? errors : undefined,
    },
  }
}

export interface BatchDeleteResultItem {
  id: string
  success: boolean
  error?: string
}

export interface BatchDeleteTimesheetsDomainResult {
  results: BatchDeleteResultItem[]
  deletedCount: number
}

/**
 * Batch delete timesheet entries with actor scoping and backfill window enforcement.
 */
export async function batchDeleteTimesheetsDomain(
  actor: Actor,
  ids: string[],
  deps?: TimesheetDomainDeps
): Promise<DomainResult<BatchDeleteTimesheetsDomainResult>> {
  const { repo, today } = resolveDeps(deps)

  const canDeleteOthers = isAdminActor(actor)
  let settings = null
  if (!canDeleteOthers) {
    settings = await repo.getBackfillWindow(actor)
  }

  const results: BatchDeleteResultItem[] = []
  let deletedCount = 0

  for (const id of ids) {
    try {
      const existing = await repo.getTimesheet(actor, id)
      if (!existing) {
        results.push({ id, success: false, error: 'Timesheet entry not found.' })
        continue
      }

      if (existing.user_id !== actor.id && !canDeleteOthers) {
        results.push({ id, success: false, error: 'You can only delete your own entries.' })
        continue
      }

      if (!canDeleteOthers && settings) {
        if (!isWithinBackfillWindow(existing.log_date, today(), settings)) {
          results.push({ id, success: false, error: 'This entry is outside the writable backfill window.' })
          continue
        }
      }

      const res = await repo.deleteTimesheet(actor, id)
      if (res.error) {
        results.push({ id, success: false, error: res.error })
      } else {
        results.push({ id, success: true })
        deletedCount++
      }
    } catch (err) {
      results.push({ id, success: false, error: err instanceof Error ? err.message : 'Deletion failed.' })
    }
  }

  return { ok: true, data: { results, deletedCount } }
}

export interface BatchDuplicateResultItem {
  id: string
  success: boolean
  entry?: TimesheetRow
  error?: string
}

export interface BatchDuplicateTimesheetsDomainResult {
  results: BatchDuplicateResultItem[]
  duplicatedCount: number
}

/**
 * Batch duplicate timesheet entries with running daily totals and backfill window checks.
 */
export async function batchDuplicateTimesheetsDomain(
  actor: Actor,
  items: Array<{ id: string; targetDate?: string }>,
  deps?: TimesheetDomainDeps
): Promise<DomainResult<BatchDuplicateTimesheetsDomainResult>> {
  const { repo, today } = resolveDeps(deps)

  const canEditOthers = isAdminActor(actor)
  let settings = null
  if (!canEditOthers) {
    settings = await repo.getBackfillWindow(actor)
  }

  const results: BatchDuplicateResultItem[] = []
  let duplicatedCount = 0
  const runningDayTotals = new Map<string, number>()

  for (const item of items) {
    try {
      const existing = await repo.getTimesheet(actor, item.id)
      if (!existing) {
        results.push({ id: item.id, success: false, error: 'Timesheet entry not found.' })
        continue
      }

      if (existing.user_id !== actor.id && !canEditOthers) {
        results.push({ id: item.id, success: false, error: 'You can only duplicate your own entries.' })
        continue
      }

      const logDate = item.targetDate?.trim() || existing.log_date
      const currentDate = today()
      if (!canEditOthers && settings) {
        if (!isWithinBackfillWindow(logDate, currentDate, settings)) {
          results.push({ id: item.id, success: false, error: 'This date is outside the writable backfill window.' })
          continue
        }
      }

      // Preserve ownership exactly like single duplicate: admins duplicating
      // another user's entry keep the entry on that user; otherwise the copy
      // belongs to the caller. Totals are tracked per (user, date).
      const targetUserId = canEditOthers ? existing.user_id : actor.id
      const totalsKey = `${targetUserId}:${logDate}`
      let currentTotal = runningDayTotals.get(totalsKey)
      if (currentTotal === undefined) {
        currentTotal = await repo.sumHoursForUserDate(actor, targetUserId, logDate)
        runningDayTotals.set(totalsKey, currentTotal)
      }

      const hours = Number(existing.hours_worked)
      if (currentTotal + hours > 24) {
        results.push({
          id: item.id,
          success: false,
          error: `Daily total would exceed 24 hours (${currentTotal}h already logged on ${logDate}).`,
        })
        continue
      }

      const createRes = await repo.createTimesheet(actor, {
        userId: targetUserId,
        projectId: existing.project_id,
        activityTypeId: existing.activity_type_id || null,
        hoursWorked: hours,
        workDone: sanitizeWorkDone(existing.work_done ?? ''),
        logDate,
      })

      if (createRes.error) {
        results.push({ id: item.id, success: false, error: createRes.error })
        continue
      }

      runningDayTotals.set(totalsKey, currentTotal + hours)
      const createdId = createRes.id
      let createdEntry = createdId ? await repo.getTimesheet(actor, createdId) : null
      if (!createdEntry && createdId) {
        createdEntry = {
          ...existing,
          id: createdId,
          user_id: targetUserId,
          log_date: logDate,
          hours_worked: hours,
          work_done: sanitizeWorkDone(existing.work_done ?? ''),
        }
      }
      if (!createdEntry) {
        results.push({ id: item.id, success: false, error: 'The duplicated entry could not be read back.' })
        continue
      }

      results.push({ id: item.id, success: true, entry: createdEntry })
      duplicatedCount++
    } catch (err) {
      results.push({ id: item.id, success: false, error: err instanceof Error ? err.message : 'Duplication failed.' })
    }
  }

  return { ok: true, data: { results, duplicatedCount } }
}
