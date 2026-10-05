// lib/api/v1/services/reports.ts
// Versioned report-aggregate service. Query extraction stays here (the versioned
// transport uses the `userId`/`user` spelling), while
// validation, filtering and the totals reduction are owned by the shared
// reporting application module.

import type { Actor } from '@/lib/db/types'
import { todayISO } from '@/lib/dates'
import { getReportTotals, resolveReportTotalsQuery } from '@/lib/domain/reporting'
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
