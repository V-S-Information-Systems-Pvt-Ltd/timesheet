import { describe, expect, it } from 'vitest'
import {
  isNonEmpty,
  isOneOf,
  isReasonableHours,
  isValidISODate,
  isWithinBackfillWindow,
  minLogDateISO,
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

  it('min date is exactly today - windowDays', () => {
    expect(minLogDateISO(today, 1)).toBe('2024-06-14')
    expect(minLogDateISO(today, 0)).toBe('2024-06-15')
    expect(minLogDateISO(today, 5)).toBe('2024-06-10')
  })

  it('window 1: today and yesterday are writable, older dates are not', () => {
    expect(isWithinBackfillWindow('2024-06-15', today, 1)).toBe(true) // today
    expect(isWithinBackfillWindow('2024-06-14', today, 1)).toBe(true) // yesterday
    expect(isWithinBackfillWindow('2024-06-13', today, 1)).toBe(false) // out of window
  })

  it('boundary: exactly windowDays back is writable, one day more is not', () => {
    expect(isWithinBackfillWindow('2024-06-10', today, 5)).toBe(true)
    expect(isWithinBackfillWindow('2024-06-09', today, 5)).toBe(false)
  })

  it('window 0: only today is writable', () => {
    expect(isWithinBackfillWindow('2024-06-15', today, 0)).toBe(true)
    expect(isWithinBackfillWindow('2024-06-14', today, 0)).toBe(false)
  })

  it('rejects future dates', () => {
    expect(isWithinBackfillWindow('2024-06-16', today, 1)).toBe(false)
  })

  it('clamps negative windows to 0', () => {
    expect(minLogDateISO(today, -3)).toBe('2024-06-15')
  })
})
