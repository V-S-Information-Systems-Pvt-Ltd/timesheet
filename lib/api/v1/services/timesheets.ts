import 'server-only'

import { repo } from '@/lib/db'
import type { Actor, TimesheetListOptions, TimesheetListResult } from '@/lib/db/repository'
import { todayISO } from '@/lib/dates'
import { isWithinBackfillWindow, sanitizeWorkDone } from '@/lib/validation'
import { isAdminActor } from '@/lib/roles'

export interface TimesheetPayload {
  projectId: string
  activityTypeId?: string | null
  hoursWorked: number
  workDone?: string
  logDate: string
}

export type ServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; status: number } }

export async function listTimesheetsService(
  actor: Actor,
  options: TimesheetListOptions = {}
): Promise<ServiceResult<TimesheetListResult>> {
  const result = await repo.listTimesheets(actor, options)
  return { ok: true, data: result }
}

export async function createTimesheetService(
  actor: Actor,
  input: TimesheetPayload
): Promise<ServiceResult<{ success: true }>> {
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

  return { ok: true, data: { success: true } }
}

export async function updateTimesheetService(
  actor: Actor,
  id: string,
  input: TimesheetPayload
): Promise<ServiceResult<{ success: true }>> {
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

  return { ok: true, data: { success: true } }
}

export async function deleteTimesheetService(
  actor: Actor,
  id: string
): Promise<ServiceResult<{ success: true }>> {
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

  return { ok: true, data: { success: true } }
}
