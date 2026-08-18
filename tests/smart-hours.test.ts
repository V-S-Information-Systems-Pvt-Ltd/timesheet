// tests/smart-hours.test.ts
import { describe, expect, it } from 'vitest'
import { computeSmartHours } from '../lib/smart-hours'
import type { LogEntry } from '../lib/smart-hours'

describe('computeSmartHours', () => {
  it('returns null when there are no entries', () => {
    expect(computeSmartHours([])).toBeNull()
  })

  it('returns null when there is only one entry', () => {
    const entries: LogEntry[] = [{ log_date: '2024-06-14', hours_worked: 8 }]
    expect(computeSmartHours(entries)).toBeNull()
  })

  it('returns the mode when it appears at least twice', () => {
    const entries: LogEntry[] = [
      { log_date: '2024-06-14', hours_worked: 8 },
      { log_date: '2024-06-13', hours_worked: 8 },
      { log_date: '2024-06-12', hours_worked: 8 },
    ]
    expect(computeSmartHours(entries)).toBe(8)
  })

  it('returns the most common value among ties (larger wins)', () => {
    const entries: LogEntry[] = [
      { log_date: '2024-06-14', hours_worked: 6 },
      { log_date: '2024-06-13', hours_worked: 6 },
      { log_date: '2024-06-12', hours_worked: 8 },
      { log_date: '2024-06-11', hours_worked: 8 },
    ]
    expect(computeSmartHours(entries)).toBe(8)
  })

  it('returns null when no value appears at least twice', () => {
    const entries: LogEntry[] = [
      { log_date: '2024-06-14', hours_worked: 6 },
      { log_date: '2024-06-13', hours_worked: 7 },
      { log_date: '2024-06-12', hours_worked: 8 },
    ]
    expect(computeSmartHours(entries)).toBeNull()
  })

  it('ignores weekend entries', () => {
    // 2024-06-15 is a Saturday, 2024-06-16 is a Sunday
    const entries: LogEntry[] = [
      { log_date: '2024-06-15', hours_worked: 4 },
      { log_date: '2024-06-16', hours_worked: 4 },
      { log_date: '2024-06-14', hours_worked: 8 },
      { log_date: '2024-06-13', hours_worked: 8 },
    ]
    expect(computeSmartHours(entries)).toBe(8)
  })

  it('ignores zero or out-of-range hours', () => {
    const entries: LogEntry[] = [
      { log_date: '2024-06-14', hours_worked: 0 },
      { log_date: '2024-06-13', hours_worked: 0 },
      { log_date: '2024-06-12', hours_worked: 8 },
      { log_date: '2024-06-11', hours_worked: 8 },
    ]
    expect(computeSmartHours(entries)).toBe(8)
  })

  it('respects a custom minConsensus threshold', () => {
    const entries: LogEntry[] = [
      { log_date: '2024-06-14', hours_worked: 8 },
      { log_date: '2024-06-13', hours_worked: 6 },
      { log_date: '2024-06-12', hours_worked: 8 },
    ]
    expect(computeSmartHours(entries, 3)).toBeNull()
    expect(computeSmartHours(entries, 2)).toBe(8)
  })
})
