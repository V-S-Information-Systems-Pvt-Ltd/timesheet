import 'server-only'

import type {
  Actor,
  BulkTimesheetUpdate,
  TimesheetListOptions,
  TimesheetListResult,
} from '@/lib/db/repository'
import type { TimesheetRow } from '@/app/types'
import { isWithinBackfillWindow, sanitizeWorkDone } from '@/lib/validation'
import { isAdminActor } from '@/lib/roles'
import { parseSchema, logEntrySchema } from '@/lib/validation-schemas'
import { logger } from '@/lib/logger'
import type { TimesheetPersistence } from './timesheets-port'
import { runWithWriteBudget, type WriteBudget } from './write-budget'

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
  | 'RATE_LIMITED'

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

/**
 * Explicit dependencies for the timesheet application module: narrow
 * persistence, a clock, and the write budget. Transports compose these at the
 * server entry boundary; the module never resolves a global repository, cookies
 * or headers.
 */
export interface TimesheetDomainDeps {
  persistence: TimesheetPersistence
  clock: () => string
  writeBudget: WriteBudget
}

/**
 * Charge exactly one write-budget slot for an operation (or batch), releasing it
 * when the operation is not chargeable. Returns the operation result, or a
 * `RATE_LIMITED` domain error the transports map to their own envelope.
 */
async function chargeOnce<T>(
  deps: TimesheetDomainDeps,
  actorId: string,
  isChargeable: (result: DomainResult<T>) => boolean,
  run: () => Promise<DomainResult<T>>
): Promise<DomainResult<T>> {
  const outcome = await runWithWriteBudget(deps.writeBudget, actorId, run, isChargeable)
  if (!outcome.ok) {
    logger.warn('rate limit: write exceeded', { userId: actorId, retryAfter: outcome.retryAfter })
    return { ok: false, error: { code: 'RATE_LIMITED', message: outcome.error } }
  }
  return outcome.result
}

/**
 * Defense-in-depth active-account guard (T22.1). Transport boundaries
 * (`requireActiveActor`, `withMobileActor`) already reject inactive actors,
 * but the domain must not proceed for a direct caller holding an inactive
 * Actor either.
 */
function inactiveActorError(actor: Actor): TimesheetDomainError | null {
  if (!actor.isActive) {
    return { code: 'FORBIDDEN', message: 'Your account is not active.' }
  }
  return null
}

/**
 * Domain-owned shape validation (T22.1). Transports validate with the same
 * schema before calling, so already-validated payloads pass through
 * unchanged; direct domain callers cannot bypass hours/range/type bounds.
 */
function validateTimesheetInput(input: DomainTimesheetInput): TimesheetDomainError | null {
  const parsed = parseSchema(logEntrySchema, {
    userId: input.userId,
    projectId: input.projectId,
    activityTypeId: input.activityTypeId,
    hoursWorked: input.hoursWorked,
    workDone: input.workDone,
    logDate: input.logDate,
  })
  if (!parsed.ok) {
    return { code: 'VALIDATION_ERROR', message: parsed.error.error }
  }
  return null
}

/**
 * List timesheet entries with actor scoping and filtering options.
 */
export async function listTimesheetsDomain(
  actor: Actor,
  options: TimesheetListOptions = {},
  deps: TimesheetDomainDeps
): Promise<DomainResult<TimesheetListResult>> {
  const inactive = inactiveActorError(actor)
  if (inactive) return { ok: false, error: inactive }
  const result = await deps.persistence.list(actor, options)
  return { ok: true, data: result }
}

/**
 * Core business logic for creating a single timesheet entry.
 * Enforces ownership/role checks, backfill window, daily 24h cap, and sanitization.
 */
async function createTimesheetEntryWork(
  actor: Actor,
  input: DomainTimesheetInput,
  deps: TimesheetDomainDeps
): Promise<DomainResult<{ success: true; id?: string }>> {
  const inactive = inactiveActorError(actor)
  if (inactive) return { ok: false, error: inactive }
  const shapeError = validateTimesheetInput(input)
  if (shapeError) return { ok: false, error: shapeError }
  const { persistence, clock } = deps

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

  const currentDate = clock()
  if (!isAdminActor(actor) && !isAdminBackfill) {
    const settings = await persistence.getBackfillWindow(actor)
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

  const total = await persistence.sumHoursForUserDate(actor, targetUserId, input.logDate)
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
  const result = await persistence.create(actor, {
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

export async function createTimesheetEntry(
  actor: Actor,
  input: DomainTimesheetInput,
  deps: TimesheetDomainDeps
): Promise<DomainResult<{ success: true; id?: string }>> {
  return chargeOnce(deps, actor.id, (result) => result.ok, () =>
    createTimesheetEntryWork(actor, input, deps)
  )
}

/**
 * Core business logic for updating a timesheet entry.
 * Validates ownership, historical and replacement date backfill window, and daily 24h cap.
 */
async function updateTimesheetEntryWork(
  actor: Actor,
  id: string,
  input: DomainTimesheetInput,
  deps: TimesheetDomainDeps
): Promise<DomainResult<{ success: true }>> {
  const inactive = inactiveActorError(actor)
  if (inactive) return { ok: false, error: inactive }
  const shapeError = validateTimesheetInput(input)
  if (shapeError) return { ok: false, error: shapeError }
  const { persistence, clock } = deps

  const existing = await persistence.getById(actor, id)
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
    const settings = await persistence.getBackfillWindow(actor)
    const currentDate = clock()
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

  const total = await persistence.sumHoursForUserDate(actor, existing.user_id, input.logDate, id)
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
  const result = await persistence.update(actor, id, {
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

export async function updateTimesheetEntry(
  actor: Actor,
  id: string,
  input: DomainTimesheetInput,
  deps: TimesheetDomainDeps
): Promise<DomainResult<{ success: true }>> {
  return chargeOnce(deps, actor.id, (result) => result.ok, () =>
    updateTimesheetEntryWork(actor, id, input, deps)
  )
}

/**
 * Core business logic for deleting a timesheet entry.
 * Validates ownership and backfill window for non-admins.
 */
async function deleteTimesheetEntryWork(
  actor: Actor,
  id: string,
  deps: TimesheetDomainDeps
): Promise<DomainResult<{ success: true }>> {
  const inactive = inactiveActorError(actor)
  if (inactive) return { ok: false, error: inactive }
  const { persistence, clock } = deps

  const existing = await persistence.getById(actor, id)
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
    const settings = await persistence.getBackfillWindow(actor)
    if (!isWithinBackfillWindow(existing.log_date, clock(), settings)) {
      return {
        ok: false,
        error: {
          code: 'OUTSIDE_WINDOW',
          message: 'This date is outside the writable backfill window.',
        },
      }
    }
  }

  const result = await persistence.remove(actor, id)
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

export async function deleteTimesheetEntry(
  actor: Actor,
  id: string,
  deps: TimesheetDomainDeps
): Promise<DomainResult<{ success: true }>> {
  return chargeOnce(deps, actor.id, (result) => result.ok, () =>
    deleteTimesheetEntryWork(actor, id, deps)
  )
}

/**
 * Core business logic for duplicating an existing timesheet entry.
 */
async function duplicateTimesheetEntryWork(
  actor: Actor,
  id: string,
  targetDate: string | null | undefined,
  deps: TimesheetDomainDeps
): Promise<DomainResult<{ success: true; entry: TimesheetRow }>> {
  const inactive = inactiveActorError(actor)
  if (inactive) return { ok: false, error: inactive }
  const { persistence, clock } = deps

  const existing = await persistence.getById(actor, id)
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
    const settings = await persistence.getBackfillWindow(actor)
    if (!isWithinBackfillWindow(logDate, clock(), settings)) {
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
  const total = await persistence.sumHoursForUserDate(actor, targetUserId, logDate)
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
  const result = await persistence.create(actor, {
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
  let createdEntry = createdId ? await persistence.getById(actor, createdId) : null
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

export async function duplicateTimesheetEntry(
  actor: Actor,
  id: string,
  targetDate: string | null | undefined,
  deps: TimesheetDomainDeps
): Promise<DomainResult<{ success: true; entry: TimesheetRow }>> {
  return chargeOnce(deps, actor.id, (result) => result.ok, () =>
    duplicateTimesheetEntryWork(actor, id, targetDate, deps)
  )
}

/**
 * Undo / delete the user's latest logged timesheet entry.
 */
async function deleteLastTimesheetEntryWork(
  actor: Actor,
  deps: TimesheetDomainDeps
): Promise<DomainResult<{ success: true }>> {
  const inactive = inactiveActorError(actor)
  if (inactive) return { ok: false, error: inactive }
  const { persistence, clock } = deps

  const latest = await persistence.getLatest(actor, actor.id)
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
    const settings = await persistence.getBackfillWindow(actor)
    if (!isWithinBackfillWindow(latest.log_date, clock(), settings)) {
      return {
        ok: false,
        error: {
          code: 'OUTSIDE_WINDOW',
          message: 'This date is outside the writable backfill window.',
        },
      }
    }
  }

  const result = await persistence.remove(actor, latest.id)
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

export async function deleteLastTimesheetEntryDomain(
  actor: Actor,
  deps: TimesheetDomainDeps
): Promise<DomainResult<{ success: true }>> {
  return chargeOnce(deps, actor.id, (result) => result.ok, () =>
    deleteLastTimesheetEntryWork(actor, deps)
  )
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
async function bulkUpdateTimesheetsWork(
  actor: Actor,
  entries: BulkUpdateTimesheetItem[],
  deps: TimesheetDomainDeps
): Promise<DomainResult<BulkUpdateDomainResult>> {
  const inactive = inactiveActorError(actor)
  if (inactive) return { ok: false, error: inactive }
  const { persistence, clock } = deps

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
  const updates: BulkTimesheetUpdate[] = []

  const canEditOthers = isAdminActor(actor)
  const settings = !canEditOthers ? await persistence.getBackfillWindow(actor) : null
  const currentDate = clock()
  const dayTotals = new Map<string, number>()

  const targetTimesheets = await persistence.getByIds(
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
  const prefetchSums = await persistence.sumHoursForUserDates(
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
    const result = await persistence.bulkUpdate(actor, updates)
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

export async function bulkUpdateTimesheetsDomain(
  actor: Actor,
  entries: BulkUpdateTimesheetItem[],
  deps: TimesheetDomainDeps
): Promise<DomainResult<BulkUpdateDomainResult>> {
  return chargeOnce(
    deps,
    actor.id,
    (result) => result.ok && result.data.updated > 0,
    () => bulkUpdateTimesheetsWork(actor, entries, deps)
  )
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
async function batchDeleteTimesheetsWork(
  actor: Actor,
  ids: string[],
  deps: TimesheetDomainDeps
): Promise<DomainResult<BatchDeleteTimesheetsDomainResult>> {
  const inactive = inactiveActorError(actor)
  if (inactive) return { ok: false, error: inactive }
  const { persistence, clock } = deps

  const canDeleteOthers = isAdminActor(actor)
  let settings = null
  if (!canDeleteOthers) {
    settings = await persistence.getBackfillWindow(actor)
  }

  const results: BatchDeleteResultItem[] = []
  let deletedCount = 0

  for (const id of ids) {
    try {
      const existing = await persistence.getById(actor, id)
      if (!existing) {
        results.push({ id, success: false, error: 'Timesheet entry not found.' })
        continue
      }

      if (existing.user_id !== actor.id && !canDeleteOthers) {
        results.push({ id, success: false, error: 'You can only delete your own entries.' })
        continue
      }

      if (!canDeleteOthers && settings) {
        if (!isWithinBackfillWindow(existing.log_date, clock(), settings)) {
          results.push({ id, success: false, error: 'This entry is outside the writable backfill window.' })
          continue
        }
      }

      const res = await persistence.remove(actor, id)
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

export async function batchDeleteTimesheetsDomain(
  actor: Actor,
  ids: string[],
  deps: TimesheetDomainDeps
): Promise<DomainResult<BatchDeleteTimesheetsDomainResult>> {
  return chargeOnce(
    deps,
    actor.id,
    (result) => result.ok && result.data.deletedCount > 0,
    () => batchDeleteTimesheetsWork(actor, ids, deps)
  )
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
async function batchDuplicateTimesheetsWork(
  actor: Actor,
  items: Array<{ id: string; targetDate?: string }>,
  deps: TimesheetDomainDeps
): Promise<DomainResult<BatchDuplicateTimesheetsDomainResult>> {
  const inactive = inactiveActorError(actor)
  if (inactive) return { ok: false, error: inactive }
  const { persistence, clock } = deps

  const canEditOthers = isAdminActor(actor)
  let settings = null
  if (!canEditOthers) {
    settings = await persistence.getBackfillWindow(actor)
  }

  const results: BatchDuplicateResultItem[] = []
  let duplicatedCount = 0
  const runningDayTotals = new Map<string, number>()

  for (const item of items) {
    try {
      const existing = await persistence.getById(actor, item.id)
      if (!existing) {
        results.push({ id: item.id, success: false, error: 'Timesheet entry not found.' })
        continue
      }

      if (existing.user_id !== actor.id && !canEditOthers) {
        results.push({ id: item.id, success: false, error: 'You can only duplicate your own entries.' })
        continue
      }

      const logDate = item.targetDate?.trim() || existing.log_date
      const currentDate = clock()
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
        currentTotal = await persistence.sumHoursForUserDate(actor, targetUserId, logDate)
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

      const createRes = await persistence.create(actor, {
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
      let createdEntry = createdId ? await persistence.getById(actor, createdId) : null
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

export async function batchDuplicateTimesheetsDomain(
  actor: Actor,
  items: Array<{ id: string; targetDate?: string }>,
  deps: TimesheetDomainDeps
): Promise<DomainResult<BatchDuplicateTimesheetsDomainResult>> {
  return chargeOnce(
    deps,
    actor.id,
    (result) => result.ok && result.data.duplicatedCount > 0,
    () => batchDuplicateTimesheetsWork(actor, items, deps)
  )
}
