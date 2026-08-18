// lib/dates.ts
// Pure date helpers shared by server actions, pages, and tests.
// All functions work on local-time ISO dates (YYYY-MM-DD) so behavior is
// consistent between the client and server regardless of timezone.

export function toISODate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function todayISO(): string {
  return toISODate(new Date())
}

/** Add (or subtract, when negative) whole days to an ISO date string. */
export function addDaysISO(iso: string, days: number): string {
  // Parse as UTC to avoid DST edge cases where local midnight doesn't exist
  // (e.g. 2024-03-10 in America/New_York) or shifts the date.
  const d = new Date(iso + 'T00:00:00Z')
  if (Number.isNaN(d.getTime())) return iso
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Every ISO date from `from` to `to`, inclusive. */
export function rangeDates(from: string, to: string): string[] {
  const dates: string[] = []
  const cur = new Date(from + 'T00:00:00Z')
  const end = new Date(to + 'T00:00:00Z')
  while (cur <= end) {
    dates.push(cur.toISOString().slice(0, 10))
    cur.setUTCDate(cur.getUTCDate() + 1)
  }
  return dates
}

/** The next calendar month of a YYYY-MM string (e.g. 2024-12 -> 2025-01). */
export function nextMonthISO(yearMonth: string): string {
  const [y, m] = yearMonth.split('-').map(Number)
  const d = new Date(y, m - 1, 1)
  d.setMonth(d.getMonth() + 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** First day of the month `offset` months from now (0 = this month). */
export function monthStartOffset(offset: number): string {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() + offset)
  return toISODate(d)
}

/** Last day of the month `offset` months from now (0 = this month). */
export function monthEndOffset(offset: number): string {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() + offset + 1)
  d.setDate(0)
  return toISODate(d)
}

export type Preset = 'this' | 'last' | 'prev2' | 'prev3' | 'today' | 'yesterday' | 'week' | '7days' | 'custom'

/** Resolve a preset (or custom range) into concrete start/end ISO dates. */
export function presetRange(
  preset: Preset,
  customStart: string,
  customEnd: string
): { start: string; end: string } {
  if (preset === 'custom') {
    return { start: customStart || monthStartOffset(0), end: customEnd || todayISO() }
  }
  const today = todayISO()
  switch (preset) {
    case 'today':
      return { start: today, end: today }
    case 'yesterday': {
      const y = addDaysISO(today, -1)
      return { start: y, end: y }
    }
    case 'week': {
      // Compute Monday in local time to stay consistent with todayISO()
      // (which is local); a UTC-based Monday can be off by a day near
      // midnight in non-UTC zones.
      const d = new Date()
      const day = d.getDay() || 7
      d.setDate(d.getDate() - day + 1)
      return { start: toISODate(d), end: today }
    }
    case '7days':
      return { start: addDaysISO(today, -6), end: today }
  }
  const offset = preset === 'this' ? 0 : preset === 'last' ? -1 : preset === 'prev2' ? -2 : -3
  if (preset === 'this') return { start: monthStartOffset(0), end: todayISO() }
  return { start: monthStartOffset(offset), end: monthEndOffset(offset) }
}
