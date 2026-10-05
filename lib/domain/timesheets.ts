import 'server-only'

import type {
  Actor,
  BulkTimesheetUpdate,
  TimesheetInput,
  TimesheetListOptions,
  TimesheetListResult,
} from '@/lib/db/types'
import type { TimesheetRow } from '@/app/types'
import { isWithinBackfillWindow, sanitizeWorkDone } from '@/lib/validation'
import { isAdminActor } from '@/lib/roles'
import { parseSchema, logEntrySchema } from '@/lib/validation-schemas'
import { newEntrySchema, normalizeClassification, isEntryType } from '@vsis/contracts'
import { logger } from '@/lib/logger'
import { isTimesheetClassificationV2Enabled } from '@/lib/timesheet-format'
import type { TimesheetPersistence } from './timesheets-port'
import { runWithWriteBudget, type WriteBudget } from './write-budget'

export interface DomainTimesheetInput {
  userId?: string
  /** Legacy/Project entries carry a project; Support/Internal do not. */
  projectId?: string | null
  activityTypeId?: string | null
  /** Classification v2. When entryType is set the new-format validator applies. */
  entryType?: string | null
  activityCode?: string | null
  activityOther?: string | null
  ticketNumber?: string | null
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
  | 'CLASSIFICATION_REQUIRED'
  | 'STORAGE_ERROR'
  | 'RATE_LIMITED'

export interface TimesheetDomainError {
  code: TimesheetDomainErrorCode
  message: string
  fieldErrors?: Record<string, string[]>
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

/** Persistence write fields minus the server-resolved owner id. */
type NormalizedWrite = Omit<TimesheetInput, 'userId'>

/**
 * Legacy-format validation (Project + Activity-type). Used for new entries that
 * omit a Type and for editing historical rows, which keep their stored format.
 */
function buildLegacyWrite(input: DomainTimesheetInput): DomainResult<NormalizedWrite> {
  const parsed = parseSchema(logEntrySchema, {
    userId: input.userId,
    projectId: input.projectId,
    activityTypeId: input.activityTypeId,
    hoursWorked: input.hoursWorked,
    workDone: input.workDone,
    logDate: input.logDate,
  })
  if (!parsed.ok) {
    return { ok: false, error: { code: 'VALIDATION_ERROR', message: parsed.error.error, fieldErrors: parsed.error.fieldErrors } }
  }
  return {
    ok: true,
    data: {
      projectId: parsed.data.projectId,
      activityTypeId: parsed.data.activityTypeId ?? null,
      hoursWorked: parsed.data.hoursWorked,
      workDone: sanitizeWorkDone(parsed.data.workDone ?? ''),
      logDate: parsed.data.logDate,
    },
  }
}

/**
 * New-format validation (Type -> Activity). Validates the taxonomy branch rules
 * and verifies server-side project eligibility for Project entries. New-format
 * rows never carry a legacy activity_type_id.
 */
async function buildNewWrite(
  actor: Actor,
  input: DomainTimesheetInput,
  deps: TimesheetDomainDeps
): Promise<DomainResult<NormalizedWrite>> {
  const parsed = parseSchema(newEntrySchema, {
    userId: input.userId,
    entryType: input.entryType,
    activityCode: input.activityCode,
    projectId: input.projectId,
    activityTypeId: input.activityTypeId,
    ticketNumber: input.ticketNumber,
    activityOther: input.activityOther,
    hoursWorked: input.hoursWorked,
    workDone: input.workDone,
    logDate: input.logDate,
  })
  if (!parsed.ok) {
    return { ok: false, error: { code: 'VALIDATION_ERROR', message: parsed.error.error, fieldErrors: parsed.error.fieldErrors } }
  }
  const cls = normalizeClassification(parsed.data)
  if (cls.entryType === 'project') {
    const eligibility = await deps.persistence.projectEligibility(actor, cls.projectId!)
    if (!eligibility) {
      return { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Selected project was not found.' } }
    }
    if (!eligibility.eligible) {
      return { ok: false, error: { code: 'VALIDATION_ERROR', message: 'This project cannot be used for timesheet entries.' } }
    }
  }
  return {
    ok: true,
    data: {
      projectId: cls.projectId,
      activityTypeId: null,
      entryType: cls.entryType,
      activityCode: cls.activityCode,
      activityOther: cls.activityOther,
      ticketNumber: cls.ticketNumber,
      hoursWorked: parsed.data.hoursWorked,
      workDone: sanitizeWorkDone(parsed.data.workDone ?? ''),
      logDate: parsed.data.logDate,
    },
  }
}

/**
 * Resolve the persistence write for a create/update. `storedRow` is the existing
 * row for edits (its format is authoritative); null means a fresh create, whose
 * format is taken from the input (a Type selects new-format; its absence keeps
 * legacy for backward compatibility with pre-v2 callers).
 */
async function resolveWrite(
  actor: Actor,
  input: DomainTimesheetInput,
  storedRow: TimesheetRow | null,
  deps: TimesheetDomainDeps
): Promise<DomainResult<NormalizedWrite>> {
  const hasClassification = input.entryType != null || input.activityCode != null ||
    input.ticketNumber != null || input.activityOther != null
  if (storedRow && storedRow.entry_type == null && hasClassification) {
    return { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Historical entries must keep their legacy format.' } }
  }
  if (!storedRow && !hasClassification && isTimesheetClassificationV2Enabled()) {
    return { ok: false, error: { code: 'CLASSIFICATION_REQUIRED', message: 'Select a Type and Activity for this new entry.' } }
  }
  const useNewFormat = storedRow ? storedRow.entry_type != null : hasClassification
  return useNewFormat ? buildNewWrite(actor, input, deps) : buildLegacyWrite(input)
}

const CLASSIFICATION_REQUIRED_MESSAGE =
  'This entry predates Type/Activity. Review and re-enter it to copy.'

/**
 * Build the create input for duplicating `existing` onto `logDate` for `userId`.
 * A new-format source preserves Type, Activity, Ticket Number and Other
 * Activity; a historical source cannot be copied implicitly and returns
 * CLASSIFICATION_REQUIRED so the caller opens a reclassification draft.
 */
function duplicateWriteFromRow(
  existing: TimesheetRow,
  userId: string,
  logDate: string
): DomainResult<TimesheetInput> {
  const hours = Number(existing.hours_worked)
  const workDone = sanitizeWorkDone(existing.work_done ?? '')
  if (!isEntryType(existing.entry_type)) {
    return { ok: false, error: { code: 'CLASSIFICATION_REQUIRED', message: CLASSIFICATION_REQUIRED_MESSAGE } }
  }
  return {
    ok: true,
    data: {
      userId,
      projectId: existing.project_id,
      activityTypeId: null,
      entryType: existing.entry_type,
      activityCode: existing.activity_code ?? null,
      activityOther: existing.activity_other ?? null,
      ticketNumber: existing.ticket_number ?? null,
      hoursWorked: hours,
      workDone,
      logDate,
    },
  }
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
  const built = await resolveWrite(actor, input, null, deps)
  if (!built.ok) return built
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

  const result = await persistence.create(actor, { userId: targetUserId, ...built.data })

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

  // The stored row's format is authoritative: a historical row stays legacy and
  // a new-format row cannot be downgraded by omitting its classification.
  const built = await resolveWrite(actor, input, existing, deps)
  if (!built.ok) return built

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

  const result = await persistence.update(actor, id, { userId: existing.user_id, ...built.data })

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
  const targetUserId = canEditOthers ? existing.user_id : actor.id

  // Preserve a new-format source's classification; a legacy source must be
  // reclassified through a fresh draft (CLASSIFICATION_REQUIRED).
  const dup = duplicateWriteFromRow(existing, targetUserId, logDate)
  if (!dup.ok) return dup
  const validated = await buildNewWrite(actor, dup.data, deps)
  if (!validated.ok) return validated
  dup.data = { userId: targetUserId, ...validated.data }

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

  const total = await persistence.sumHoursForUserDate(actor, targetUserId, logDate)
  const hours = dup.data.hoursWorked
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

  const result = await persistence.create(actor, dup.data)

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
      work_done: dup.data.workDone,
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
  projectId?: string | null
  activityTypeId?: string | null
  entryType?: string | null
  activityCode?: string | null
  activityOther?: string | null
  ticketNumber?: string | null
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

  const rowErrors: Array<string | undefined> = new Array(entries.length)
  const updates: BulkTimesheetUpdate[] = []

  const canEditOthers = isAdminActor(actor)
  const settings = !canEditOthers ? await persistence.getBackfillWindow(actor) : null
  const currentDate = clock()

  const targetTimesheets = await persistence.getByIds(
    actor,
    entries.map((e) => e.id)
  )
  const targetById = new Map<string, NonNullable<(typeof targetTimesheets)[number]>>()
  targetTimesheets.forEach((t) => {
    if (t) targetById.set(t.id, t)
  })

  // Reject rows before their dates reach persistence or their originals are
  // removed from the daily projection. Keep errors in original input order.
  // Each row validates according to its STORED format (mixed-format batches are
  // supported): a legacy row stays legacy, a new-format row keeps its Type.
  const scheduledIds = new Set<string>()
  const candidates: Array<{ index: number; id: string; target: TimesheetRow; write: NormalizedWrite }> = []
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]
    const target = targetById.get(entry.id)
    if (!target) {
      rowErrors[index] = `Entry ${entry.id}: not found`
      continue
    }
    if (target.user_id !== actor.id && !canEditOthers) {
      rowErrors[index] = `Entry ${entry.id}: you can only modify your own entries`
      continue
    }

    const built = await resolveWrite(actor, entry, target, deps)
    if (!built.ok) {
      rowErrors[index] = `Entry ${entry.id}: ${built.error.message}`
      continue
    }

    if (!canEditOthers && settings) {
      if (
        !isWithinBackfillWindow(target.log_date, currentDate, settings) ||
        !isWithinBackfillWindow(built.data.logDate, currentDate, settings)
      ) {
        rowErrors[index] = `Entry ${entry.id}: outside the writable backfill window`
        continue
      }
    }

    if (scheduledIds.has(entry.id)) {
      rowErrors[index] = `Entry ${entry.id}: duplicate entry in batch`
      continue
    }
    scheduledIds.add(entry.id)
    candidates.push({ index, id: entry.id, target, write: built.data })
  }

  const distinctDayKeys = new Map<string, { userId: string; logDate: string }>()
  for (const { target, write } of candidates) {
    const key = `${target.user_id}:${write.logDate}`
    distinctDayKeys.set(key, { userId: target.user_id, logDate: write.logDate })
  }
  const prefetchSums = candidates.length > 0
    ? await persistence.sumHoursForUserDates(actor, Array.from(distinctDayKeys.values()))
    : new Map<string, number>()

  // A cap-rejected edit keeps its original row. Recompute the surviving
  // projection until no rejected removal is financing another admission.
  // Persistence still owns concurrent changes and actual write constraints.
  let admitted = candidates
  while (admitted.length > 0) {
    const dayTotals = new Map<string, number>()
    for (const key of distinctDayKeys.keys()) dayTotals.set(key, prefetchSums.get(key) ?? 0)
    for (const { target } of admitted) {
      const key = `${target.user_id}:${target.log_date}`
      if (dayTotals.has(key)) dayTotals.set(key, dayTotals.get(key)! - Number(target.hours_worked))
    }
    for (const [key, total] of dayTotals) dayTotals.set(key, Math.max(0, total))

    const surviving = admitted.filter(({ index, id, target, write }) => {
      const key = `${target.user_id}:${write.logDate}`
      const currentTotal = dayTotals.get(key) ?? 0
      if (currentTotal + write.hoursWorked > 24) {
        rowErrors[index] = `Entry ${id}: daily total would exceed 24 hours`
        return false
      }
      dayTotals.set(key, currentTotal + write.hoursWorked)
      return true
    })
    if (surviving.length === admitted.length) break
    admitted = surviving
  }

  for (const { id, write } of admitted) {
    updates.push({ id, ...write })
  }

  const errors = rowErrors.filter((error): error is string => error !== undefined)
  let updated = 0
  if (updates.length > 0) {
    const result = await persistence.bulkUpdate(actor, updates)
    if (result.error) {
      return { ok: false, error: { code: 'STORAGE_ERROR', message: result.error } }
    }
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
  /** 'CLASSIFICATION_REQUIRED' when the source row is a legacy-format entry. */
  code?: string
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

      // Preserve ownership exactly like single duplicate: admins duplicating
      // another user's entry keep the entry on that user; otherwise the copy
      // belongs to the caller. Totals are tracked per (user, date).
      const targetUserId = canEditOthers ? existing.user_id : actor.id

      // A legacy-format source cannot be copied implicitly; report it per-row so
      // the caller can open a reclassification draft for just those entries.
      const dup = duplicateWriteFromRow(existing, targetUserId, logDate)
      if (!dup.ok) {
        results.push({
          id: item.id,
          success: false,
          code: dup.error.code === 'CLASSIFICATION_REQUIRED' ? 'CLASSIFICATION_REQUIRED' : undefined,
          error: dup.error.message,
        })
        continue
      }

      const validated = await buildNewWrite(actor, dup.data, deps)
      if (!validated.ok) {
        results.push({ id: item.id, success: false, error: validated.error.message })
        continue
      }
      dup.data = { userId: targetUserId, ...validated.data }

      if (!canEditOthers && settings) {
        if (!isWithinBackfillWindow(logDate, currentDate, settings)) {
          results.push({ id: item.id, success: false, error: 'This date is outside the writable backfill window.' })
          continue
        }
      }

      const totalsKey = `${targetUserId}:${logDate}`
      let currentTotal = runningDayTotals.get(totalsKey)
      if (currentTotal === undefined) {
        currentTotal = await persistence.sumHoursForUserDate(actor, targetUserId, logDate)
        runningDayTotals.set(totalsKey, currentTotal)
      }

      const hours = dup.data.hoursWorked
      if (currentTotal + hours > 24) {
        results.push({
          id: item.id,
          success: false,
          error: `Daily total would exceed 24 hours (${currentTotal}h already logged on ${logDate}).`,
        })
        continue
      }

      const createRes = await persistence.create(actor, dup.data)

      if (createRes.error) {
        results.push({ id: item.id, success: false, error: createRes.error })
        continue
      }

      runningDayTotals.set(totalsKey, currentTotal + hours)
      const createdId = createRes.id
      let createdEntry: TimesheetRow | null = null
      if (createdId) {
        try {
          createdEntry = await persistence.getById(actor, createdId)
        } catch {
          // Creation committed; use the existing fallback for optional read-back.
        }
      }
      if (!createdEntry && createdId) {
        createdEntry = {
          ...existing,
          id: createdId,
          user_id: targetUserId,
          log_date: logDate,
          hours_worked: hours,
          work_done: dup.data.workDone,
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
