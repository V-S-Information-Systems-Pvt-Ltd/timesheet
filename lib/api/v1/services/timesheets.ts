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

  let targetUserId = actor.id
  const isAdminBackfill = !!input.userId && input.userId !== actor.id
  if (isAdminBackfill) {
    if (!isAdminActor(actor)) {
      return {
        ok: false,
        error: { code: 'FORBIDDEN', message: 'Only admins can log time for other users.', status: 403 },
      }
    }
    targetUserId = input.userId!
  }

  const today = todayISO()
  const settings = await repo.getBackfillWindow(actor)
  if (!isAdminActor(actor) && !isWithinBackfillWindow(input.logDate, today, settings)) {
    return {
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: 'This date is outside the writable backfill window.', status: 400 },
    }
  }

  const total = await repo.sumHoursForUserDate(actor, targetUserId, input.logDate)
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
    userId: targetUserId,
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

export interface BatchDeleteResultItem {
  id: string
  success: boolean
  error?: string
}

export interface BatchDeleteTimesheetsDto {
  results: BatchDeleteResultItem[]
  deletedCount: number
}

export async function batchDeleteTimesheetsService(
  actor: Actor,
  ids: string[]
): Promise<ServiceResult<BatchDeleteTimesheetsDto>> {
  const rate = peekWriteRateLimit(actor.id)
  if (!rate.ok) {
    return {
      ok: false,
      error: { code: 'RATE_LIMITED', message: rate.error, status: 429 },
    }
  }

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
        if (!isWithinBackfillWindow(existing.log_date, todayISO(), settings)) {
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

  consumeWriteRateLimit(actor.id)
  return {
    ok: true,
    data: {
      results,
      deletedCount,
    },
  }
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

export interface BatchDuplicateResultItem {
  id: string
  success: boolean
  entry?: TimesheetEntryDto
  error?: string
}

export interface BatchDuplicateTimesheetsDto {
  results: BatchDuplicateResultItem[]
  duplicatedCount: number
}

export async function batchDuplicateTimesheetsService(
  actor: Actor,
  items: Array<{ id: string; targetDate?: string }>
): Promise<ServiceResult<BatchDuplicateTimesheetsDto>> {
  const rate = peekWriteRateLimit(actor.id)
  if (!rate.ok) {
    return {
      ok: false,
      error: { code: 'RATE_LIMITED', message: rate.error, status: 429 },
    }
  }

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
      const today = todayISO()
      if (!canEditOthers && settings) {
        if (!isWithinBackfillWindow(logDate, today, settings)) {
          results.push({ id: item.id, success: false, error: 'This date is outside the writable backfill window.' })
          continue
        }
      }

      let currentTotal = runningDayTotals.get(logDate)
      if (currentTotal === undefined) {
        currentTotal = await repo.sumHoursForUserDate(actor, actor.id, logDate)
        runningDayTotals.set(logDate, currentTotal)
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
        userId: actor.id,
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

      runningDayTotals.set(logDate, currentTotal + hours)
      const createdId = (createRes as { id?: string }).id
      let createdEntry = createdId ? await repo.getTimesheet(actor, createdId) : null
      if (!createdEntry) {
        createdEntry = {
          ...existing,
          id: createdId || `dup-${Date.now()}`,
          user_id: actor.id,
          log_date: logDate,
          hours_worked: hours,
          work_done: sanitizeWorkDone(existing.work_done ?? ''),
        }
      }

      results.push({ id: item.id, success: true, entry: mapTimesheetDto(createdEntry) })
      duplicatedCount++
    } catch (err) {
      results.push({ id: item.id, success: false, error: err instanceof Error ? err.message : 'Duplication failed.' })
    }
  }

  consumeWriteRateLimit(actor.id)
  return {
    ok: true,
    data: {
      results,
      duplicatedCount,
    },
  }
}

