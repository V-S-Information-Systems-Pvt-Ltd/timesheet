import { withMobileActor, serverError, apiError } from '@/app/api/v1/_http'
import { isValidISODate } from '@/lib/validation'
import { todayISO } from '@/lib/dates'
import { buildTimesheetCsvStream } from '@/lib/reports/csv-stream'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  return withMobileActor(request, async (auth) => {
    try {
      const url = new URL(request.url)
      const from = url.searchParams.get('from') || undefined
      const to = url.searchParams.get('to') || todayISO()

      if (from && !isValidISODate(from)) {
        return apiError('VALIDATION_ERROR', 'Invalid "from" date. Use YYYY-MM-DD.', 400)
      }
      if (to && !isValidISODate(to)) {
        return apiError('VALIDATION_ERROR', 'Invalid "to" date. Use YYYY-MM-DD.', 400)
      }

      const { stream, filename, totalCount } = await buildTimesheetCsvStream(
        auth.actor,
        {
          project: url.searchParams.get('project'),
          user: url.searchParams.get('user') || url.searchParams.get('userId'),
          from,
          to,
        },
        { preflight: true }
      )

      if (totalCount === 0) {
        return new Response(null, {
          status: 204,
          headers: {
            'X-Total-Count': '0',
            'Cache-Control': 'no-store, no-cache, must-revalidate',
          },
        })
      }

      return new Response(stream, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'X-Total-Count': String(totalCount),
          'Cache-Control': 'no-store, no-cache, must-revalidate',
        },
      })
    } catch (err) {
      return serverError(err)
    }
  })
}
