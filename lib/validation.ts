// lib/validation.ts
// Small, dependency-free validators used by the server actions and the
// backfill-window logic. Pure functions so they are unit-testable.

import { addDaysISO } from './dates'
import type { BackfillSettings } from '@vsis/contracts'

export type { BackfillMode, BackfillSettings } from '@vsis/contracts'

export function isNonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/** Loose email check: has a local part, an '@', and a non-empty domain. */
export function isValidEmail(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  if (!trimmed.includes('@')) return false
  const domain = trimmed.split('@')[1]
  return typeof domain === 'string' && domain.trim().length > 0
}

/** Strict YYYY-MM-DD check that also rejects rolled-over dates like 2024-02-31.
 *  Compatibility re-export: the canonical implementation lives in @vsis/core. */
export { isValidISODate } from '@vsis/core'

/** Maximum characters stored for a work_done entry. */
export const MAX_WORK_DONE_LENGTH = 2000

/**
 * Sanitize free-text input before storing: strip any HTML-like tags
 * (defence against stored XSS if rendered without escaping), collapse
 * internal whitespace runs, and trim. Keeps the length cap enforced by
 * the schema.
 */
export function sanitizeWorkDone(value: string): string {
  if (!value) return ''
  // Strip <script>...</script> blocks (including content) before removing
  // remaining HTML tags, so script payloads don't leak into the text.
  const withoutScript = value.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
  const stripped = withoutScript.replace(/<[^>]*>/g, '').trim()
  return stripped.replace(/\s+/g, ' ').slice(0, MAX_WORK_DONE_LENGTH)
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
