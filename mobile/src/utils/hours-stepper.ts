export const HOURS_STEP = 0.5;
export const HOURS_MIN = 0.5;
export const HOURS_MAX = 24;

/**
 * One tap of the hours stepper: adds `delta` to the typed value (blank or
 * unparseable counts as 0) and clamps to 0.5-24, so a minus never empties the
 * field and a plus never overshoots a day.
 */
export function stepHours(raw: string, delta: number): string {
  const current = parseFloat(raw);
  const base = Number.isFinite(current) ? current : 0;
  const next = Math.min(HOURS_MAX, Math.max(HOURS_MIN, base + delta));
  return String(Math.round(next * 100) / 100);
}
