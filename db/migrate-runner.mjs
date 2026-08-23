// db/migrate-runner.mjs
// Canonical plain-JS SQL migration runner shared by `db/seed.mjs` (plain Node)
// and `lib/db/migrate.ts` (tsx). The seed script runs inside the minimal
// runtime container without tsx or TypeScript, so the runner lives here as
// plain ESM; lib/db/migrate.ts is a thin typed wrapper around it. One
// implementation means the two entry points can never drift.
//
// Behavior: reads versioned `*.sql` files from the migrations directory in
// filename order, applies each pending file inside its own transaction, and
// records name + SHA-256 checksum in `public.schema_migrations`. A global
// advisory lock serializes concurrent runners; applied migrations whose
// checksum changed from what is recorded fail loudly.

import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

export const MIGRATION_ADVISORY_LOCK_ID = 8675309

export function migrationsDir() {
  return process.env.MIGRATIONS_DIR || path.join(process.cwd(), 'db', 'migrations')
}

export function computeChecksum(sql) {
  return createHash('sha256').update(sql, 'utf8').digest('hex')
}

export function loadMigrations(dir = migrationsDir()) {
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
 * Apply any pending migrations. Returns the names applied during this call
 * (empty if the schema is already up to date). Acquires a global advisory
 * lock for the whole run to prevent concurrent runners from colliding.
 */
export async function runMigrations(pool, dir = migrationsDir()) {
  const lockClient = await pool.connect()
  try {
    await lockClient.query('select pg_advisory_lock($1)', [MIGRATION_ADVISORY_LOCK_ID])

    // The `alter ... add column if not exists` is not redundant: it upgrades a
    // pre-checksum schema_migrations table (created before the checksum column
    // existed) on first run of the hardened runner.
    await lockClient.query(`
      create table if not exists public.schema_migrations (
        name text primary key,
        applied_at timestamptz not null default now(),
        checksum text
      );
      alter table public.schema_migrations add column if not exists checksum text;
    `)

    const { rows } = await lockClient.query('select name, checksum from public.schema_migrations')
    const appliedMap = new Map(rows.map((row) => [row.name, row.checksum]))
    const applied = []

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