// lib/validation.ts
// Small, dependency-free validators used by the server actions and the
// backfill-window logic. Pure functions so they are unit-testable.

import { addDaysISO } from './dates'

export function isNonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/** Strict YYYY-MM-DD check that also rejects rolled-over dates like 2024-02-31. */
export function isValidISODate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const d = new Date(value + 'T00:00:00')
  if (Number.isNaN(d.getTime())) return false
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}` === value
}

export function isReasonableHours(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 24
}

export function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
}

/* ------------------------------------------------------------------ */
/* Backfill window                                                     */
/* ------------------------------------------------------------------ */

export type BackfillMode = 'days' | 'month_start'

export interface BackfillSettings {
  mode: BackfillMode
  windowDays: number
  extraDays: number
}

/** First day of the month of an ISO date (e.g. 2024-06-15 -> 2024-06-01). */
export function firstOfMonthISO(iso: string): string {
  return iso.slice(0, 8) + '01'
}

/** The earliest writable date for a given window (today - windowDays). */
export function minLogDateISO(today: string, windowDays: number): string {
  return addDaysISO(today, -Math.max(0, Math.floor(windowDays)))
}

/**
 * Earliest writable date for a window settings object:
 *   * 'days'         -> today - windowDays
 *   * 'month_start'  -> (first of the current month) - extraDays
 */
export function backfillMinDate(today: string, settings: BackfillSettings): string {
  if (settings.mode === 'month_start') {
    return addDaysISO(firstOfMonthISO(today), -Math.max(0, Math.floor(settings.extraDays)))
  }
  return minLogDateISO(today, settings.windowDays)
}

/**
 * A log date is writable when it falls inside [min, today].
 * Default settings (days, 1) means today + yesterday are writable.
 */
export function isWithinBackfillWindow(
  dateISO: string,
  today: string,
  settings: BackfillSettings
): boolean {
  const min = backfillMinDate(today, settings)
  return dateISO >= min && dateISO <= today
}
