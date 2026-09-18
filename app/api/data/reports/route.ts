// app/api/data/reports/route.ts
// Server-side report aggregation for large datasets.
// Accepts project, from, to, and groupBy query params. from/to are DATES
// (YYYY-MM-DD) and are applied at the data layer via dateFrom/dateTo — they are
// NOT pagination offsets, so aggregation reflects the true requested range.
//
// Parsing/validation/defaulting and the totals reduction live in the reporting
// application module (lib/domain/reporting); this handler only authenticates,
// extracts the transport's query fields, and maps the result to the envelope.

import { json, requireActive, serverError } from '@/app/api/_http'
import { todayISO } from '@/lib/dates'
import { getReportTotals, resolveReportTotalsQuery } from '@/lib/domain/reporting'
import { reportingDeps } from '@/lib/db/reporting'

export async function GET(request: Request) {
  try {
    const auth = await requireActive()
    if (!auth.ok) return auth.response

    const url = new URL(request.url)
    const resolved = resolveReportTotalsQuery(
      {
        projectId: url.searchParams.get('project'),
        from: url.searchParams.get('from'),
        to: url.searchParams.get('to'),
        groupBy: url.searchParams.get('groupBy'),
      },
      { defaultGroupBy: 'user', clock: todayISO }
    )
    if (!resolved.ok) {
      return json({ error: resolved.message }, 400)
    }

    // Aggregate with GROUP BY on the server (SQL on native, SECURITY INVOKER
    // RLS RPC on Supabase) instead of shipping every row to the process and
    // summing in JS. Scope is applied inside each backend.
    const totals = await getReportTotals(
      auth.actor,
      resolved.filters,
      resolved.groupBy,
      reportingDeps()
    )

    return json({ data: totals })
  } catch (err) {
    return serverError(err)
  }
}
