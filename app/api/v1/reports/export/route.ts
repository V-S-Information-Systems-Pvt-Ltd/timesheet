import { requireMobileActor, serverError, apiError } from '@/app/api/v1/_http'
import { repo } from '@/lib/db'
import { isValidISODate } from '@/lib/validation'
import { todayISO } from '@/lib/dates'
import { formatTimesheetCsvChunk, TIMESHEET_CSV_HEADERS } from '@/lib/reports/csv-export'
import { escapeCsvCell } from '@/lib/csv'
import { canSeeAllActor, isLeaderActor } from '@/lib/roles'

export const runtime = 'nodejs'

const PAGE_SIZE = 500

export async function GET(request: Request) {
  try {
    const auth = await requireMobileActor(request)
    if (!auth.ok) return auth.response

    const url = new URL(request.url)
    const rawProject = url.searchParams.get('project')
    const rawUser = url.searchParams.get('user') || url.searchParams.get('userId')
    const from = url.searchParams.get('from') || undefined
    const to = url.searchParams.get('to') || todayISO()

    if (from && !isValidISODate(from)) {
      return apiError('VALIDATION_ERROR', 'Invalid "from" date. Use YYYY-MM-DD.', 400)
    }
    if (to && !isValidISODate(to)) {
      return apiError('VALIDATION_ERROR', 'Invalid "to" date. Use YYYY-MM-DD.', 400)
    }

    const projectId = rawProject && rawProject !== 'all' ? rawProject : undefined
    let targetUserId = rawUser && rawUser !== 'all' ? rawUser : undefined

    // Enforce authorization constraints on user filter
    if (!canSeeAllActor(auth.actor) && !isLeaderActor(auth.actor)) {
      targetUserId = auth.actor.id
    }

    const cleanFrom = (from || 'all').replace(/-/g, '')
    const cleanTo = (to || todayISO()).replace(/-/g, '')
    const filename = `timesheets_${cleanFrom}_${cleanTo}.csv`

    const firstPage = await repo.listTimesheets(auth.actor, {
      userId: targetUserId,
      projectId,
      dateFrom: from,
      dateTo: to,
      from: 0,
      to: PAGE_SIZE - 1,
      includeCount: true,
    })

    const totalCount = firstPage.count ?? firstPage.rows.length
    if (totalCount === 0) {
      return new Response(null, {
        status: 204,
        headers: {
          'X-Total-Count': '0',
          'Cache-Control': 'no-store, no-cache, must-revalidate',
        },
      })
    }

    const encoder = new TextEncoder()

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          const headerLine = TIMESHEET_CSV_HEADERS.map(escapeCsvCell).join(',') + '\n'
          controller.enqueue(encoder.encode(headerLine))

          if (firstPage.rows.length > 0) {
            const firstChunk = formatTimesheetCsvChunk(firstPage.rows, false)
            controller.enqueue(encoder.encode(firstChunk))
          }

          let offset = PAGE_SIZE
          let hasMore = firstPage.rows.length >= PAGE_SIZE

          while (hasMore) {
            const listResult = await repo.listTimesheets(auth.actor, {
              userId: targetUserId,
              projectId,
              dateFrom: from,
              dateTo: to,
              from: offset,
              to: offset + PAGE_SIZE - 1,
              includeCount: false,
            })

            const rows = listResult.rows || []
            if (rows.length > 0) {
              const chunkText = formatTimesheetCsvChunk(rows, false)
              controller.enqueue(encoder.encode(chunkText))
            }

            if (rows.length < PAGE_SIZE) {
              hasMore = false
            } else {
              offset += PAGE_SIZE
            }
          }

          controller.close()
        } catch (streamErr) {
          controller.error(streamErr)
        }
      },
    })

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
}
