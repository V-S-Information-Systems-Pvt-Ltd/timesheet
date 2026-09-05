import 'server-only'

import type { Actor, TimesheetListOptions } from '@/lib/db/repository'
import { withServiceWriteBudget } from './_write-budget'
import { mapTimesheetDto, type TimesheetEntryDto } from '@/lib/api/v1/contracts'
import {
  createTimesheetEntry,
  updateTimesheetEntry,
  deleteTimesheetEntry,
  duplicateTimesheetEntry,
  listTimesheetsDomain,
  batchDeleteTimesheetsDomain,
  batchDuplicateTimesheetsDomain,
  type TimesheetDomainError,
} from '@/lib/domain/timesheets'

export interface TimesheetPayload {
  userId?: string
  projectId: string
  activityTypeId?: string | null
  hoursWorked: number
  workDone: string
  logDate: string
}

export type ServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; status: number } }

function rateLimited<T>(message: string): ServiceResult<T> {
  return { ok: false, error: { code: 'RATE_LIMITED', message, status: 429 } }
}

/** Only a successful write keeps the reserved slot. */
function chargeable<T>(result: ServiceResult<T>): boolean {
  return result.ok
}

function mapDomainError<T>(err: TimesheetDomainError): ServiceResult<T> {
  let status = 400
  let code = 'VALIDATION_ERROR'
  switch (err.code) {
    case 'FORBIDDEN':
      status = 403
      code = 'FORBIDDEN'
      break
    case 'NOT_FOUND':
      status = 404
      code = 'NOT_FOUND'
      break
    case 'OUTSIDE_WINDOW':
    case 'DAILY_HOURS_EXCEEDED':
    case 'VALIDATION_ERROR':
    case 'STORAGE_ERROR':
    default:
      status = 400
      code = 'VALIDATION_ERROR'
      break
  }
  return { ok: false, error: { code, message: err.message, status } }
}

export async function listTimesheetsService(
  actor: Actor,
  options: TimesheetListOptions = {}
): Promise<ServiceResult<{ rows: TimesheetEntryDto[]; count: number }>> {
  const result = await listTimesheetsDomain(actor, options)
  if (!result.ok) {
    return mapDomainError(result.error)
  }
  return {
    ok: true,
    data: {
      rows: result.data.rows.map(mapTimesheetDto),
      count: result.data.count,
    },
  }
}

export async function createTimesheetService(
  actor: Actor,
  input: TimesheetPayload
): Promise<ServiceResult<{ success: true }>> {
  return withServiceWriteBudget<ServiceResult<{ success: true }>>(
    actor.id,
    rateLimited,
    async () => {
      const result = await createTimesheetEntry(actor, input)
      if (!result.ok) {
        return mapDomainError(result.error)
      }
      return { ok: true, data: { success: true } }
    },
    chargeable
  )
}

export async function updateTimesheetService(
  actor: Actor,
  id: string,
  input: TimesheetPayload
): Promise<ServiceResult<{ success: true }>> {
  return withServiceWriteBudget<ServiceResult<{ success: true }>>(
    actor.id,
    rateLimited,
    async () => {
      const result = await updateTimesheetEntry(actor, id, input)
      if (!result.ok) {
        return mapDomainError(result.error)
      }
      return { ok: true, data: { success: true } }
    },
    chargeable
  )
}

export async function deleteTimesheetService(
  actor: Actor,
  id: string
): Promise<ServiceResult<{ success: true }>> {
  return withServiceWriteBudget<ServiceResult<{ success: true }>>(
    actor.id,
    rateLimited,
    async () => {
      const result = await deleteTimesheetEntry(actor, id)
      if (!result.ok) {
        return mapDomainError(result.error)
      }
      return { ok: true, data: { success: true } }
    },
    chargeable
  )
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
  return withServiceWriteBudget<ServiceResult<BatchDeleteTimesheetsDto>>(
    actor.id,
    rateLimited,
    async () => {
      const result = await batchDeleteTimesheetsDomain(actor, ids)
      if (!result.ok) {
        return mapDomainError(result.error)
      }
      return { ok: true, data: result.data }
    },
    (result) => result.ok && result.data.deletedCount > 0
  )
}

export async function duplicateTimesheetService(
  actor: Actor,
  id: string,
  targetDate?: string | null
): Promise<ServiceResult<{ success: true; entry: TimesheetEntryDto }>> {
  return withServiceWriteBudget<ServiceResult<{ success: true; entry: TimesheetEntryDto }>>(
    actor.id,
    rateLimited,
    async () => {
      const result = await duplicateTimesheetEntry(actor, id, targetDate)
      if (!result.ok) {
        return mapDomainError(result.error)
      }
      return {
        ok: true,
        data: {
          success: true,
          entry: mapTimesheetDto(result.data.entry),
        },
      }
    },
    chargeable
  )
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
  return withServiceWriteBudget<ServiceResult<BatchDuplicateTimesheetsDto>>(
    actor.id,
    rateLimited,
    async () => {
      const result = await batchDuplicateTimesheetsDomain(actor, items)
      if (!result.ok) {
        return mapDomainError(result.error)
      }
      return {
        ok: true,
        data: {
          results: result.data.results.map((r) => ({
            ...r,
            entry: r.entry ? mapTimesheetDto(r.entry) : undefined,
          })),
          duplicatedCount: result.data.duplicatedCount,
        },
      }
    },
    (result) => result.ok && result.data.duplicatedCount > 0
  )
}
