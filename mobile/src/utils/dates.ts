/**
 * Pure date manipulation and formatting utilities for React Native mobile client.
 */

export function toISODate(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function todayISO(): string {
  return toISODate(new Date());
}

/** Add (or subtract, when negative) whole days to an ISO date string (YYYY-MM-DD). */
export function addDaysISO(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return iso;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

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

/** Validates if a string is a valid ISO date format (YYYY-MM-DD) and a valid calendar date. */
export function isValidISODate(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const d = new Date(iso + 'T00:00:00Z');
  if (isNaN(d.getTime())) return false;
  return d.toISOString().slice(0, 10) === iso;
}
