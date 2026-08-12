import { describe, expect, it } from 'vitest'
import { buildCsv, escapeCsvCell } from '../lib/csv'

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
