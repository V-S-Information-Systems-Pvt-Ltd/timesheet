// lib/db/pool.ts
// Native (cloud-native) PostgreSQL pool, type mapping, and migration guard.
//
// pg returns PostgreSQL types in ways that don't match the JSON shapes the app
// expects (Date objects for date/timestamps, strings for numeric). We normalize
// them here so the native adapter can map rows directly onto the domain types:
//   date        -> 'YYYY-MM-DD'
//   timestamps  -> ISO 8601 UTC strings
//   numeric     -> JS number
//
// These overrides are process-wide but safe: only the native backend uses pg.

import { Pool, types } from 'pg'
import { runMigrations } from './migrate'

types.setTypeParser(1082, (value: string) => value) // date
types.setTypeParser(1114, (value: string) => new Date(value + 'Z').toISOString()) // timestamp
types.setTypeParser(1184, (value: string) => new Date(value).toISOString()) // timestamptz
types.setTypeParser(1700, (value: string) => Number(value)) // numeric

let pool: Pool | null = null
let migration: Promise<unknown> | null = null

export function getPool(): Pool {
  if (!pool) {
    const url = process.env.DATABASE_URL
    if (!url) {
      throw new Error('DATABASE_URL is not set. Required for native mode.')
    }
    pool = new Pool({ connectionString: url, max: 10 })
  }
  return pool
}

/** Apply migrations once, then resolve (cached). */
export function ensureMigrated(): Promise<void> {
  if (!migration) {
    migration = runMigrations(getPool()).catch((err) => {
      migration = null
      throw err
    })
  }
  return migration.then(() => undefined)
}

/** Run a query after ensuring the schema is up to date. */
export async function query<T>(
  text: string,
  params?: unknown[]
): Promise<T[]> {
  await ensureMigrated()
  const { rows } = await getPool().query(text, params)
  return rows as T[]
}

/** Run `fn` inside a database transaction. Commits on success, rolls back on error. */
export async function transaction<T>(
  fn: (client: import('pg').PoolClient) => Promise<T>
): Promise<T> {
  await ensureMigrated()
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    try {
      await client.query('ROLLBACK')
    } catch {
      // Ignore rollback failure to preserve original error
    }
    throw err
  } finally {
    client.release()
  }
}

