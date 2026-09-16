// Shared ISO business-date validation (YYYY-MM-DD). Platform-neutral: used by
// server-side schema validation and available to client feedback.

/** Returns true when `value` is a real calendar date in YYYY-MM-DD form. */
export function isValidISODate(value: unknown): value is string {
  if (typeof value !== 'string') return false
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const d = new Date(value + 'T00:00:00Z')
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value
}
