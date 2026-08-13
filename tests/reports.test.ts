import { describe, expect, it } from 'vitest'
import { fmtHours, selectRows, sumHours, timesheetCsvRows } from '../lib/reports'
import type { Timesheet } from '../app/types'

function t(over: Partial<Timesheet> = {}): Timesheet {
  return {
    id: '1',
    user_id: 'u1',
    project_id: 'p1',
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

describe('timesheetCsvRows', () => {
  it('maps rows to CSV cells with fallbacks', () => {
    const rows = [t({ projects: null, profiles: null })]
    expect(timesheetCsvRows(rows)).toEqual([['2024-06-15', 'Unknown', 'Unknown', 8, 'Did work']])
  })
})
