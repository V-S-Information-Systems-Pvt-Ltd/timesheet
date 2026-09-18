import 'server-only'

import type { TimesheetRow } from '@/app/types'
import type {
  Actor,
  BulkTimesheetUpdate,
  BulkTimesheetUpdateResult,
  DbWrite,
  TimesheetInput,
  TimesheetListOptions,
  TimesheetListResult,
} from '@/lib/db/repository'
import type { BackfillSettings } from '@/lib/validation'

/**
 * Narrow persistence port owned by the timesheet application module. It exposes
 * only the operations the timesheet use cases need, so each backend can
 * implement it without re-exposing the wide compatibility `Repository`.
 *
 * Authorization, RLS, transaction boundaries, concurrency enforcement and
 * provider error mapping stay inside the implementation (native SQL or Supabase
 * request-scoped client). Row-to-DTO mapping stays in the transports.
 */
export interface TimesheetPersistence {
  list(actor: Actor, options: TimesheetListOptions): Promise<TimesheetListResult>
  getBackfillWindow(actor: Actor): Promise<BackfillSettings>
  getById(actor: Actor, id: string): Promise<TimesheetRow | null>
  getByIds(actor: Actor, ids: string[]): Promise<TimesheetRow[]>
  getByUserDate(actor: Actor, userId: string, logDate: string): Promise<TimesheetRow | null>
  getLatest(actor: Actor, userId: string): Promise<TimesheetRow | null>
  countByProject(actor: Actor, projectId: string): Promise<number>
  sumHoursForUserDate(
    actor: Actor,
    userId: string,
    logDate: string,
    excludeEntryId?: string
  ): Promise<number>
  sumHoursForUserDates(
    actor: Actor,
    pairs: Array<{ userId: string; logDate: string }>
  ): Promise<Map<string, number>>
  create(actor: Actor, input: TimesheetInput): Promise<DbWrite>
  update(actor: Actor, id: string, input: TimesheetInput): Promise<DbWrite>
  remove(actor: Actor, id: string): Promise<DbWrite>
  bulkUpdate(actor: Actor, updates: BulkTimesheetUpdate[]): Promise<BulkTimesheetUpdateResult>
}
