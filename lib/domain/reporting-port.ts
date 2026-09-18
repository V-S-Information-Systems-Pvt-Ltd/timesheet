import 'server-only'

import type {
  Actor,
  ReportBucket,
  ReportTotalsInput,
  TimesheetListOptions,
  TimesheetListResult,
} from '@/lib/db/repository'

/** Grouping axis for the scoped report aggregates. */
export type ReportGroupBy = 'user' | 'project' | 'activity'

/**
 * Narrow read port owned by the reporting application module. It exposes only
 * the aggregate and scoped-list reads a report needs, so each backend can
 * implement it without re-exposing the wide compatibility `Repository`.
 *
 * Scope enforcement stays inside the implementation: the Supabase adapter runs
 * the `get_grouped_report_totals` RPC through the request-scoped authenticated
 * client (RLS) and pages user-filtered reads through the same RLS-scoped list
 * query, while the native adapter applies the actor-scoped SQL
 * `timesheetScope`. The module never resolves a service-role client for
 * ordinary-user reporting.
 */
export interface ReportingPersistence {
  getGroupedReportTotals(
    actor: Actor,
    input: ReportTotalsInput,
    groupBy: ReportGroupBy
  ): Promise<ReportBucket[]>
  listTimesheets(actor: Actor, options: TimesheetListOptions): Promise<TimesheetListResult>
}
