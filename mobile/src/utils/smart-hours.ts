import type { TimesheetEntry } from '../api/contracts';

export interface LogEntry {
  log_date: string;
  hours_worked: number;
}

/**
 * Compute the most common hours value from the user's recent weekday entries.
 *
 * Heuristic:
 *   1. Keep only weekday entries (Mon–Fri).
 *   2. Count frequency of each distinct, positive, ≤24 hours value.
 *   3. Return the mode only when it appears in at least `minConsensus` entries
 *      (default 2) — otherwise there is no clear pattern to suggest.
 *
 * @returns the suggested hours value, or null when no pattern is found.
 */
export function computeSmartHours(
  entries: LogEntry[],
  minConsensus = 2
): number | null {
  const weekdays = entries.filter((e) => {
    const d = new Date(e.log_date + 'T00:00:00');
    if (Number.isNaN(d.getTime())) return false;
    const dow = d.getDay();
    return dow >= 1 && dow <= 5;
  });

  if (weekdays.length < 2) return null;

  const freq = new Map<number, number>();
  for (const w of weekdays) {
    const h = Number(w.hours_worked);
    if (Number.isFinite(h) && h > 0 && h <= 24) {
      freq.set(h, (freq.get(h) ?? 0) + 1);
    }
  }

  let mode = 0;
  let maxCount = 0;
  for (const [h, count] of freq) {
    if (count > maxCount || (count === maxCount && h > mode)) {
      mode = h;
      maxCount = count;
    }
  }

  if (maxCount < minConsensus) return null;
  return mode;
}

export function timesheetToLogEntry(t: TimesheetEntry): LogEntry {
  return { log_date: t.log_date, hours_worked: Number(t.hours_worked) };
}
