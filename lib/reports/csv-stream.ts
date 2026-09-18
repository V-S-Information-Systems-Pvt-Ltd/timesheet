// lib/reports/csv-stream.ts
// Shared streaming CSV export for the web and mobile report export routes.
// Owns the chunked paging loop and header emission; scope enforcement, filter
// defaults and filename derivation come from the reporting application module,
// while the routes keep their distinct auth wrappers and validation error
// shapes.

import type { Actor } from '@/lib/db/repository'
import type { Timesheet } from '@/app/types'
import { escapeCsvCell } from '@/lib/csv'
import { reportingDeps } from '@/lib/db/reporting'
import { listReportCsvPage, resolveReportExportScope } from '@/lib/domain/reporting'
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
  const deps = reportingDeps()
  const { filters, filename } = resolveReportExportScope(actor, query, deps)

  let totalCount: number | null = null
  let firstRows: Timesheet[] = []
  if (opts.preflight) {
    const firstPage = await listReportCsvPage(
      actor,
      filters,
      { from: 0, to: CSV_PAGE_SIZE - 1, includeCount: true },
      deps
    )
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
          const listResult = await listReportCsvPage(
            actor,
            filters,
            { from: offset, to: offset + CSV_PAGE_SIZE - 1, includeCount: false },
            deps
          )
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
