// lib/work-calendar.ts
// Sri Lanka holiday calendar and the working-hour arithmetic used by reports.
// Source: Central Bank of Sri Lanka bank-holiday lists (cbsl.gov.lk), which
// mark Mercantile (M) holidays per the Holidays Act gazette for each year.
// ponytail: static table — add the next year's list when it is gazetted
// (usually mid-year); years without data fall back to weekends only.

export const STANDARD_DAY_HOURS = 8

export interface Holiday {
  date: string
  name: string
  /** Mercantile holidays are paid days off for private-sector staff. */
  mercantile: boolean
}

const H = (date: string, name: string, mercantile = false): Holiday => ({ date, name, mercantile })

export const SRI_LANKA_HOLIDAYS: readonly Holiday[] = [
  // 2025
  H('2025-01-13', 'Duruthu Full Moon Poya Day'),
  H('2025-01-14', 'Tamil Thai Pongal Day', true),
  H('2025-02-04', 'Independence Day', true),
  H('2025-02-12', 'Navam Full Moon Poya Day'),
  H('2025-02-26', 'Mahasivarathri Day'),
  H('2025-03-13', 'Medin Full Moon Poya Day'),
  H('2025-03-31', 'Id-Ul-Fitr (Ramazan Festival Day)'),
  H('2025-04-12', 'Bak Full Moon Poya Day'),
  H('2025-04-13', 'Day prior to Sinhala & Tamil New Year Day', true),
  H('2025-04-14', 'Sinhala & Tamil New Year Day', true),
  H('2025-04-18', 'Good Friday'),
  H('2025-05-01', "May Day (International Workers' Day)", true),
  H('2025-05-12', 'Vesak Full Moon Poya Day'),
  H('2025-05-13', 'Day following Vesak Full Moon Poya Day', true),
  H('2025-06-07', 'Id-Ul-Alha (Hadji Festival Day)'),
  H('2025-06-10', 'Poson Full Moon Poya Day'),
  H('2025-07-10', 'Esala Full Moon Poya Day'),
  H('2025-08-08', 'Nikini Full Moon Poya Day'),
  H('2025-09-05', "Milad-Un-Nabi (Holy Prophet's Birthday)", true),
  H('2025-09-07', 'Binara Full Moon Poya Day'),
  H('2025-10-06', 'Vap Full Moon Poya Day'),
  H('2025-10-20', 'Deepavali Festival Day'),
  H('2025-11-05', 'Ill Full Moon Poya Day'),
  H('2025-12-04', 'Unduvap Full Moon Poya Day'),
  H('2025-12-25', 'Christmas Day', true),
  // 2026
  H('2026-01-03', 'Duruthu Full Moon Poya Day'),
  H('2026-01-15', 'Tamil Thai Pongal Day', true),
  H('2026-02-01', 'Navam Full Moon Poya Day'),
  H('2026-02-04', 'Independence Day', true),
  H('2026-02-15', 'Mahasivarathri Day'),
  H('2026-03-02', 'Medin Full Moon Poya Day'),
  H('2026-03-21', 'Id-Ul-Fitr (Ramazan Festival Day)'),
  H('2026-04-01', 'Bak Full Moon Poya Day'),
  H('2026-04-03', 'Good Friday'),
  H('2026-04-13', 'Day prior to Sinhala & Tamil New Year Day', true),
  H('2026-04-14', 'Sinhala & Tamil New Year Day', true),
  H('2026-05-01', "Vesak Full Moon Poya Day · May Day", true),
  H('2026-05-02', 'Day following Vesak Full Moon Poya Day', true),
  H('2026-05-28', 'Id-Ul-Alha (Hadji Festival Day)'),
  H('2026-05-30', 'Adhi Poson Full Moon Poya Day'),
  H('2026-06-29', 'Poson Full Moon Poya Day'),
  H('2026-07-29', 'Esala Full Moon Poya Day'),
  H('2026-08-26', "Milad-Un-Nabi (Holy Prophet's Birthday)", true),
  H('2026-08-27', 'Nikini Full Moon Poya Day'),
  H('2026-09-26', 'Binara Full Moon Poya Day'),
  H('2026-10-25', 'Vap Full Moon Poya Day'),
  H('2026-11-08', 'Deepawali Festival Day'),
  H('2026-11-24', 'Ill Full Moon Poya Day'),
  H('2026-12-23', 'Unduwap Full Moon Poya Day'),
  H('2026-12-25', 'Christmas Day', true),
  // 2027
  H('2027-01-15', 'Tamil Thai Pongal Day', true),
  H('2027-01-22', 'Duruthu Full Moon Poya Day'),
  H('2027-02-04', 'Independence Day', true),
  H('2027-02-20', 'Navam Full Moon Poya Day'),
  H('2027-03-06', 'Mahasivarathri Day'),
  H('2027-03-10', 'Eid-Ul-Fitr (Ramazan Festival Day)'),
  H('2027-03-22', 'Medin Full Moon Poya Day'),
  H('2027-03-26', 'Good Friday'),
  H('2027-04-13', 'Day prior to Sinhala & Tamil New Year Day', true),
  H('2027-04-14', 'Sinhala & Tamil New Year Day', true),
  H('2027-04-20', 'Bak Full Moon Poya Day'),
  H('2027-05-01', "May Day (International Workers' Day)", true),
  H('2027-05-17', 'Eid-Ul-Alha (Hadji Festival Day)'),
  H('2027-05-19', 'Vesak Full Moon Poya Day'),
  H('2027-05-20', 'Day following Vesak Full Moon Poya Day', true),
  H('2027-06-18', 'Poson Full Moon Poya Day'),
  H('2027-07-18', 'Esala Full Moon Poya Day'),
  H('2027-08-15', "Milad-Un-Nabi (Holy Prophet's Birthday)", true),
  H('2027-08-16', 'Nikini Full Moon Poya Day'),
  H('2027-09-15', 'Binara Full Moon Poya Day'),
  H('2027-10-15', 'Vap Full Moon Poya Day'),
  H('2027-10-28', 'Deepawali Festival Day'),
  H('2027-11-13', 'Ill Full Moon Poya Day'),
  H('2027-12-13', 'Unduwap Full Moon Poya Day'),
  H('2027-12-25', 'Christmas Day', true),
]

const MERCANTILE = new Set(SRI_LANKA_HOLIDAYS.filter(h => h.mercantile).map(h => h.date))

export function holidaysInYear(year: number): Holiday[] {
  return SRI_LANKA_HOLIDAYS.filter(h => h.date.startsWith(`${year}-`))
}

/** Iterate ISO dates in [start, end] (UTC arithmetic, no timezone drift). */
function eachDate(start: string, end: string, visit: (iso: string, weekday: number) => void) {
  const d = new Date(`${start}T00:00:00Z`)
  const last = new Date(`${end}T00:00:00Z`)
  for (; d <= last; d.setUTCDate(d.getUTCDate() + 1)) visit(d.toISOString().slice(0, 10), d.getUTCDay())
}

/** Monday–Friday dates in range that are not mercantile holidays. */
export function workingDays(start: string, end: string): string[] {
  const days: string[] = []
  eachDate(start, end, (iso, weekday) => {
    if (weekday !== 0 && weekday !== 6 && !MERCANTILE.has(iso)) days.push(iso)
  })
  return days
}

export function expectedHours(start: string, end: string): number {
  return workingDays(start, end).length * STANDARD_DAY_HOURS
}

/** Hours above the standard day, summed per day: a 10h day counts 2h. */
export function afterOfficeHours(rows: Array<{ log_date: string; hours_worked: number }>): number {
  const byDay = new Map<string, number>()
  for (const r of rows) byDay.set(r.log_date, (byDay.get(r.log_date) ?? 0) + Number(r.hours_worked))
  let extra = 0
  for (const total of byDay.values()) extra += Math.max(0, total - STANDARD_DAY_HOURS)
  return extra
}

/** Leave days count as a standard working day toward entered hours. */
export function leaveHours(leaveDates: string[], start: string, end: string): number {
  return new Set(leaveDates.filter(d => d >= start && d <= end)).size * STANDARD_DAY_HOURS
}
