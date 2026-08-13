// lib/reports.ts
// Pure report helpers shared by the reports page and unit tests.
import type { Timesheet } from '@/app/types'
import { downloadCSV } from './csv'

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

export const TIMESHEET_CSV_HEADERS = ['Date', 'User', 'Project', 'Hours', 'Work Done']

export function timesheetCsvRows(rows: Timesheet[]): (string | number)[][] {
  return rows.map(t => [
    t.log_date,
    t.profiles?.email || 'Unknown',
    t.projects?.name || 'Unknown',
    t.hours_worked,
    t.work_done,
  ])
}

/** Export timesheet rows as the standard CSV report. */
export function exportTimesheetCsv(rows: Timesheet[], filename: string): void {
  downloadCSV(filename, TIMESHEET_CSV_HEADERS, timesheetCsvRows(rows))
}
