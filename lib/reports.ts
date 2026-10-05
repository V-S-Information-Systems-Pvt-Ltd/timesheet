// Pure report helpers shared by the reports page and unit tests.
import type { Timesheet } from '@/app/types'
import { ENTRY_TYPE_LABELS, activityDisplayLabel } from '@vsis/contracts'
import type { ActivityCode, EntryType } from '@vsis/contracts'
export { TIMESHEET_CSV_HEADERS, timesheetCsvRows } from '@/lib/reports/csv-export'

export function sumHours(rows: Timesheet[]): number {
  return rows.reduce((acc, t) => acc + (Number(t.hours_worked) || 0), 0)
}

export function fmtHours(n: number): string {
  return (Math.round(n * 100) / 100).toString()
}

export function selectRows(rows: Timesheet[], start: string, end: string, project: string, user: string | null,
  entryType?: EntryType | 'legacy', activityCode?: ActivityCode): Timesheet[] {
  return rows.filter(t => t.log_date >= start && t.log_date <= end &&
    (project === 'all' || t.project_id === project) && (user === null || t.user_id === user) &&
    matchesReportClassification(t, entryType, activityCode))
}

/** Detail fields never participate in grouping. */
export function reportGroupLabel(t: Timesheet, groupBy: 'user' | 'project' | 'activity' | 'type'): string {
  if (groupBy === 'type') return t.entry_type ? ENTRY_TYPE_LABELS[t.entry_type] : 'Legacy'
  if (groupBy === 'project') {
    if (t.entry_type === 'support' || t.entry_type === 'internal') return `${ENTRY_TYPE_LABELS[t.entry_type]} — no project`
    return t.projects?.name ?? 'Unknown project'
  }
  if (groupBy === 'activity') return t.entry_type && t.activity_code
    ? activityDisplayLabel(t.entry_type, t.activity_code)
    : `Legacy · ${t.activity_types?.name ?? '(no type)'}`
  return t.profiles?.email ?? 'Unknown'
}

export function matchesReportClassification(t: Timesheet, entryType?: EntryType | 'legacy', activityCode?: ActivityCode): boolean {
  return (!entryType || (entryType === 'legacy' ? !t.entry_type : t.entry_type === entryType)) &&
    (!activityCode || t.activity_code === activityCode)
}
