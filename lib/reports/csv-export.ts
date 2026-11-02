// lib/reports/csv-export.ts
// Pure CSV encoding helpers for report downloads and streaming exports.

import type { Timesheet } from '@/app/types'
import type { ReportLeave } from '@/lib/db/types'
import { STANDARD_DAY_HOURS } from '@vsis/core'
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

/** Leave has no project, type or activity, so any of those filters excludes it. */
export function reportIncludesLeaves(filters: { projectId?: string; entryType?: string; activityCode?: string }): boolean {
  return !filters.projectId && !filters.entryType && !filters.activityCode
}

/** A leave day counts as a standard working day, as in the reports page summary. */
export function leaveCsvRow(leave: ReportLeave): (string | number)[] {
  return [leave.leave_date, leave.email || 'Unknown', 'Leave', '', '', '', '', '', STANDARD_DAY_HOURS, leave.reason]
}

/** Merges timesheet and leave rows, both already sorted newest date first. */
export function reportCsvRows(rows: Timesheet[], leaves: ReportLeave[]): (string | number)[][] {
  const merged: (string | number)[][] = []
  let next = 0
  for (const row of rows) {
    while (next < leaves.length && leaves[next].leave_date >= row.log_date) merged.push(leaveCsvRow(leaves[next++]))
    merged.push(...timesheetCsvRows([row]))
  }
  return [...merged, ...leaves.slice(next).map(leaveCsvRow)]
}

/**
 * Encodes a page of timesheet rows into standard RFC-4180 CSV text.
 * @param rows The timesheet records to encode.
 * @param includeHeader Whether to prepend the standard header row.
 * @param leaves Leave markers to merge into the page by date.
 */
export function formatTimesheetCsvChunk(rows: Timesheet[], includeHeader = false, leaves: ReportLeave[] = []): string {
  const dataRows = reportCsvRows(rows, leaves)
  const headerPrefix = includeHeader ? [TIMESHEET_CSV_HEADERS] : []
  const all = [...headerPrefix, ...dataRows]
  if (all.length === 0) return ''
  return all.map((r) => r.map(escapeCsvCell).join(',')).join('\n') + '\n'
}
