import 'server-only'

import type {
  Actor,
  ReportBucket,
  ReportTotalsInput,
  TimesheetListOptions,
  TimesheetListResult,
} from '@/lib/db/types'

/** Grouping axis for the scoped report aggregates. */
export type ReportGroupBy = 'user' | 'project' | 'activity' | 'type'

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
}
