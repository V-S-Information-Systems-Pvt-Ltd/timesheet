import 'server-only'

import type { Actor, TimesheetListOptions } from '@/lib/db/types'
import { timesheetDeps, timesheetPersistence } from '@/lib/db/timesheets'
import { isAdminActor } from '@/lib/roles'
import type { MobileServiceResult } from './_result'
import { mapTimesheetDto, type TimesheetEntryDto } from '@/lib/api/v1/contracts'
import type {
  CreateTimesheetInput,
  BatchDeleteTimesheetsResponse,
  BatchDuplicateTimesheetsResponse,
  BatchUpdateTimesheetItem,
  BatchUpdateTimesheetsResponse,
} from '@vsis/contracts'
import {
  createTimesheetEntry,
  updateTimesheetEntry,
  deleteTimesheetEntry,
  deleteLastTimesheetEntryDomain,
  duplicateTimesheetEntry,
  listTimesheetsDomain,
  batchDeleteTimesheetsDomain,
  batchDuplicateTimesheetsDomain,
  bulkUpdateTimesheetsDomain,
  type TimesheetDomainError,
  type DomainTimesheetInput,
} from '@/lib/domain/timesheets'

type TimesheetPayload = CreateTimesheetInput

/** Match Undo Last's persistence ordering, including existing tie behavior. */
export async function getLastTimesheetService(actor: Actor): Promise<MobileServiceResult<{ entry: TimesheetEntryDto | null }>> {
  if (!actor.isActive) return { success: false, code: 'FORBIDDEN', message: 'Your account is not active.', status: 403 }
  const entry = await timesheetPersistence.getLatest(actor, actor.id)
  return { success: true, data: { entry: entry ? mapTimesheetDto(entry) : null } }
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
    case 'RATE_LIMITED':
      status = 429
      code = 'RATE_LIMITED'
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
  const result = await listTimesheetsDomain(actor, options, timesheetDeps())
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
  const result = await createTimesheetEntry(actor, input, timesheetDeps())
  if (!result.ok) {
    return mapDomainError(result.error)
  }
  return { success: true, data: { success: true } }
}

export async function createYesterdayTimesheetService(
  actor: Actor,
  input: DomainTimesheetInput
): Promise<MobileServiceResult<{ success: true }>> {
  const result = await createTimesheetEntry(actor, input, timesheetDeps())
  if (!result.ok) {
    if (result.error.code === 'FORBIDDEN') {
      return { success: false, code: 'FORBIDDEN', message: 'Only admins can backfill for other users.', status: 403 }
    }
    if (result.error.code === 'OUTSIDE_WINDOW') {
      return {
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'Yesterday is outside the writable backfill window.',
        status: 400,
      }
    }
    if (result.error.code === 'DAILY_HOURS_EXCEEDED') {
      return {
        success: false,
        code: 'VALIDATION_ERROR',
        message: `Daily total would exceed 24 hours (${result.error.details?.currentTotal}h already logged for yesterday).`,
        status: 400,
      }
    }
    return mapDomainError(result.error)
  }
  return { success: true, data: { success: true } }
}

export async function updateTimesheetService(
  actor: Actor,
  id: string,
  input: TimesheetPayload
): Promise<MobileServiceResult<{ success: true }>> {
  const result = await updateTimesheetEntry(actor, id, input, timesheetDeps())
  if (!result.ok) {
    return mapDomainError(result.error)
  }
  return { success: true, data: { success: true } }
}

export async function deleteTimesheetService(
  actor: Actor,
  id: string
): Promise<MobileServiceResult<{ success: true }>> {
  const result = await deleteTimesheetEntry(actor, id, timesheetDeps())
  if (!result.ok) {
    return mapDomainError(result.error)
  }
  return { success: true, data: { success: true } }
}

export async function deleteLastTimesheetService(
  actor: Actor
): Promise<MobileServiceResult<{ success: true }>> {
  const result = await deleteLastTimesheetEntryDomain(actor, timesheetDeps())
  if (!result.ok) {
    return mapDomainError(result.error)
  }
  return { success: true, data: { success: true } }
}

type BatchDeleteTimesheetsDto = BatchDeleteTimesheetsResponse

export async function batchUpdateTimesheetsService(
  actor: Actor,
  entries: BatchUpdateTimesheetItem[]
): Promise<MobileServiceResult<BatchUpdateTimesheetsResponse>> {
  const result = await bulkUpdateTimesheetsDomain(actor, entries, timesheetDeps())
  if (!result.ok) return mapDomainError(result.error)
  return { success: true, data: result.data }
}

export async function batchDeleteTimesheetsService(
  actor: Actor,
  ids: string[]
): Promise<MobileServiceResult<BatchDeleteTimesheetsDto>> {
  const result = await batchDeleteTimesheetsDomain(actor, ids, timesheetDeps())
  if (!result.ok) {
    return mapDomainError(result.error)
  }
  return { success: true, data: result.data }
}

export async function duplicateTimesheetService(
  actor: Actor,
  id: string,
  targetDate?: string | null
): Promise<MobileServiceResult<{ success: true; entry: TimesheetEntryDto }>> {
  const result = await duplicateTimesheetEntry(actor, id, targetDate, timesheetDeps())
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
}

type BatchDuplicateTimesheetsDto = BatchDuplicateTimesheetsResponse

export async function batchDuplicateTimesheetsService(
  actor: Actor,
  items: Array<{ id: string; targetDate?: string }>
): Promise<MobileServiceResult<BatchDuplicateTimesheetsDto>> {
  const result = await batchDuplicateTimesheetsDomain(actor, items, timesheetDeps())
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
}

type BatchDuplicateReauthorizeResult =
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
    const existing = await timesheetPersistence.getById(actor, item.id)
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
