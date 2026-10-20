import { addDaysISO } from './dates'

/** Structural copy of @vsis/contracts BackfillSettings (core must not depend on contracts). */
export interface BackfillWindow {
  mode: 'days' | 'month_start'
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
export function backfillMinDate(today: string, settings: BackfillWindow): string {
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
  settings: BackfillWindow
): boolean {
  const min = backfillMinDate(today, settings)
  return dateISO >= min && dateISO <= today
}
