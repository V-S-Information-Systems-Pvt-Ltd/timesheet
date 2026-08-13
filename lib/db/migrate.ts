// lib/db/migrate.ts
// Idempotent SQL migration runner for the native (cloud-native) backend.
//
// Reads versioned `*.sql` files from the migrations directory in filename
// order, applies each pending file inside a transaction, and records applied
// filenames in `public.schema_migrations`. Safe to run on every startup: only
// files not already recorded are executed.

import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { Pool } from 'pg'

const DEFAULT_MIGRATIONS_DIR = path.join(process.cwd(), 'db', 'migrations')

export function migrationsDir(): string {
  return process.env.MIGRATIONS_DIR || DEFAULT_MIGRATIONS_DIR
}

export interface Migration {
  name: string
  sql: string
}

export function loadMigrations(dir: string = migrationsDir()): Migration[] {
  return readdirSync(dir)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .map((name) => ({
      name,
      sql: readFileSync(path.join(dir, name), 'utf8'),
    }))
}

/**
 * Apply any pending migrations. Returns the names of the migrations applied
 * during this call (empty if the schema is already up to date).
 */
export async function runMigrations(
  pool: Pool,
  dir: string = migrationsDir()
): Promise<string[]> {
  await pool.query(`
    create table if not exists public.schema_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )
  `)

  const { rows } = await pool.query<{ name: string }>(
    'select name from public.schema_migrations'
  )
  const appliedSet = new Set(rows.map((row) => row.name))
  const applied: string[] = []

  for (const migration of loadMigrations(dir)) {
    if (appliedSet.has(migration.name)) continue

    const client = await pool.connect()
    try {
      await client.query('begin')
      await client.query(migration.sql)
      await client.query(
        'insert into public.schema_migrations (name) values ($1)',
        [migration.name]
      )
      await client.query('commit')
    } catch (err) {
      await client.query('rollback')
      throw err
    } finally {
      client.release()
    }
    applied.push(migration.name)
  }

  return applied
}
