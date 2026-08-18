import { describe, expect, it } from 'vitest'
import {
  addDaysISO,
  monthEndOffset,
  monthStartOffset,
  nextMonthISO,
  presetRange,
  rangeDates,
  toISODate,
  todayISO,
} from '../lib/dates'

describe('toISODate', () => {
  it('formats a date as zero-padded YYYY-MM-DD', () => {
    expect(toISODate(new Date(2024, 0, 5))).toBe('2024-01-05')
    expect(toISODate(new Date(2024, 11, 31))).toBe('2024-12-31')
  })
})

describe('addDaysISO', () => {
  it('adds days across month boundaries', () => {
    expect(addDaysISO('2024-01-31', 1)).toBe('2024-02-01')
  })
  it('subtracts days across month boundaries', () => {
    expect(addDaysISO('2024-03-01', -1)).toBe('2024-02-29') // leap year
  })
  it('is timezone-independent (UTC-based arithmetic)', () => {
    // US DST spring-forward: 2024-03-10 has no 00:00 local time in America/New_York.
    // UTC parsing must not shift or skip the date.
    expect(addDaysISO('2024-03-10', 1)).toBe('2024-03-11')
    expect(addDaysISO('2024-03-11', -1)).toBe('2024-03-10')
  })
})

describe('rangeDates', () => {
  it('returns every date inclusive', () => {
    expect(rangeDates('2024-01-30', '2024-02-02')).toEqual([
      '2024-01-30',
      '2024-01-31',
      '2024-02-01',
      '2024-02-02',
    ])
  })
  it('handles a single day', () => {
    expect(rangeDates('2024-05-05', '2024-05-05')).toEqual(['2024-05-05'])
  })
})

describe('nextMonthISO', () => {
  it('advances a normal month', () => {
    expect(nextMonthISO('2024-06')).toBe('2024-07')
  })
  it('rolls over December', () => {
    expect(nextMonthISO('2024-12')).toBe('2025-01')
  })
})

describe('month offsets', () => {
  it('this month starts on the 1st', () => {
    const now = new Date()
    const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
    expect(monthStartOffset(0)).toBe(expected)
  })
  it('last month is the previous calendar month', () => {
    const now = new Date()
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const expected = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}-01`
    expect(monthStartOffset(-1)).toBe(expected)
  })
  it('month end is the last day of the month', () => {
    const now = new Date()
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0)
    const expected = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(
      end.getDate()
    ).padStart(2, '0')}`
    expect(monthEndOffset(0)).toBe(expected)
  })
})

describe('presetRange', () => {
  it('resolves a custom range with fallbacks to this month', () => {
    const r = presetRange('custom', '', '')
    expect(r.start.endsWith('-01')).toBe(true)
    expect(r.start <= r.end).toBe(true)
  })
  it('resolves last month to a full calendar month', () => {
    const now = new Date()
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const expectedStart = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}-01`
    const r = presetRange('last', '', '')
    expect(r.start).toBe(expectedStart)
    expect(r.end >= r.start).toBe(true)
  })
})

describe('presetRange — new presets', () => {
  it('today returns today-today', () => {
    const today = todayISO()
    expect(presetRange('today', '', '')).toEqual({ start: today, end: today })
  })

  it('yesterday returns yesterday-yesterday', () => {
    const today = todayISO()
    const yesterday = addDaysISO(today, -1)
    expect(presetRange('yesterday', '', '')).toEqual({ start: yesterday, end: yesterday })
  })

  it('7days returns a 7-day window ending today', () => {
    const today = todayISO()
    const start = addDaysISO(today, -6)
    expect(presetRange('7days', '', '')).toEqual({ start, end: today })
  })

  it('week starts on Monday (UTC)', () => {
    const today = todayISO()
    const r = presetRange('week', '', '')
    const startDay = new Date(r.start + 'T00:00:00Z').getUTCDay()
    expect(startDay).toBe(1)
    expect(r.end).toBe(today)
  })

  it('week handles Sunday (start is previous Monday)', () => {
    const today = todayISO()
    const r = presetRange('week', '', '')
    if (new Date(today + 'T00:00:00Z').getUTCDay() === 0) {
      expect(r.start).toBe(addDaysISO(today, -6))
    }
    expect(r.end).toBe(today)
  })
})
