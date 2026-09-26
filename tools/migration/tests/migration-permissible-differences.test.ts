// tests/migration-permissible-differences.test.ts
// C05 task 3: "define safe handling of generated columns/defaults, role-sync
// triggers, schema bootstrap rows, imported audit history, sequence/identity
// counters, and expected provider-generated fields. Declare each permissible
// difference in the contract."
//
// This suite keeps the declaration honest. The reconciliation compares canonical
// rows, so a permissible difference is by definition invisible to it; if any of
// these guards fails, the declaration is wrong and the reconciler would either
// reject a correct merge or accept a wrong one.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { MigrationFormatError, ENTITY_ORDER, canonicalizeRow, entitySpec } from '@vsis/migration-tool/format'
import { EXCLUDED_LIVE_COLUMNS } from '@vsis/migration-tool/schema'
import { profileRow, timesheetRow } from './helpers/migration-fixtures'

/** Documented permissible differences, mirrored in the C05 ledger section. */
const DECLARED_EXCLUDED_COLUMNS = [
  'profiles.mobile_password_change_started_at',
  'profiles.password_hash',
  'profiles.role',
  'profiles.session_version',
]

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url))

function migrationFile(path: string): string {
  return readFileSync(join(REPOSITORY_ROOT, path), 'utf8')
}

/** Body of a `create or replace function <name>() … $$ … $$` block. */
function functionBody(sql: string, name: string): string {
  const match = new RegExp(
    `function public\\.${name}\\(\\)[\\s\\S]*?\\$\\$([\\s\\S]*?)\\$\\$`,
    'i'
  ).exec(sql)
  if (!match) throw new Error(`function ${name} not found`)
  return match[1]
}

/** Columns a trigger assigns to `NEW.` — every write it performs on the row. */
function assignedColumns(body: string): string[] {
  return [...body.matchAll(/new\.([a-z_][a-z0-9_]*)\s*:=/gi)].map((match) => match[1].toLowerCase())
}

describe('C05 permissible differences', () => {
  it('declares exactly the columns the tooling excludes', () => {
    expect([...EXCLUDED_LIVE_COLUMNS].sort()).toEqual(DECLARED_EXCLUDED_COLUMNS)
  })

  it('keeps every excluded column out of the portable bundle contract', () => {
    for (const excluded of DECLARED_EXCLUDED_COLUMNS) {
      const [entity, column] = excluded.split('.')
      const spec = entitySpec(entity as (typeof ENTITY_ORDER)[number])
      expect(spec.columns.map((candidate) => candidate.name)).not.toContain(column)
    }
  })

  it('cannot let a provider-generated column reach a digest', () => {
    // A destination trigger may add its own column; the canonical reader throws
    // rather than silently folding it into the merged result.
    expect(() => canonicalizeRow('profiles', { ...profileRow(), password_hash: 'scrypt$…' })).toThrow(
      MigrationFormatError
    )
    expect(() => canonicalizeRow('profiles', { ...profileRow(), session_version: 7 })).toThrow(
      MigrationFormatError
    )
    expect(() =>
      canonicalizeRow('timesheets', { ...timesheetRow(), idempotency_key: 'device-mutation-1' })
    ).toThrow(MigrationFormatError)
  })

  it('keeps the legacy role-sync trigger on the excluded column in both tracks', () => {
    const files = ['db/migrations/0009_separate_roles.sql', 'supabase/migrations/20260826000000_separate_roles.sql']
    for (const file of files) {
      const body = functionBody(migrationFile(file), 'sync_legacy_role')
      // It writes exactly one column, and that column is provider-internal.
      expect(assignedColumns(body)).toEqual(['role'])
      expect(EXCLUDED_LIVE_COLUMNS.has('profiles.role')).toBe(true)
    }
  })

  it('keeps the daily-hours trigger a validator that writes nothing', () => {
    const files = [
      'db/migrations/0015_data_integrity_and_concurrency.sql',
      'supabase/migrations/20260831000000_data_integrity_and_concurrency.sql',
    ]
    for (const file of files) {
      const body = functionBody(migrationFile(file), 'check_daily_hours_limit')
      expect(body).toMatch(/raise exception/i)
      expect(assignedColumns(body)).toEqual([])
    }
  })

  it('keeps the Auth bootstrap trigger and the mobile idempotency bookkeeping outside the entity matrix', () => {
    // Bootstrap rows are profiles created from `auth.users`; the plan already
    // reconciles them (toleratedProfileIds/baselineDrift), and the idempotency
    // triggers write provider-local tables that are not bundle entities.
    const matrix = new Set<string>(ENTITY_ORDER)
    expect(matrix.has('idempotency_keys' as never)).toBe(false)
    expect(matrix.has('idempotency_effects' as never)).toBe(false)
    const supabase = migrationFile('supabase/migrations/20260810180000_profile_fields_and_roles.sql')
    expect(supabase).toMatch(/create trigger on_auth_user_created/i)
    // The bundle carries profiles, so a bootstrap profile is expected state the
    // plan reviews rather than an unexplained difference.
    expect(matrix.has('profiles')).toBe(true)
  })
})
// tools/migration/tests/migration-permissible-differences.test.ts
