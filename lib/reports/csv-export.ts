// lib/reports/csv-export.ts
// Pure CSV encoding helpers for report downloads and streaming exports.

import type { Timesheet } from '@/app/types'
import { ENTRY_TYPE_LABELS, activityLabel, requiresProject } from '@vsis/contracts'
import { escapeCsvCell } from '@/lib/csv'

export const TIMESHEET_CSV_HEADERS = ['Date', 'User', 'Type', 'Project', 'Activity', 'Customer', 'Ticket Number', 'Other Activity', 'Hours', 'Work Done']

export function timesheetCsvRows(rows: Timesheet[]): (string | number)[][] {
  return rows.map((t) => [
    t.log_date,
    t.profiles?.email || 'Unknown',
    t.entry_type ? ENTRY_TYPE_LABELS[t.entry_type] : 'Legacy',
    // Support and Internal entries have no project, so the cell stays empty.
    t.projects?.name || (t.entry_type && !requiresProject(t.entry_type) ? '' : 'Unknown'),
    t.entry_type && t.activity_code ? activityLabel(t.activity_code, t.activity_label) : t.activity_types?.name ?? '',
    t.customer ?? '',
    t.ticket_number ?? '',
    t.activity_other ?? '',
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
  const headerPrefix = includeHeader ? [TIMESHEET_CSV_HEADERS] : []
  const all = [...headerPrefix, ...dataRows]
  if (all.length === 0) return ''
  return all.map((r) => r.map(escapeCsvCell).join(',')).join('\n') + '\n'
}
