/**
 * Mobile date utilities.
 *
 * Pure, timezone-stable date arithmetic (toISODate/todayISO/addDaysISO) and
 * ISO-date validation are canonical in @vsis/core and shared with the web
 * server; they are re-exported here so existing mobile imports keep working.
 * Device-local presentation and mobile-specific range rules stay in this file.
 */

import { toISODate, todayISO, addDaysISO, isValidISODate } from '@vsis/core';

export { toISODate, todayISO, addDaysISO, isValidISODate };

/** Returns all ISO dates from `startStr` to `endStr` inclusive (capped at 366 days). */
export function getDatesInRange(startStr: string, endStr: string): string[] {
  const start = new Date(startStr + 'T12:00:00Z');
  const end = new Date(endStr + 'T12:00:00Z');
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) return [];

  const dates: string[] = [];
  const current = new Date(start);
  while (current <= end && dates.length <= 366) {
    dates.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}

/** Format a Date to local HTML5 datetime-local string format (YYYY-MM-DDTHH:mm). */
export function formatLocalDateTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const date = pad(d.getDate());
  const hours = pad(d.getHours());
  const minutes = pad(d.getMinutes());
  return `${year}-${month}-${date}T${hours}:${minutes}`;
}

/** Parses a local datetime string (YYYY-MM-DDTHH:mm) to UTC ISO string. */
export function parseLocalInputToIso(raw: string): string | null {
  const trimmed = raw.trim();
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;
  const [, yStr, mStr, dStr, hrStr, minStr, secStr] = match;
  const year = parseInt(yStr, 10);
  const month = parseInt(mStr, 10) - 1;
  const day = parseInt(dStr, 10);
  const hour = parseInt(hrStr, 10);
  const min = parseInt(minStr, 10);
  const sec = secStr ? parseInt(secStr, 10) : 0;

  if (month < 0 || month > 11 || day < 1 || day > 31 || hour < 0 || hour > 23 || min < 0 || min > 59) {
    return null;
  }

  const d = new Date(year, month, day, hour, min, sec);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

/** Formats an ISO date into a friendly readable label (e.g. "Mon, Oct 24, 2026"). */
export function formatDatePreview(isoDate: string): string {
  if (!isoDate) return '';
  const d = new Date(isoDate + 'T12:00:00');
  if (isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Compact readable date for space-constrained labels (e.g. a metric caption or
 * a list row's date chip), where the full "Mon, Oct 24, 2026" form does not
 * fit: "Oct 24, 2026". Echoes its input when it is not a valid ISO date, so a
 * malformed value is visible rather than mangled.
 */
export function formatDateShort(isoDate: string): string {
  if (!isValidISODate(isoDate)) return isoDate;
  const d = new Date(isoDate + 'T12:00:00');
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Compact readable date range for space-constrained labels (e.g. a metric
 * card's caption), where the full "Mon, Oct 24, 2026" form does not fit:
 * "Oct 18 – Oct 24, 2026". Falls back to the raw bounds when either is not a
 * valid ISO date, so a malformed payload is visible rather than mangled.
 */
export function formatDateRangeShort(fromISO: string, toISO: string): string {
  if (!isValidISODate(fromISO) || !isValidISODate(toISO)) return `${fromISO} – ${toISO}`;
  const short = (iso: string) =>
    new Date(iso + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const year = new Date(toISO + 'T12:00:00').getFullYear();
  return `${short(fromISO)} – ${short(toISO)}, ${year}`;
}
