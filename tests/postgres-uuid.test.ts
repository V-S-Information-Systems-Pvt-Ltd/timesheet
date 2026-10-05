import { describe, expect, it } from 'vitest'
import { normalizePostgresUuid } from '@/lib/db/postgres-uuid'

const canonical = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'
const hex = canonical.replaceAll('-', '')

describe('PostgreSQL UUID text normalization', () => {
  it('accepts every optional four-digit separator combination, case and balanced braces', () => {
    const groups = hex.match(/.{4}/g)!
    for (let separators = 0; separators < 128; separators++) {
      const spelling = groups.map((group, index) => group + (index < 7 && (separators & (1 << index)) ? '-' : '')).join('')
      for (const text of [spelling, spelling.toUpperCase()]) {
        expect(normalizePostgresUuid(text)).toBe(canonical)
        expect(normalizePostgresUuid(`{${text}}`)).toBe(canonical)
      }
    }
  })

  it('does not impose UUID version or variant restrictions', () => {
    expect(normalizePostgresUuid('00000000000000000000000000000000')).toBe('00000000-0000-0000-0000-000000000000')
    expect(normalizePostgresUuid('ffffffffffffffffffffffffffffffff')).toBe('ffffffff-ffff-ffff-ffff-ffffffffffff')
  })

  it('rejects a separator at every unsupported digit position', () => {
    for (let offset = 0; offset <= hex.length; offset++) {
      if (offset > 0 && offset < hex.length && offset % 4 === 0) continue
      expect(normalizePostgresUuid(hex.slice(0, offset) + '-' + hex.slice(offset))).toBeNull()
    }
  })

  it.each([
    '', 'not-a-uuid', hex.slice(1), hex + '0', hex.replace('a', 'g'),
    `{${canonical}`, `${canonical}}`, `{{${canonical}}}`, `${canonical}-`,
    canonical.replace('-', '--'), ` ${canonical}`, `${canonical} `,
    `${canonical}\n`, `${canonical}\r\n`, `${canonical}\0`,
    `{${canonical}}\n`, null, undefined, 42, {}, [],
  ].map((value) => ({ value })))('rejects malformed input $value', ({ value }) => {
    expect(normalizePostgresUuid(value)).toBeNull()
  })
})
