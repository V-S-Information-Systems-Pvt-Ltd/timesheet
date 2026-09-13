import 'server-only'

import { repo } from '@/lib/db'
import { todayISO } from '@/lib/dates'
import type { ReportingPersistence } from '@/lib/domain/reporting-port'
import type { ReportingDeps } from '@/lib/domain/reporting'

/**
 * Narrow adapter from the backend-dispatched compatibility `Repository` to the
 * reporting port. `repo` already resolves native PostgreSQL or the
 * request-scoped Supabase implementation, so this mapping adds no provider
 * behavior of its own; it only narrows the surface the reporting module sees.
 *
 * The grouped aggregate keeps the RLS-scoped `get_grouped_report_totals` RPC on
 * Supabase and the actor-scoped SQL on native; the scoped list keeps both
 * providers' existing optimized queries and pagination.
 */
export const reportingPersistence: ReportingPersistence = {
  getGroupedReportTotals: (actor, input, groupBy) =>
    repo.getGroupedReportTotals(actor, input, groupBy),
  listTimesheets: (actor, options) => repo.listTimesheets(actor, options),
}

/**
 * Server entry composition for the reporting module. Transports depend on this
 * helper instead of resolving a database backend themselves; the application
 * operations receive persistence and a clock explicitly.
 */
export function reportingDeps(
  overrides: Partial<Pick<ReportingDeps, 'clock'>> = {}
): ReportingDeps {
  return {
    persistence: reportingPersistence,
    clock: overrides.clock ?? todayISO,
  }
}
