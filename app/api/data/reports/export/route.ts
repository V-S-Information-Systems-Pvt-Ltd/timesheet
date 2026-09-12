// app/api/data/reports/export/route.ts
// Server-streamed CSV export endpoint for large datasets.
// Streams results chunk-by-chunk directly to HTTP response as standard CSV attachment,
// ensuring bounded server and browser memory usage regardless of total row count.

import { json, requireActive, serverError } from '@/app/api/_http'
import { isValidISODate } from '@/lib/validation'
import { todayISO } from '@/lib/dates'
import { buildTimesheetCsvStream } from '@/lib/reports/csv-stream'

export async function GET(request: Request) {
  try {
    const auth = await requireActive()
    if (!auth.ok) return auth.response

    const url = new URL(request.url)
    const from = url.searchParams.get('from') || undefined
    const to = url.searchParams.get('to') || todayISO()

    if (from && !isValidISODate(from)) {
      return json({ error: 'Invalid "from" date. Use YYYY-MM-DD.' }, 400)
    }
    if (to && !isValidISODate(to)) {
      return json({ error: 'Invalid "to" date. Use YYYY-MM-DD.' }, 400)
    }

    const { stream, filename } = await buildTimesheetCsvStream(
      auth.actor,
      {
        project: url.searchParams.get('project'),
        user: url.searchParams.get('user'),
        from,
        to,
      },
      { preflight: false }
    )

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    })
  } catch (err) {
    return serverError(err)
  }
}
