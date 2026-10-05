// tests/migration-schema-matrix.test.ts
// C00/C01 guard: the canonical entity matrix in lib/migration/format.ts (via
// schema.ts fingerprints) is derived by hand, and the fingerprint tests build
// catalogs from the same spec — so plain drift from the real migrations could
// never fail a test. This suite parses the applied migration SQL of BOTH
// providers and asserts the matrix still matches the deployed column surface:
// every live column is either in the bundle contract or an explicitly excluded
// provider-internal column, and every contract column exists on both providers.

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ENTITY_ORDER, entitySpec } from '@vsis/migration-tool/format'
import { CURRENT_APPLICATION_RELEASE, EXCLUDED_LIVE_COLUMNS, REQUIRED_MIGRATIONS, isSupportedApplicationRelease, isSupportedApplicationTransition } from '@vsis/migration-tool/schema'

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const NATIVE_DIR = join(REPOSITORY_ROOT, 'db', 'migrations')
const SUPABASE_DIR = join(REPOSITORY_ROOT, 'supabase', 'migrations')

describe('directional application compatibility', () => {
  const providers = ['native', 'supabase'] as const
  const releases = ['1.0.3', '1.1.6', '9.9.9']
  const cases = providers.flatMap(sourceProvider => providers.flatMap(targetProvider =>
    releases.flatMap(sourceRelease => releases.map(targetRelease => ({
      sourceProvider, targetProvider, sourceRelease, targetRelease,
    })))
  ))

  it.each(cases)('$sourceProvider $sourceRelease to $targetProvider $targetRelease', ({ sourceProvider, targetProvider, sourceRelease, targetRelease }) => {
    const admitted = [
      'native:1.0.3->native:1.0.3',
      'native:1.0.3->supabase:1.0.3',
      'supabase:1.0.3->native:1.0.3',
      'supabase:1.0.3->supabase:1.0.3',
      'supabase:1.0.3->native:1.1.6',
    ]
    expect(isSupportedApplicationTransition(
      { provider: sourceProvider, applicationVersion: sourceRelease },
      { provider: targetProvider, applicationVersion: targetRelease }
    )).toBe(admitted.includes(`${sourceProvider}:${sourceRelease}->${targetProvider}:${targetRelease}`))
  })

  it('keeps the default and source export admission at 1.0.3 without requiring the rehearsal index', () => {
    expect(CURRENT_APPLICATION_RELEASE).toBe('1.0.3')
    expect(isSupportedApplicationRelease('1.0.3')).toBe(true)
    expect(isSupportedApplicationRelease('1.1.6')).toBe(false)
    expect(REQUIRED_MIGRATIONS.native).not.toContain('0038_timesheet_list_sort_index.sql')
  })

  it('refuses unknown providers even for the legacy equal-release pair', () => {
    const known = { provider: 'native', applicationVersion: '1.0.3' }
    const unknown = { provider: 'unknown', applicationVersion: '1.0.3' }
    expect(isSupportedApplicationTransition(unknown, known)).toBe(false)
    expect(isSupportedApplicationTransition(known, unknown)).toBe(false)
  })
})

const CONSTRAINT_KEYWORDS = new Set(['primary', 'unique', 'check', 'foreign', 'constraint', 'exclude'])

function sqlOf(dir: string): string {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => readFileSync(join(dir, name), 'utf8'))
    .join('\n')
}

/** Column names a `create table public.<table> (...)` block declares. */
function columnsFromCreateBlock(sql: string, table: string): string[] {
  const lines = sql.split('\n')
  const opener = new RegExp(`^create table (?:if not exists )?public\\.${table} \\($`, 'i')
  const columns: string[] = []
  let inside = false
  for (const line of lines) {
    if (!inside) {
      if (opener.test(line.trim())) inside = true
      continue
    }
    if (line.trim() === ');') break
    const match = /^\s*([a-z_][a-z0-9_]*)\b/.exec(line)
    if (match && !CONSTRAINT_KEYWORDS.has(match[1])) columns.push(match[1])
  }
  return columns
}

/** Live columns of one table across one provider's migration tree, honoring drops. */
function liveColumns(sql: string, table: string): Set<string> {
  const columns = new Set(columnsFromCreateBlock(sql, table))
  // One `alter table` statement can carry several add/drop column clauses, so
  // scan every clause inside each statement that targets the table.
  const tablePattern = new RegExp(`alter table (?:if exists )?public\\.${table}\\b`, 'i')
  for (const statement of sql.split(';')) {
    if (!tablePattern.test(statement)) continue
    for (const match of statement.matchAll(/add column (?:if not exists )?([a-z_][a-z0-9_]*)/gi)) {
      columns.add(match[1].toLowerCase())
    }
    for (const match of statement.matchAll(/drop column (?:if exists )?([a-z_][a-z0-9_]*)/gi)) {
      columns.delete(match[1].toLowerCase())
    }
  }
  return columns
}

describe('migration schema matrix matches the applied migrations', () => {
  const nativeSql = sqlOf(NATIVE_DIR)
  const supabaseSql = sqlOf(SUPABASE_DIR)

  it('parses both migration trees (guards against a mis-pointed scanner)', () => {
    expect(nativeSql).toContain('create table public.profiles')
    expect(supabaseSql).toContain('create table public.profiles')
  })

  for (const provider of ['native', 'supabase'] as const) {
    const sql = provider === 'native' ? nativeSql : supabaseSql

    it(`${provider}: every live column is in the contract or explicitly excluded`, () => {
      const unexplained: string[] = []
      for (const entity of ENTITY_ORDER) {
        const spec = entitySpec(entity)
        const specNames = new Set(spec.columns.map((column) => column.name))
        for (const column of liveColumns(sql, entity)) {
          if (specNames.has(column)) continue
          if (EXCLUDED_LIVE_COLUMNS.has(`${entity}.${column}`)) continue
          unexplained.push(`${entity}.${column}`)
        }
      }
      expect(unexplained, `Unexplained live columns on ${provider}:\n${unexplained.join('\n')}`).toEqual([])
    })

    it(`${provider}: every contract column exists in the deployed schema`, () => {
      const missing: string[] = []
      for (const entity of ENTITY_ORDER) {
        const live = liveColumns(sql, entity)
        for (const column of entitySpec(entity).columns) {
          if (!live.has(column.name)) missing.push(`${entity}.${column.name}`)
        }
      }
      expect(missing, `Contract columns missing from ${provider}:\n${missing.join('\n')}`).toEqual([])
    })
  }

  it('every required migration in the ledger check exists on disk', () => {
    // REQUIRED_MIGRATIONS gates preflight/plan/export; without this tie a
    // renamed or deleted migration file would only fail against a real database.
    const native = new Set(readdirSync(NATIVE_DIR))
    const supabase = new Set(readdirSync(SUPABASE_DIR))
    for (const name of REQUIRED_MIGRATIONS.native) {
      expect(native.has(name), `required native migration is missing: ${name}`).toBe(true)
    }
    for (const version of REQUIRED_MIGRATIONS.supabase) {
      const found = [...supabase].some((name) => name === `${version}.sql` || name.startsWith(`${version}_`))
      expect(found, `required supabase migration is missing: ${version}`).toBe(true)
    }
  })

  it('provider-internal columns stay excluded from the bundle contract', () => {
    const specColumns = new Set(
      ENTITY_ORDER.flatMap((entity) => entitySpec(entity).columns.map((column) => `${entity}.${column.name}`))
    )
    for (const excluded of EXCLUDED_LIVE_COLUMNS) {
      expect(specColumns.has(excluded)).toBe(false)
    }
  })
})
// migrations/tool/tests/migration-schema-matrix.test.ts
