// lib/csv.ts
// CSV building and download helpers shared by the dashboard and reports.
// Pure parts (escapeCsvCell, buildCsv) are unit-tested; downloadCSV is the
// DOM-touching wrapper.

/** Cells starting with these characters are interpreted as formulas by Excel /
 *  LibreOffice (CWE-1236). Exported data includes user-entered free text, so
 *  such cells are neutralized with a leading apostrophe per the OWASP
 *  spreadsheet-injection guidance. */
const FORMULA_PREFIX = /^[=+\-@\t\r]/

export function escapeCsvCell(value: string | number): string {
  let s = String(value)
  if (FORMULA_PREFIX.test(s)) s = "'" + s
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

export function buildCsv(headers: string[], rows: (string | number)[][]): string {
  return [headers, ...rows].map(r => r.map(escapeCsvCell).join(',')).join('\n')
}

/**
 * Parse CSV text into rows of string cells. Handles quoted cells, escaped
 * quotes (""), and commas/newlines inside quotes. Pure and unit-tested.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        cell += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else {
      cell += ch
    }
  }
  row.push(cell)
  rows.push(row)

  // Drop a fully-empty row produced by a trailing newline.
  const last = rows[rows.length - 1]
  if (last && last.length === 1 && last[0] === '') rows.pop()
  return rows
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
