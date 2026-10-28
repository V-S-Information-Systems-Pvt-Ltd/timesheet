import { describe, expect, it } from 'vitest'
import { parseBackup, backupTimesheetKey, MAX_TIMESHEETS } from '@/lib/backup'
import { reportGroupLabel, selectRows } from '@/lib/reports'
import { formatTimesheetCsvChunk } from '@/lib/reports/csv-export'
import { resolveReportTotalsQuery } from '@/lib/domain/reporting'
import type { Timesheet, BackupPayload } from '@/app/types'

const row = (patch: Partial<Timesheet> = {}): Timesheet => ({ id: 't', user_id: 'u', project_id: 'p', activity_type_id: null,
  log_date: '2026-10-01', hours_worked: 2, work_done: 'work', created_at: '', projects: { name: 'Alpha' }, ...patch })
const rows = [row({ activity_types: { name: 'Old R&D' } }),
  row({ entry_type: 'project', activity_code: 'research_development' }),
  row({ entry_type: 'internal', activity_code: 'research_development', project_id: null, projects: null }),
  row({ entry_type: 'support', activity_code: 'customers', project_id: null, projects: null, ticket_number: '00-A,"b"' })]
const doc = (): BackupPayload => ({ version: 2, exportedAt: '2026-10-01',
  projects: [{ name: 'Alpha', so_number: null, is_timesheet_project: true }], activityTypes: [],
  timesheets: rows.map(t => ({ email: 'u@example.com', project: t.project_id ? 'Alpha' : null, activity_type: null,
    entry_type: t.entry_type ?? null, activity_code: t.activity_code ?? null, activity_other: null, ticket_number: t.ticket_number ?? null,
    log_date: t.log_date, hours_worked: t.hours_worked, work_done: t.work_done })), leaves: [], reminders: [], globalReminders: [] })

describe('mixed-format reports', () => {
  it('labels no-project rows and keeps type-qualified R&D distinct without changing totals', () => {
    expect(reportGroupLabel(rows[2], 'project')).toBe('Internal — no project')
    expect(reportGroupLabel(rows[0], 'type')).toBe('Legacy')
    expect(selectRows(rows, '2026-10-01', '2026-10-01', 'all', null, 'support', 'customers')).toEqual([rows[3]])
  })
  it('validates grouping and classification filters', () => {
    const defaults = { defaultGroupBy: 'user' as const, clock: () => '2026-10-01' }
    expect(resolveReportTotalsQuery({ groupBy: 'type', entryType: 'legacy' }, defaults).ok).toBe(true)
    expect(resolveReportTotalsQuery({ entryType: 'guess' }, defaults).ok).toBe(false)
    expect(resolveReportTotalsQuery({ activityCode: 'Not a code!' }, defaults).ok).toBe(false)
  })
  it('appends classification details using the existing safe CSV encoder', () => {
    const csv = formatTimesheetCsvChunk([rows[3]], true)
    expect(csv).toContain('Entry Type,Activity,Ticket Number,Other Activity')
    expect(csv).toContain('Support — no project')
    expect(csv).toContain('Support,Support · Customers,"00-A,""b""",')
  })
})

describe('backup classification versions', () => {
  it('round-trips mixed v2 data and distinct tickets, but dedupes an exact row', () => {
    const input = doc()
    input.timesheets.push({ ...input.timesheets[3], ticket_number: '00-A|different' }, { ...input.timesheets[3] })
    const parsed = parseBackup(input)
    expect(parsed.ok).toBe(true)
    expect(parsed.payload?.timesheets).toHaveLength(5)
    expect(parsed.payload?.timesheets[3].project).toBeNull()
    expect(parsed.payload?.timesheets[3].ticket_number).toBe('00-A,"b"')
    expect(parseBackup(parsed.payload).payload).toEqual(parsed.payload)
    expect(backupTimesheetKey('u', 'd', null, null, 2, { entry_type:'support', activity_code:'customers', activity_other:null, ticket_number: 'a|b', work_done: 'w' })).not.toBe(backupTimesheetKey('u', 'd', null, null, 2, { entry_type:'support', activity_code:'customers', activity_other: 'b', ticket_number: 'a', work_done: 'w' }))
  })
  it('keeps same-slot entries that differ only in work done or customer', () => {
    const input = doc()
    const base = input.timesheets[0]
    input.timesheets = [base, { ...base, work_done: 'other work' }, { ...input.timesheets[3], customer: 'Acme' }, { ...input.timesheets[3], customer: 'Globex' }]
    expect(parseBackup(input).payload?.timesheets).toHaveLength(4)
    // Keyed as restore stores work done, so an existing DB row matches its backup row.
    const key = (work_done: string) => backupTimesheetKey('u', 'd', null, null, 2, { work_done })
    expect(key('  <b>fix</b>  bug ')).toBe(key('fix bug'))
    expect(key('')).toBe(key('restored entry'))
  })
  it('restores a backup with more than 5000 timesheets but still caps the row count', () => {
    const input = doc()
    const base = input.timesheets[0]
    input.timesheets = Array.from({ length: 5001 }, (_, i) => ({ ...base, work_done: `entry ${i}` }))
    expect(parseBackup(input).payload?.timesheets).toHaveLength(5001)
    input.timesheets = Array.from({ length: MAX_TIMESHEETS + 1 }, () => base)
    expect(parseBackup(input)).toEqual({ ok: false, error: 'Backup file is too large to restore.' })
  })
  it('adapts v1 as explicit legacy rather than trusting classification fields', () => {
    const input = doc(); input.version = 1; input.timesheets = [input.timesheets[1]]
    const parsed = parseBackup(input)
    expect(parsed.payload?.timesheets[0].entry_type).toBeNull()
    expect(parsed.payload?.timesheets[0].activity_code).toBeNull()
  })
  it.each([
    { entry_type: 'support', activity_code: 'customers', project: null, ticket_number: ' ' },
    { entry_type: 'internal', activity_code: 'other', project: null, activity_other: '' },
    { entry_type: null, activity_code: 'testing' },
    { entry_type: 'internal', activity_code: 'other', project: null, activity_other: 'Reason', project_missing: true },
    { entry_type: 'project', activity_code: 'testing', project: 'Alpha', eligibility: false },
    { entry_type: 'support', activity_code: 'customers', project: 'Alpha', ticket_number: 'T' },
    { activity_code: undefined },
  ])('rejects malformed v2 rather than silently dropping details %o', patch => {
    const input = doc()
    const { project_missing, eligibility, ...fields } = patch
    Object.assign(input.timesheets[1], fields)
    if (project_missing) Reflect.deleteProperty(input.timesheets[1], 'project')
    if (eligibility === false) input.projects[0].is_timesheet_project = false
    expect(parseBackup(input).ok).toBe(false)
  })
})
