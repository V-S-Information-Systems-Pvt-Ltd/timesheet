// lib/api/v1/services/reports.ts
// Versioned report-aggregate service. Query extraction stays here (the versioned
// transport uses the `userId`/`user` spelling), while
// validation, filtering and the totals reduction are owned by the shared
// reporting application module.

import type { Actor, ReportLeave } from '@/lib/db/types'
import { todayISO } from '@vsis/core'
import { getReportTotals, listReportLeaves, resolveReportExportScope, resolveReportTotalsQuery } from '@/lib/domain/reporting'
import { isValidISODate } from '@/lib/validation'
import type { ReportGroupBy } from '@/lib/domain/reporting-port'
import { reportingDeps } from '@/lib/db/reporting'
import type { MobileServiceResult } from './_result'

import type { ReportTotalsDto } from '@/lib/api/v1/contracts'

export async function getReportsService(
  actor: Actor,
  searchParams: URLSearchParams,
  options: { defaultGroupBy?: ReportGroupBy } = {}
): Promise<MobileServiceResult<ReportTotalsDto>> {
  const resolved = resolveReportTotalsQuery(
    {
      projectId: searchParams.get('project'),
      userId: searchParams.get('userId') ?? searchParams.get('user'),
      from: searchParams.get('from'),
      to: searchParams.get('to'),
      groupBy: searchParams.get('groupBy'),
      entryType: searchParams.get('entryType'),
      activityCode: searchParams.get('activityCode'),
    },
    { defaultGroupBy: options.defaultGroupBy ?? 'project', clock: todayISO }
  )

  if (!resolved.ok) {
    return { success: false, code: 'VALIDATION_ERROR', message: resolved.message, status: 400 }
  }

  const totals = await getReportTotals(actor, resolved.filters, resolved.groupBy, reportingDeps())

  return { success: true, data: totals }
}

/** Leave markers for a browser-built report, under the same scope as its export. */
export async function getReportLeavesService(
  actor: Actor,
  searchParams: URLSearchParams
): Promise<MobileServiceResult<ReportLeave[]>> {
  const from = searchParams.get('from')
  const to = searchParams.get('to')
  if ((from && !isValidISODate(from)) || (to && !isValidISODate(to))) {
    return { success: false, code: 'VALIDATION_ERROR', message: 'Invalid date. Use YYYY-MM-DD.', status: 400 }
  }

  const deps = reportingDeps()
  const { filters } = resolveReportExportScope(actor, { user: searchParams.get('user'), from, to }, deps)
  // Open-ended, like the browser's timesheet history: planned leave is included.
  const leaves = await listReportLeaves(actor, { ...filters, dateTo: to || undefined }, deps)

  return { success: true, data: leaves }
}
