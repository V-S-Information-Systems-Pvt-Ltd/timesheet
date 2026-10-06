import { describe, expect, it, vi } from 'vitest'
import { parseBackup, backupTimesheetKey } from '@/lib/backup'
import { reportGroupLabel, selectRows, sumHours } from '@/lib/reports'
import { formatTimesheetCsvChunk } from '@/lib/reports/csv-export'
import { resolveReportTotalsQuery } from '@/lib/domain/reporting'
import { createSupabaseReportingPersistence } from '@/lib/db/supabase/reporting'
import type { Timesheet, BackupPayload } from '@/app/types'
import type { Actor } from '@/lib/db/types'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/bearer', () => ({ getMobileSupabaseClient: () => null }))
const row = (patch: Partial<Timesheet> = {}): Timesheet => ({ id: 't', user_id: 'u', project_id: 'p', activity_type_id: null,
  log_date: '2026-10-01', hours_worked: 2, work_done: 'work', created_at: '', projects: { name: 'Alpha' }, ...patch })
const rows = [row({ activity_types: { name: 'Old R&D' } }),
  row({ entry_type: 'project', activity_code: 'research_development' }),
  row({ entry_type: 'internal', activity_code: 'research_development', project_id: null, projects: null }),
  row({ entry_type: 'support', activity_code: 'customers', project_id: null, projects: null, ticket_number: '00-A,"b"' })]
const doc = (): BackupPayload => ({ version: 2, exportedAt: '2026-10-01',
  projects: [{ name: 'Alpha', so_number: null, telegram_no: null, is_timesheet_project: true }], activityTypes: [],
  timesheets: rows.map(t => ({ email: 'u@example.com', project: t.project_id ? 'Alpha' : null, activity_type: null,
    entry_type: t.entry_type ?? null, activity_code: t.activity_code ?? null, activity_other: null, ticket_number: t.ticket_number ?? null,
    log_date: t.log_date, hours_worked: t.hours_worked, work_done: t.work_done })), leaves: [], reminders: [], globalReminders: [] })

describe('mixed-format reports', () => {
  it('includes no-project rows and keeps type-qualified R&D distinct without changing totals', async () => {
    const list = vi.fn().mockResolvedValue({ rows, count: rows.length })
    const actor = { id: 'u', email: 'u@example.com', role: 'user', permission_role: 'user', hierarchy_role: 'user', isActive: true } as Actor
    const report = createSupabaseReportingPersistence(list)
    const buckets = await report.getGroupedReportTotals(actor, { userId: 'u' }, 'activity')
    expect(buckets.map(b => b.label)).toEqual(['Legacy · Old R&D', 'Project · R&D', 'Internal · R&D', 'Support · Customers'])
    expect(buckets.reduce((sum, b) => sum + b.hours, 0)).toBe(sumHours(rows))
    expect(reportGroupLabel(rows[2], 'project')).toBe('Internal — no project')
    expect(reportGroupLabel(rows[0], 'type')).toBe('Legacy')
    expect(selectRows(rows, '2026-10-01', '2026-10-01', 'all', null, 'support', 'customers')).toEqual([rows[3]])
    expect(await report.getGroupedReportTotals(actor, { userId: 'u', entryType: 'internal' }, 'type')).toEqual([{ label: 'Internal', hours: 2, entries: 1 }])
  })
  it('validates grouping and classification filters', () => {
    const defaults = { defaultGroupBy: 'user' as const, clock: () => '2026-10-01' }
    expect(resolveReportTotalsQuery({ groupBy: 'type', entryType: 'legacy' }, defaults).ok).toBe(true)
    expect(resolveReportTotalsQuery({ entryType: 'guess' }, defaults).ok).toBe(false)
    expect(resolveReportTotalsQuery({ activityCode: 'guess' }, defaults).ok).toBe(false)
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
    expect(backupTimesheetKey('u', 'd', null, null, 2, { entry_type:'support', activity_code:'customers', activity_other:null, ticket_number: 'a|b' })).not.toBe(backupTimesheetKey('u', 'd', null, null, 2, { entry_type:'support', activity_code:'customers', activity_other: 'b', ticket_number: 'a' }))
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
