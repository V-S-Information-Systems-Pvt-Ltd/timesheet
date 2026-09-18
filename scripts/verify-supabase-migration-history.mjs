// scripts/verify-supabase-migration-history.mjs
//
// Fails when the database's recorded Supabase migration history is missing any
// version present in supabase/migrations or when migration-sensitive schema
// invariants do not match the repository's terminal state.
//
// Run it right after `supabase db reset` (or against a linked environment) to
// prove the chain applied end to end. A migration that aborts partway through,
// or that opens a transaction it never commits, drops its own history row and
// every later one — leaving a database that looks healthy but is missing
// schema. Comparing recorded statements for immutable versions, history, and
// terminal schema makes incomplete application and post-publication drift loud
// on fresh and linked databases. Rows without statements cannot prove parity.

import { readFileSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import pg from 'pg'
import { matchesRecordedMigrationStatements } from './supabase-migration-statements.mjs'

const MIGRATIONS_DIR = path.join(process.cwd(), 'supabase', 'migrations')
const IMMUTABLE_MIGRATION_HASHES = {
  '20260810160000_initial_schema.sql': '1717c831c0d375ba007362e274784223eff4eebfe6f06e49fcb1794607124e6f',
  '20260810190000_add_missing_profile_columns.sql': '6ae13188289eb11ff8f58d6b25f16c9eb9d23106cefe931c4e6b6b41f7da47f7',
  '20260923000000_idempotency_trigger_nullif_headers.sql': '530216a7c5a6336788bda467c82f7402e0deea1db44ebeda541d21d8df653b9d',
}
const dbUrl = process.env.DATABASE_URL || process.env.TEST_DATABASE_URL

if (!dbUrl) {
  console.error('DATABASE_URL or TEST_DATABASE_URL must be provided.')
  process.exit(1)
}

const localVersions = readdirSync(MIGRATIONS_DIR)
  .filter((file) => file.endsWith('.sql'))
  .map((file) => file.split('_', 1)[0])
  .sort()

if (localVersions.length === 0) {
  console.error(`No migration files found in ${MIGRATIONS_DIR}.`)
  process.exit(1)
}

const pool = new pg.Pool({ connectionString: dbUrl })

try {
  const { rows } = await pool.query('select version, statements from supabase_migrations.schema_migrations')
  const recorded = new Set(rows.map((row) => String(row.version)))
  const recordedByVersion = new Map(rows.map((row) => [String(row.version), row]))
  const failures = []

  for (const [file, expectedHash] of Object.entries(IMMUTABLE_MIGRATION_HASHES)) {
    const normalized = readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8').replace(/\r\n/g, '\n')
    const actualHash = createHash('sha256').update(normalized).digest('hex')
    if (actualHash !== expectedHash) {
      failures.push(`Immutable migration content changed: ${file}.`)
    }
    const version = file.split('_', 1)[0]
    const entry = recordedByVersion.get(version)
    if (entry && !matchesRecordedMigrationStatements(normalized, entry.statements)) {
      failures.push(`Recorded migration statements differ from the immutable file (or are unavailable): ${file}.`)
    }
  }

  const missing = localVersions.filter((version) => !recorded.has(version))
  const unknown = [...recorded].filter((version) => !localVersions.includes(version)).sort()

  if (unknown.length > 0) {
    failures.push(
      `Migration history contains ${unknown.length} recorded version(s) with no local file.`
    )
    failures.push(`Unknown: ${unknown.join(', ')}`)
  }

  if (missing.length > 0) {
    failures.push(
      `Migration history is incomplete: ${missing.length} of ${localVersions.length} local migrations have no recorded version.`
    )
    failures.push(`Missing: ${missing.join(', ')}`)
  }

  const emailColumn = await pool.query(`
    select is_nullable
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'email'
  `)

  if (emailColumn.rowCount !== 1) {
    failures.push('Schema invariant failed: public.profiles.email does not exist.')
  } else if (emailColumn.rows[0].is_nullable !== 'NO') {
    failures.push('Schema invariant failed: public.profiles.email must be NOT NULL.')
  }

  const emailUnique = await pool.query(`
    select exists (
      select 1
      from pg_catalog.pg_constraint as c
      join pg_catalog.pg_attribute as a
        on a.attrelid = c.conrelid
       and a.attname = 'email'
       and not a.attisdropped
      where c.conrelid = to_regclass('public.profiles')
        and c.contype in ('p', 'u')
        and c.conkey = array[a.attnum]::smallint[]
    ) as present
  `)

  if (!emailUnique.rows[0]?.present) {
    failures.push('Schema invariant failed: public.profiles.email must have a single-column unique constraint.')
  }

  const expectedTriggerFunctions = ['mobile_idempotency_claim', 'mobile_idempotency_commit']
  const triggerFunctions = await pool.query(
    `
      select p.proname, pg_get_functiondef(p.oid) as definition, owner.rolname as owner
      from pg_catalog.pg_proc as p
      join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
      join pg_catalog.pg_roles as owner on owner.oid = p.proowner
      where n.nspname = 'private'
        and p.proname = any($1::text[])
        and p.pronargs = 0
    `,
    [expectedTriggerFunctions]
  )
  const functionsByName = new Map(triggerFunctions.rows.map((row) => [row.proname, row]))
  const hardenedHeaders = "coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb"

  for (const name of expectedTriggerFunctions) {
    const fn = functionsByName.get(name)
    if (!fn) {
      failures.push(`Schema invariant failed: private.${name}() does not exist.`)
      continue
    }

    const normalizedDefinition = String(fn.definition).replace(/\s+/g, ' ').toLowerCase()
    if (!normalizedDefinition.includes(hardenedHeaders)) {
      failures.push(`Schema invariant failed: private.${name}() does not safely parse empty request headers.`)
    }
    if (fn.owner !== 'postgres') {
      failures.push(`Schema invariant failed: private.${name}() owner is ${fn.owner}, expected postgres.`)
    }
  }

  if (failures.length > 0) {
    for (const failure of failures) console.error(failure)
    process.exitCode = 1
  } else {
    console.log(
      `Migration and schema verification complete: all ${localVersions.length} local migrations recorded ` +
        `(latest ${localVersions[localVersions.length - 1]}); baseline reconciliation invariants satisfied.`
    )
  }
} catch (err) {
  console.error(
    'Failed to verify Supabase migration history and schema:',
    err instanceof Error ? err.message : String(err)
  )
  process.exitCode = 1
} finally {
  await pool.end()
}
