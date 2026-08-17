import { describe, expect, it } from 'vitest'
import { buildCsv, escapeCsvCell, parseCsv } from '../lib/csv'

describe('escapeCsvCell', () => {
  it('leaves plain values untouched', () => {
    expect(escapeCsvCell('hello')).toBe('hello')
    expect(escapeCsvCell(8.5)).toBe('8.5')
    expect(escapeCsvCell('')).toBe('')
  })
  it('quotes values containing commas, quotes, or newlines', () => {
    expect(escapeCsvCell('a,b')).toBe('"a,b"')
    expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""')
    expect(escapeCsvCell('line1\nline2')).toBe('"line1\nline2"')
  })
})

describe('buildCsv', () => {
  it('joins headers and rows with commas and newlines', () => {
    const csv = buildCsv(
      ['Date', 'Hrs'],
      [
        ['2024-01-01', 8],
        ['2024-01-02', 7.5],
      ]
    )
    expect(csv).toBe('Date,Hrs\n2024-01-01,8\n2024-01-02,7.5')
  })
  it('escapes special characters in any cell', () => {
    const csv = buildCsv(['Note'], [['a,"b"']])
    expect(csv).toBe('Note\n"a,""b"""')
  })
})

describe('parseCsv', () => {
  it('parses plain rows', () => {
    expect(parseCsv('a,b\nc,d')).toEqual([['a', 'b'], ['c', 'd']])
  })

  it('handles quoted cells with commas', () => {
    expect(parseCsv('"a,b",c')).toEqual([['a,b', 'c']])
  })

  it('handles escaped quotes inside quoted cells', () => {
    expect(parseCsv('"say ""hi""",x')).toEqual([['say "hi"', 'x']])
  })

  it('handles newlines inside quoted cells', () => {
    expect(parseCsv('"line1\nline2",z')).toEqual([['line1\nline2', 'z']])
  })

  it('handles CRLF line endings and drops the trailing empty row', () => {
    expect(parseCsv('a,b\r\nc,d\r\n')).toEqual([['a', 'b'], ['c', 'd']])
  })

  it('round-trips through buildCsv', () => {
    const headers = ['Date', 'Work Done']
    const rows: (string | number)[][] = [
      ['2026-08-11', 'Issue, "check" on site'],
      ['2026-08-12', 'multi\nline'],
    ]
    const csv = buildCsv(headers, rows)
    expect(parseCsv(csv)).toEqual([headers, ...rows.map(r => r.map(String))])
  })
})
