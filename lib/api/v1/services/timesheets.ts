import 'server-only'

import { repo } from '@/lib/db'
import type { Actor, TimesheetListOptions } from '@/lib/db/repository'
import { todayISO } from '@/lib/dates'
import { isWithinBackfillWindow, sanitizeWorkDone } from '@/lib/validation'
import { isAdminActor } from '@/lib/roles'
import { peekWriteRateLimit, consumeWriteRateLimit } from '@/lib/rate-limit'

import { mapTimesheetDto, type TimesheetEntryDto } from '@/lib/api/v1/contracts'

export interface TimesheetPayload {
  projectId: string
  activityTypeId?: string | null
  hoursWorked: number
  workDone: string
  logDate: string
}

export type ServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; status: number } }

export async function listTimesheetsService(
  actor: Actor,
  options: TimesheetListOptions = {}
): Promise<ServiceResult<{ rows: TimesheetEntryDto[]; count: number }>> {
  const result = await repo.listTimesheets(actor, options)
  return {
    ok: true,
    data: {
      rows: result.rows.map(mapTimesheetDto),
      count: result.count,
    },
  }
}

export async function createTimesheetService(
  actor: Actor,
  input: TimesheetPayload
): Promise<ServiceResult<{ success: true }>> {
  const rate = peekWriteRateLimit(actor.id)
  if (!rate.ok) {
    return {
      ok: false,
      error: { code: 'RATE_LIMITED', message: rate.error, status: 429 },
    }
  }

  const today = todayISO()
  const settings = await repo.getBackfillWindow(actor)
  if (!isAdminActor(actor) && !isWithinBackfillWindow(input.logDate, today, settings)) {
    return {
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: 'This date is outside the writable backfill window.', status: 400 },
    }
  }

  const total = await repo.sumHoursForUserDate(actor, actor.id, input.logDate)
  if (total + input.hoursWorked > 24) {
    return {
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: `Daily total would exceed 24 hours (${total}h already logged on ${input.logDate}).`,
        status: 400,
      },
    }
  }

  const result = await repo.createTimesheet(actor, {
    userId: actor.id,
    projectId: input.projectId,
    activityTypeId: input.activityTypeId || null,
    hoursWorked: input.hoursWorked,
    workDone: sanitizeWorkDone(input.workDone ?? ''),
    logDate: input.logDate,
  })

  if (result.error) {
    return {
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: result.error, status: 400 },
    }
  }

  consumeWriteRateLimit(actor.id)
  return { ok: true, data: { success: true } }
}

export async function updateTimesheetService(
  actor: Actor,
  id: string,
  input: TimesheetPayload
): Promise<ServiceResult<{ success: true }>> {
  const rate = peekWriteRateLimit(actor.id)
  if (!rate.ok) {
    return {
      ok: false,
      error: { code: 'RATE_LIMITED', message: rate.error, status: 429 },
    }
  }

  const existing = await repo.getTimesheet(actor, id)
  if (!existing) {
    return {
      ok: false,
      error: { code: 'NOT_FOUND', message: 'Timesheet entry not found.', status: 404 },
    }
  }

  const canEditOthers = isAdminActor(actor)
  if (existing.user_id !== actor.id && !canEditOthers) {
    return {
      ok: false,
      error: { code: 'FORBIDDEN', message: 'You can only edit your own entries.', status: 403 },
    }
  }

  if (!canEditOthers) {
    const settings = await repo.getBackfillWindow(actor)
    if (!isWithinBackfillWindow(input.logDate, todayISO(), settings)) {
      return {
        ok: false,
        error: { code: 'VALIDATION_ERROR', message: 'This date is outside the writable backfill window.', status: 400 },
      }
    }
  }

  const total = await repo.sumHoursForUserDate(actor, existing.user_id, input.logDate, id)
  if (total + input.hoursWorked > 24) {
    return {
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: 'Daily total would exceed 24 hours.', status: 400 },
    }
  }

  const result = await repo.updateTimesheet(actor, id, {
    userId: existing.user_id,
    projectId: input.projectId,
    activityTypeId: input.activityTypeId || null,
    hoursWorked: input.hoursWorked,
    workDone: sanitizeWorkDone(input.workDone ?? ''),
    logDate: input.logDate,
  })

  if (result.error) {
    return {
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: result.error, status: 400 },
    }
  }

  consumeWriteRateLimit(actor.id)
  return { ok: true, data: { success: true } }
}

export async function deleteTimesheetService(
  actor: Actor,
  id: string
): Promise<ServiceResult<{ success: true }>> {
  const rate = peekWriteRateLimit(actor.id)
  if (!rate.ok) {
    return {
      ok: false,
      error: { code: 'RATE_LIMITED', message: rate.error, status: 429 },
    }
  }

  const existing = await repo.getTimesheet(actor, id)
  if (!existing) {
    return {
      ok: false,
      error: { code: 'NOT_FOUND', message: 'Timesheet entry not found.', status: 404 },
    }
  }

  const canDeleteOthers = isAdminActor(actor)
  if (existing.user_id !== actor.id && !canDeleteOthers) {
    return {
      ok: false,
      error: { code: 'FORBIDDEN', message: 'You can only delete your own entries.', status: 403 },
    }
  }

  if (!canDeleteOthers) {
    const settings = await repo.getBackfillWindow(actor)
    if (!isWithinBackfillWindow(existing.log_date, todayISO(), settings)) {
      return {
        ok: false,
        error: { code: 'VALIDATION_ERROR', message: 'This entry is outside the writable backfill window.', status: 400 },
      }
    }
  }

  const result = await repo.deleteTimesheet(actor, id)
  if (result.error) {
    return {
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: result.error, status: 400 },
    }
  }

  consumeWriteRateLimit(actor.id)
  return { ok: true, data: { success: true } }
}

export async function duplicateTimesheetService(
  actor: Actor,
  id: string,
  targetDate?: string | null
): Promise<ServiceResult<{ success: true; entry: TimesheetEntryDto }>> {
  const rate = peekWriteRateLimit(actor.id)
  if (!rate.ok) {
    return {
      ok: false,
      error: { code: 'RATE_LIMITED', message: rate.error, status: 429 },
    }
  }

  const existing = await repo.getTimesheet(actor, id)
  if (!existing) {
    return {
      ok: false,
      error: { code: 'NOT_FOUND', message: 'Timesheet entry not found.', status: 404 },
    }
  }

  const canEditOthers = isAdminActor(actor)
  if (existing.user_id !== actor.id && !canEditOthers) {
    return {
      ok: false,
      error: { code: 'FORBIDDEN', message: 'You can only duplicate your own entries.', status: 403 },
    }
  }

  const logDate = targetDate?.trim() || existing.log_date
  const today = todayISO()
  if (!canEditOthers) {
    const settings = await repo.getBackfillWindow(actor)
    if (!isWithinBackfillWindow(logDate, today, settings)) {
      return {
        ok: false,
        error: { code: 'VALIDATION_ERROR', message: 'This date is outside the writable backfill window.', status: 400 },
      }
    }
  }

  const total = await repo.sumHoursForUserDate(actor, actor.id, logDate)
  if (total + Number(existing.hours_worked) > 24) {
    return {
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: `Daily total would exceed 24 hours (${total}h already logged on ${logDate}).`,
        status: 400,
      },
    }
  }

  const result = await repo.createTimesheet(actor, {
    userId: actor.id,
    projectId: existing.project_id,
    activityTypeId: existing.activity_type_id || null,
    hoursWorked: Number(existing.hours_worked),
    workDone: sanitizeWorkDone(existing.work_done ?? ''),
    logDate,
  })

  if (result.error) {
    return {
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: result.error, status: 400 },
    }
  }

  consumeWriteRateLimit(actor.id)

  const createdId = (result as { id?: string }).id
  let createdEntry = createdId ? await repo.getTimesheet(actor, createdId) : null
  if (!createdEntry) {
    createdEntry = {
      ...existing,
      id: createdId || `dup-${Date.now()}`,
      user_id: actor.id,
      log_date: logDate,
      hours_worked: Number(existing.hours_worked),
      work_done: existing.work_done,
    }
  }

  return {
    ok: true,
    data: {
      success: true,
      entry: mapTimesheetDto(createdEntry),
    },
  }
}

