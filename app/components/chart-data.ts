export interface HoursPoint {
  label: string
  hours: number
}

/** Only loaded, logged dates: do not invent zero-hour days for paginated data. */
export function dailyHours(rows: ReadonlyArray<{ log_date: string; hours_worked: number }>): HoursPoint[] {
  const totals = new Map<string, number>()
  for (const row of rows) {
    totals.set(row.log_date, (totals.get(row.log_date) ?? 0) + Number(row.hours_worked))
  }
  return [...totals.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, hours]) => ({ label, hours: Math.round(hours * 100) / 100 }))
}
