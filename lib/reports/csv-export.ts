// lib/reports/csv-export.ts
// Pure CSV encoding helpers for report downloads and streaming exports.

import type { Timesheet } from '@/app/types'
import { escapeCsvCell } from '@/lib/csv'

export const TIMESHEET_CSV_HEADERS = ['Date', 'User', 'Project', 'Type', 'Hours', 'Work Done'] as const

export function timesheetCsvRows(rows: Timesheet[]): (string | number)[][] {
  return rows.map((t) => [
    t.log_date,
    t.profiles?.email || 'Unknown',
    t.projects?.name || 'Unknown',
    t.activity_types?.name || 'Unknown',
    t.hours_worked,
    t.work_done,
  ])
}

/**
 * Encodes a page of timesheet rows into standard RFC-4180 CSV text.
 * @param rows The timesheet records to encode.
 * @param includeHeader Whether to prepend the standard header row.
 */
export function formatTimesheetCsvChunk(rows: Timesheet[], includeHeader = false): string {
  const dataRows = timesheetCsvRows(rows)
  const headerPrefix = includeHeader ? [TIMESHEET_CSV_HEADERS as unknown as string[]] : []
  const all = [...headerPrefix, ...dataRows]
  if (all.length === 0) return ''
  return all.map((r) => r.map(escapeCsvCell).join(',')).join('\n') + '\n'
}
