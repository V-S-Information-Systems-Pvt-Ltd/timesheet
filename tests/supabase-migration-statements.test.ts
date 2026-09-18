import { describe, expect, it } from 'vitest'
import { matchesRecordedMigrationStatements } from '@/scripts/supabase-migration-statements.mjs'

const source = "-- Published migration\r\nselect 1;\r\n\r\nselect 'a b';\r\n"
const recorded = ['-- Published migration\nselect 1', "select 'a b'"]

describe('Supabase recorded migration statement parity', () => {
  it('accepts the CLI statement boundaries and CRLF/LF differences', () => {
    expect(matchesRecordedMigrationStatements(source, recorded)).toBe(true)
  })

  it('rejects changed SQL, comments, string contents, and statement order', () => {
    expect(matchesRecordedMigrationStatements(source, [recorded[0], "select 'a  b'"])).toBe(false)
    expect(matchesRecordedMigrationStatements(source, [recorded[1], recorded[0]])).toBe(false)
    expect(matchesRecordedMigrationStatements(source.replace('Published', 'Altered'), recorded)).toBe(false)
    expect(matchesRecordedMigrationStatements(source.replace('select 1', 'select 2'), recorded)).toBe(false)
  })

  it('fails closed when history has no recorded statements', () => {
    expect(matchesRecordedMigrationStatements(source, null)).toBe(false)
    expect(matchesRecordedMigrationStatements(source, [])).toBe(false)
  })
})
