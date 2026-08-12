// lib/csv.ts
// CSV building and download helpers shared by the dashboard and reports.
// Pure parts (escapeCsvCell, buildCsv) are unit-tested; downloadCSV is the
// DOM-touching wrapper.

export function escapeCsvCell(value: string | number): string {
  const s = String(value)
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

export function buildCsv(headers: string[], rows: (string | number)[][]): string {
  return [headers, ...rows].map(r => r.map(escapeCsvCell).join(',')).join('\n')
}

export function downloadCSV(filename: string, headers: string[], rows: (string | number)[][]) {
  const csv = buildCsv(headers, rows)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(link.href), 0)
}
