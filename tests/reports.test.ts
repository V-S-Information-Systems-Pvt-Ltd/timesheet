import { describe, expect, it } from 'vitest'
import { fmtHours, reportCsvRows, reportIncludesLeaves, selectRows, sumHours, timesheetCsvRows } from '../lib/reports'
import type { Timesheet } from '../app/types'

function t(over: Partial<Timesheet> = {}): Timesheet {
  return {
    id: '1',
    user_id: 'u1',
    project_id: 'p1',
    activity_type_id: null,
    log_date: '2024-06-15',
    hours_worked: 8,
    work_done: 'Did work',
    created_at: '',
    projects: { name: 'Alpha' },
    profiles: { email: 'a@x.com' },
    ...over,
  }
}

describe('sumHours', () => {
  it('sums hours, ignoring invalid numbers', () => {
    const rows = [t({ hours_worked: 8 }), t({ hours_worked: 2.5 })]
    expect(sumHours(rows)).toBe(10.5)
  })
})

describe('fmtHours', () => {
  it('rounds to at most 2 decimals', () => {
    expect(fmtHours(8)).toBe('8')
    expect(fmtHours(7.555)).toBe('7.56')
  })
})

describe('selectRows', () => {
  const rows = [
    t({ id: 'a', log_date: '2024-06-10', project_id: 'p1', user_id: 'u1' }),
    t({ id: 'b', log_date: '2024-06-15', project_id: 'p2', user_id: 'u2' }),
    t({ id: 'c', log_date: '2024-06-20', project_id: 'p1', user_id: 'u1' }),
  ]
  it('filters by date range (inclusive)', () => {
    expect(selectRows(rows, '2024-06-10', '2024-06-15', 'all', null).map(r => r.id)).toEqual(['a', 'b'])
  })
  it('filters by project and user', () => {
    expect(selectRows(rows, '2024-06-01', '2024-06-30', 'p1', 'u1').map(r => r.id)).toEqual(['a', 'c'])
  })
})

describe('reportCsvRows', () => {
  const leave = (leave_date: string, reason = 'Sick') => ({ leave_date, email: 'a@b.c', reason })

  it('writes leave as an entry with a standard day of hours and the reason', () => {
    expect(reportCsvRows([], [leave('2024-06-14')])).toEqual([['2024-06-14', 'a@b.c', 'Leave', '', '', '', '', '', 8, 'Sick']])
  })
  it('merges leave into timesheet rows by date, newest first', () => {
    const rows = [t({ id: 'a', log_date: '2024-06-15' }), t({ id: 'b', log_date: '2024-06-13' })]
    const dates = reportCsvRows(rows, [leave('2024-06-16'), leave('2024-06-14'), leave('2024-06-12')]).map(r => [r[0], r[2]])
    expect(dates).toEqual([
      ['2024-06-16', 'Leave'], ['2024-06-15', 'Legacy'], ['2024-06-14', 'Leave'], ['2024-06-13', 'Legacy'], ['2024-06-12', 'Leave'],
    ])
  })
  it('falls back to Unknown when the user has no email', () => {
    expect(reportCsvRows([], [{ leave_date: '2024-06-14', email: null, reason: '' }])[0][1]).toBe('Unknown')
  })
  it('excludes leave under project, type and activity filters only', () => {
    expect(reportIncludesLeaves({})).toBe(true)
    expect(reportIncludesLeaves({ projectId: 'p1' })).toBe(false)
    expect(reportIncludesLeaves({ entryType: 'support' })).toBe(false)
    expect(reportIncludesLeaves({ activityCode: 'customers' })).toBe(false)
  })
})

describe('timesheetCsvRows', () => {
  it('maps rows to CSV cells with fallbacks', () => {
    const rows = [t({ projects: null, profiles: null })]
    expect(timesheetCsvRows(rows)).toEqual([['2024-06-15', 'Unknown', 'Legacy', 'Unknown', '', '', '', '', 8, 'Did work']])
  })
  it('keeps the legacy activity type name under Activity', () => {
    const rows = [t({ projects: { name: 'Alpha' }, profiles: null, activity_types: { name: 'Old R&D' } })]
    expect(timesheetCsvRows(rows)[0].slice(2, 5)).toEqual(['Legacy', 'Alpha', 'Old R&D'])
  })
  it('leaves Project empty for no-project types and drops the type prefix from Activity', () => {
    const rows = [t({ projects: null, entry_type: 'support', activity_code: 'customers', customer: 'Acme', ticket_number: '00-1' })]
    expect(timesheetCsvRows(rows)[0].slice(2, 8)).toEqual(['Support', '', 'Customers', 'Acme', '00-1', ''])
  })
  it('emits only ASCII labels for a classified entry', () => {
    const rows = [t({ projects: null, entry_type: 'internal', activity_code: 'other', activity_other: 'Audit' })]
    expect(timesheetCsvRows(rows)[0].join('')).toMatch(/^[\x20-\x7e]*$/)
  })
})
