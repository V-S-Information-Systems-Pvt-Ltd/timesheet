// lib/db/migrate.ts
// Idempotent SQL migration runner for the native (cloud-native) backend.
//
// Reads versioned `*.sql` files from the migrations directory in filename
// order, applies each pending file inside a transaction, and records applied
// filenames and SHA-256 checksums in `public.schema_migrations`.
// Safe to run on every startup: only files not already recorded are executed.
// Concurrency is serialized via PostgreSQL advisory locking.

import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { Pool } from 'pg'

const DEFAULT_MIGRATIONS_DIR = path.join(process.cwd(), 'db', 'migrations')
export const MIGRATION_ADVISORY_LOCK_ID = 8675309

export function migrationsDir(): string {
  return process.env.MIGRATIONS_DIR || DEFAULT_MIGRATIONS_DIR
}

export interface Migration {
  name: string
  sql: string
  checksum: string
}

export function computeChecksum(sql: string): string {
  return createHash('sha256').update(sql, 'utf8').digest('hex')
}

export function loadMigrations(dir: string = migrationsDir()): Migration[] {
  return readdirSync(dir)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .map((name) => {
      const sql = readFileSync(path.join(dir, name), 'utf8')
      return {
        name,
        sql,
        checksum: computeChecksum(sql),
      }
    })
}

/**
 * Apply any pending migrations. Returns the names of the migrations applied
 * during this call (empty if the schema is already up to date).
 * Acquires a global advisory lock during execution to prevent concurrent runners from colliding.
 */
export async function runMigrations(
  pool: Pool,
  dir: string = migrationsDir()
): Promise<string[]> {
  const lockClient = await pool.connect()
  try {
    // Acquire exclusive advisory lock for the entire migration process
    await lockClient.query('select pg_advisory_lock($1)', [MIGRATION_ADVISORY_LOCK_ID])

    await lockClient.query(`
      create table if not exists public.schema_migrations (
        name text primary key,
        applied_at timestamptz not null default now(),
        checksum text
      );
      alter table public.schema_migrations add column if not exists checksum text;
    `)

    const { rows } = await lockClient.query<{ name: string; checksum: string | null }>(
      'select name, checksum from public.schema_migrations'
    )
    const appliedMap = new Map(rows.map((row) => [row.name, row.checksum]))
    const applied: string[] = []

    for (const migration of loadMigrations(dir)) {
      if (appliedMap.has(migration.name)) {
        const recordedChecksum = appliedMap.get(migration.name)
        if (recordedChecksum && recordedChecksum !== migration.checksum) {
          throw new Error(
            `Migration checksum mismatch for "${migration.name}". Recorded: ${recordedChecksum}, Computed: ${migration.checksum}. Applied migrations must not be modified.`
          )
        }
        // Upgrade legacy schema_migrations row if checksum was null
        if (!recordedChecksum) {
          await lockClient.query(
            'update public.schema_migrations set checksum = $1 where name = $2',
            [migration.checksum, migration.name]
          )
        }
        continue
      }

      // Apply new migration in its own transaction
      const client = await pool.connect()
      try {
        await client.query('begin')
        await client.query(migration.sql)
        await client.query(
          'insert into public.schema_migrations (name, checksum) values ($1, $2)',
          [migration.name, migration.checksum]
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
  } finally {
    try {
      await lockClient.query('select pg_advisory_unlock($1)', [MIGRATION_ADVISORY_LOCK_ID])
    } catch {
      // Ignore unlock error if connection was dropped
    }
    lockClient.release()
  }
}
