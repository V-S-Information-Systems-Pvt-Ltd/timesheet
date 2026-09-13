// lib/reports/csv-stream.ts
// Shared streaming CSV export for the web and mobile report export routes.
// Owns filter parsing, authorization pinning, filename derivation, and the
// chunked paging loop; the routes keep their distinct auth wrappers and
// validation error shapes.

import type { Actor } from '@/lib/db/repository'
import { repo } from '@/lib/db'
import { escapeCsvCell } from '@/lib/csv'
import { todayISO } from '@/lib/dates'
import { canSeeAllActor, isLeaderActor } from '@/lib/roles'
import { formatTimesheetCsvChunk, TIMESHEET_CSV_HEADERS } from './csv-export'

export const CSV_PAGE_SIZE = 500

export interface TimesheetCsvQuery {
  project?: string | null
  user?: string | null
  from?: string | null
  to?: string | null
}

/**
 * Build a streamed timesheet CSV response body.
 *
 * `preflight` fetches the first page with a count first so the caller can decide
 * whether to emit a body at all (and report X-Total-Count); without it the first
 * page is fetched inside the stream, like the web route's plain streaming.
 */
export async function buildTimesheetCsvStream(
  actor: Actor,
  query: TimesheetCsvQuery,
  opts: { preflight: boolean }
): Promise<{ stream: ReadableStream<Uint8Array>; filename: string; totalCount: number | null }> {
  const projectId = query.project && query.project !== 'all' ? query.project : undefined
  let userId = query.user && query.user !== 'all' ? query.user : undefined
  if (!canSeeAllActor(actor) && !isLeaderActor(actor)) {
    userId = actor.id
  }
  const dateFrom = query.from || undefined
  const dateTo = query.to || todayISO()

  const cleanFrom = (query.from || 'all').replace(/-/g, '')
  const cleanTo = (query.to || todayISO()).replace(/-/g, '')
  const filename = `timesheets_${cleanFrom}_${cleanTo}.csv`

  const filters = { userId, projectId, dateFrom, dateTo }

  let totalCount: number | null = null
  let firstRows: Awaited<ReturnType<typeof repo.listTimesheets>>['rows'] = []
  if (opts.preflight) {
    const firstPage = await repo.listTimesheets(actor, {
      ...filters,
      from: 0,
      to: CSV_PAGE_SIZE - 1,
      includeCount: true,
    })
    totalCount = firstPage.count ?? firstPage.rows.length
    firstRows = firstPage.rows
  }

  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(
          encoder.encode(TIMESHEET_CSV_HEADERS.map(escapeCsvCell).join(',') + '\n')
        )
        if (firstRows.length > 0) {
          controller.enqueue(encoder.encode(formatTimesheetCsvChunk(firstRows, false)))
        }

        let offset = opts.preflight ? CSV_PAGE_SIZE : 0
        let hasMore = opts.preflight ? firstRows.length >= CSV_PAGE_SIZE : true

        while (hasMore) {
          const listResult = await repo.listTimesheets(actor, {
            ...filters,
            from: offset,
            to: offset + CSV_PAGE_SIZE - 1,
            includeCount: false,
          })
          const rows = listResult.rows || []
          if (rows.length > 0) {
            controller.enqueue(encoder.encode(formatTimesheetCsvChunk(rows, false)))
          }
          if (rows.length < CSV_PAGE_SIZE) {
            hasMore = false
          } else {
            offset += CSV_PAGE_SIZE
          }
        }

        controller.close()
      } catch (streamErr) {
        controller.error(streamErr)
      }
    },
  })

  return { stream, filename, totalCount }
}
