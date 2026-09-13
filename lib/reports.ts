// lib/reports.ts
// Pure report helpers shared by the reports page and unit tests.
import type { Timesheet } from '@/app/types'
export { TIMESHEET_CSV_HEADERS, timesheetCsvRows } from '@/lib/reports/csv-export'

export function sumHours(rows: Timesheet[]): number {
  return rows.reduce((acc, t) => acc + (Number(t.hours_worked) || 0), 0)
}

export function fmtHours(n: number): string {
  return (Math.round(n * 100) / 100).toString()
}

/** Filter timesheet rows by date range, project, and user. */
export function selectRows(
  rows: Timesheet[],
  start: string,
  end: string,
  project: string,
  user: string | null
): Timesheet[] {
  return rows.filter(t =>
    t.log_date >= start &&
    t.log_date <= end &&
    (project === 'all' || t.project_id === project) &&
    (user === null || t.user_id === user)
  )
}
