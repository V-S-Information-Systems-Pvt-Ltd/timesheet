import 'server-only'

import type {
  Actor,
  ReportBucket,
  ReportLeave,
  ReportTotalsInput,
  TimesheetListOptions,
  TimesheetListResult,
} from '@/lib/db/types'

/** Grouping axis for the scoped report aggregates. */
export type ReportGroupBy = 'user' | 'project' | 'activity' | 'type'

export interface ReportLeaveFilters {
  userId?: string
  dateFrom?: string
  dateTo?: string
}

/**
 * Narrow read port owned by the reporting application module. It exposes only
 * the aggregate and scoped-list reads a report needs, so each backend can
 * implement it without re-exposing the wide compatibility `Repository`.
 *
 * Scope enforcement stays inside the implementation: the native adapter
 * applies the actor-scoped SQL `timesheetScope`.
 */
export interface ReportingPersistence {
  getGroupedReportTotals(
    actor: Actor,
    input: ReportTotalsInput,
    groupBy: ReportGroupBy
  ): Promise<ReportBucket[]>
  listTimesheets(actor: Actor, options: TimesheetListOptions): Promise<TimesheetListResult>
  /** Every matching leave marker, newest first, under the timesheet read scope. */
  listLeaves(actor: Actor, filters: ReportLeaveFilters): Promise<ReportLeave[]>
}
