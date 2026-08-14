import { describe, expect, it } from 'vitest'
import {
  isNonEmpty,
  isOneOf,
  isReasonableHours,
  isValidISODate,
  isWithinBackfillWindow,
  minLogDateISO,
  backfillMinDate,
  firstOfMonthISO,
  type BackfillSettings,
} from '../lib/validation'

describe('isValidISODate', () => {
  it('accepts real dates', () => {
    expect(isValidISODate('2024-06-15')).toBe(true)
  })
  it('rejects rolled-over dates', () => {
    expect(isValidISODate('2024-02-31')).toBe(false)
  })
  it('rejects malformed and non-string input', () => {
    expect(isValidISODate('15-06-2024')).toBe(false)
    expect(isValidISODate('not-a-date')).toBe(false)
    expect(isValidISODate('')).toBe(false)
    expect(isValidISODate(123)).toBe(false)
  })
})

describe('isReasonableHours', () => {
  it('accepts 0 < h <= 24', () => {
    expect(isReasonableHours(0.25)).toBe(true)
    expect(isReasonableHours(8)).toBe(true)
    expect(isReasonableHours(24)).toBe(true)
  })
  it('rejects out-of-range and non-number input', () => {
    expect(isReasonableHours(0)).toBe(false)
    expect(isReasonableHours(-1)).toBe(false)
    expect(isReasonableHours(24.5)).toBe(false)
    expect(isReasonableHours(NaN)).toBe(false)
    expect(isReasonableHours('8')).toBe(false)
  })
})

describe('isNonEmpty / isOneOf', () => {
  it('isNonEmpty ignores surrounding whitespace', () => {
    expect(isNonEmpty('  hi ')).toBe(true)
    expect(isNonEmpty('   ')).toBe(false)
    expect(isNonEmpty('')).toBe(false)
    expect(isNonEmpty(undefined)).toBe(false)
  })
  it('isOneOf restricts to the allowed set', () => {
    expect(isOneOf('admin', ['admin', 'pm', 'co', 'user'])).toBe(true)
    expect(isOneOf('root', ['admin', 'pm', 'co', 'user'])).toBe(false)
  })
})

describe('backfill window (Phase 3 scenario matrix)', () => {
  const today = '2024-06-15'
  const days = (windowDays: number): BackfillSettings => ({ mode: 'days', windowDays, extraDays: 0 })

  it('min date is exactly today - windowDays', () => {
    expect(minLogDateISO(today, 1)).toBe('2024-06-14')
    expect(minLogDateISO(today, 0)).toBe('2024-06-15')
    expect(minLogDateISO(today, 5)).toBe('2024-06-10')
  })

  it('window 1: today and yesterday are writable, older dates are not', () => {
    expect(isWithinBackfillWindow('2024-06-15', today, days(1))).toBe(true) // today
    expect(isWithinBackfillWindow('2024-06-14', today, days(1))).toBe(true) // yesterday
    expect(isWithinBackfillWindow('2024-06-13', today, days(1))).toBe(false) // out of window
  })

  it('boundary: exactly windowDays back is writable, one day more is not', () => {
    expect(isWithinBackfillWindow('2024-06-10', today, days(5))).toBe(true)
    expect(isWithinBackfillWindow('2024-06-09', today, days(5))).toBe(false)
  })

  it('window 0: only today is writable', () => {
    expect(isWithinBackfillWindow('2024-06-15', today, days(0))).toBe(true)
    expect(isWithinBackfillWindow('2024-06-14', today, days(0))).toBe(false)
  })

  it('rejects future dates', () => {
    expect(isWithinBackfillWindow('2024-06-16', today, days(1))).toBe(false)
  })

  it('clamps negative windows to 0', () => {
    expect(minLogDateISO(today, -3)).toBe('2024-06-15')
  })

  it('firstOfMonthISO returns the 1st of the month', () => {
    expect(firstOfMonthISO('2024-06-15')).toBe('2024-06-01')
    expect(firstOfMonthISO('2024-01-31')).toBe('2024-01-01')
  })

  it('month_start mode opens at (1st of month - extraDays)', () => {
    expect(backfillMinDate(today, { mode: 'month_start', windowDays: 0, extraDays: 0 })).toBe('2024-06-01')
    expect(backfillMinDate(today, { mode: 'month_start', windowDays: 0, extraDays: 5 })).toBe('2024-05-27')
  })

  it('month_start mode accepts dates back to the month boundary + extra days', () => {
    const settings: BackfillSettings = { mode: 'month_start', windowDays: 0, extraDays: 2 }
    expect(isWithinBackfillWindow('2024-05-30', today, settings)).toBe(true)
    expect(isWithinBackfillWindow('2024-05-29', today, settings)).toBe(false)
    expect(isWithinBackfillWindow('2024-06-01', today, settings)).toBe(true)
  })
})
