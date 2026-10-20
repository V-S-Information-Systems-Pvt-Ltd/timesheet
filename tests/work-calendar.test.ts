import { describe, expect, it } from 'vitest'
import { afterOfficeHours, expectedHours, holidaysInYear, leaveHours, workingDays } from '@vsis/core'

describe('work calendar', () => {
  it('excludes weekends and mercantile holidays from working days', () => {
    // 2026-04-13/14 are mercantile (New Year); 04-11/12 a weekend; 04-03 Good Friday is not mercantile.
    expect(workingDays('2026-04-10', '2026-04-15')).toEqual(['2026-04-10', '2026-04-15'])
    expect(workingDays('2026-04-03', '2026-04-03')).toEqual(['2026-04-03'])
    expect(expectedHours('2026-04-10', '2026-04-15')).toBe(16)
  })

  it('lists the eight 2026 mercantile holidays', () => {
    expect(holidaysInYear(2026).filter(h => h.mercantile).map(h => h.date)).toEqual([
      '2026-01-15', '2026-02-04', '2026-04-13', '2026-04-14', '2026-05-01', '2026-05-02', '2026-08-26', '2026-12-25',
    ])
  })

  it('counts hours above 8 per day as after-office time', () => {
    expect(afterOfficeHours([
      { log_date: '2026-10-01', hours_worked: 6 }, { log_date: '2026-10-01', hours_worked: 4 },
      { log_date: '2026-10-02', hours_worked: 7.5 },
    ])).toBe(2)
  })

  it('counts each distinct leave day in range as a standard day', () => {
    expect(leaveHours(['2026-10-01', '2026-10-01', '2026-10-05', '2026-11-01'], '2026-10-01', '2026-10-31')).toBe(16)
  })
})
