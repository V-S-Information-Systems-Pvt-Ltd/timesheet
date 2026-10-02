import { describe, expect, it } from 'vitest'
import { dailyHours } from '@/app/components/chart-data'

describe('daily report hours', () => {
  it('sums duplicate dates, sorts chronologically, and does not mutate input', () => {
    const rows = [
      { log_date: '2026-10-03', hours_worked: 2 },
      { log_date: '2026-10-01', hours_worked: 1.1 },
      { log_date: '2026-10-01', hours_worked: 2.2 },
    ]
    expect(dailyHours(rows)).toEqual([
      { label: '2026-10-01', hours: 3.3 },
      { label: '2026-10-03', hours: 2 },
    ])
    expect(rows[0].log_date).toBe('2026-10-03')
  })

  it('returns no points for an empty or failed-to-load dataset', () => {
    expect(dailyHours([])).toEqual([])
  })

  it('does not turn unloaded or unlogged days into zero-hour observations', () => {
    expect(dailyHours([{ log_date: '2026-10-01', hours_worked: 4 }, { log_date: '2026-10-03', hours_worked: 6 }])).toEqual([
      { label: '2026-10-01', hours: 4 },
      { label: '2026-10-03', hours: 6 },
    ])
  })
})
