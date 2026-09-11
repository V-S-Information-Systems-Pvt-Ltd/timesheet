import 'server-only'

import type { Actor, TimesheetListOptions } from '@/lib/db/repository'
import { repo } from '@/lib/db'
import { isAdminActor } from '@/lib/roles'
import { withServiceWriteBudget } from './_write-budget'
import type { MobileServiceResult } from './_result'
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

function rateLimited<T>(message: string): MobileServiceResult<T> {
  return { success: false, code: 'RATE_LIMITED', message, status: 429 }
}

/** Only a successful write keeps the reserved slot. */
function chargeable<T>(result: MobileServiceResult<T>): boolean {
  return result.success
}

function mapDomainError<T>(err: TimesheetDomainError): MobileServiceResult<T> {
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
  return { success: false, code, message: err.message, status }
}

export async function listTimesheetsService(
  actor: Actor,
  options: TimesheetListOptions = {}
): Promise<MobileServiceResult<{ rows: TimesheetEntryDto[]; count: number }>> {
  const result = await listTimesheetsDomain(actor, options)
  if (!result.ok) {
    return mapDomainError(result.error)
  }
  return {
    success: true,
    data: {
      rows: result.data.rows.map(mapTimesheetDto),
      count: result.data.count,
    },
  }
}

export async function createTimesheetService(
  actor: Actor,
  input: TimesheetPayload
): Promise<MobileServiceResult<{ success: true }>> {
  return withServiceWriteBudget<MobileServiceResult<{ success: true }>>(
    actor.id,
    rateLimited,
    async () => {
      const result = await createTimesheetEntry(actor, input)
      if (!result.ok) {
        return mapDomainError(result.error)
      }
      return { success: true, data: { success: true } }
    },
    chargeable
  )
}

export async function updateTimesheetService(
  actor: Actor,
  id: string,
  input: TimesheetPayload
): Promise<MobileServiceResult<{ success: true }>> {
  return withServiceWriteBudget<MobileServiceResult<{ success: true }>>(
    actor.id,
    rateLimited,
    async () => {
      const result = await updateTimesheetEntry(actor, id, input)
      if (!result.ok) {
        return mapDomainError(result.error)
      }
      return { success: true, data: { success: true } }
    },
    chargeable
  )
}

export async function deleteTimesheetService(
  actor: Actor,
  id: string
): Promise<MobileServiceResult<{ success: true }>> {
  return withServiceWriteBudget<MobileServiceResult<{ success: true }>>(
    actor.id,
    rateLimited,
    async () => {
      const result = await deleteTimesheetEntry(actor, id)
      if (!result.ok) {
        return mapDomainError(result.error)
      }
      return { success: true, data: { success: true } }
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
): Promise<MobileServiceResult<BatchDeleteTimesheetsDto>> {
  return withServiceWriteBudget<MobileServiceResult<BatchDeleteTimesheetsDto>>(
    actor.id,
    rateLimited,
    async () => {
      const result = await batchDeleteTimesheetsDomain(actor, ids)
      if (!result.ok) {
        return mapDomainError(result.error)
      }
      return { success: true, data: result.data }
    },
    (result) => result.success && result.data.deletedCount > 0
  )
}

export async function duplicateTimesheetService(
  actor: Actor,
  id: string,
  targetDate?: string | null
): Promise<MobileServiceResult<{ success: true; entry: TimesheetEntryDto }>> {
  return withServiceWriteBudget<MobileServiceResult<{ success: true; entry: TimesheetEntryDto }>>(
    actor.id,
    rateLimited,
    async () => {
      const result = await duplicateTimesheetEntry(actor, id, targetDate)
      if (!result.ok) {
        return mapDomainError(result.error)
      }
      return {
        success: true,
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
): Promise<MobileServiceResult<BatchDuplicateTimesheetsDto>> {
  return withServiceWriteBudget<MobileServiceResult<BatchDuplicateTimesheetsDto>>(
    actor.id,
    rateLimited,
    async () => {
      const result = await batchDuplicateTimesheetsDomain(actor, items)
      if (!result.ok) {
        return mapDomainError(result.error)
      }
      return {
        success: true,
        data: {
          results: result.data.results.map((r) => ({
            ...r,
            entry: r.entry ? mapTimesheetDto(r.entry) : undefined,
          })),
          duplicatedCount: result.data.duplicatedCount,
        },
      }
    },
    (result) => result.success && result.data.duplicatedCount > 0
  )
}

export type BatchDuplicateReauthorizeResult =
  | { ok: true }
  | { ok: false; code: 'IDEMPOTENCY_CONFLICT' | 'FORBIDDEN'; message: string; status: number }

/**
 * Reauthorize a stored batch-duplicate replay: before the stored entry DTOs
 * are returned, recheck that every source entry still exists and that the
 * actor still has access to it (T19.2 review finding: replays must not return
 * stale access decisions).
 */
export async function reauthorizeBatchDuplicateStored(
  actor: Actor,
  storedPayload: unknown
): Promise<BatchDuplicateReauthorizeResult> {
  const results = (
    storedPayload as { data?: { results?: Array<{ id: string; success: boolean }> } }
  )?.data?.results
  if (!Array.isArray(results)) {
    // Fail closed: a committed batch-duplicate success always stores
    // `data.results` as an array (only 2xx responses are ever committed to the
    // ledger — see withIdempotency). An unrecognized/absent shape means we
    // cannot re-verify the actor's access to the source entries, so replaying
    // the stored DTOs could leak entries the actor no longer owns. Deny instead
    // of degrading open.
    return {
      ok: false,
      code: 'IDEMPOTENCY_CONFLICT',
      message: 'The stored replay response could not be reauthorized and will not be replayed.',
      status: 409,
    }
  }
  for (const item of results) {
    if (!item.success) continue
    const existing = await repo.getTimesheet(actor, item.id)
    if (!existing) {
      return {
        ok: false,
        code: 'IDEMPOTENCY_CONFLICT',
        message: 'A source timesheet entry required for this replay no longer exists.',
        status: 409,
      }
    }
    if (existing.user_id !== actor.id && !isAdminActor(actor)) {
      return {
        ok: false,
        code: 'FORBIDDEN',
        message: 'Access to a source timesheet entry required for this replay was revoked.',
        status: 403,
      }
    }
  }
  return { ok: true }
}
