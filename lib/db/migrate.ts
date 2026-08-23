// lib/db/migrate.ts
// TypeScript wrapper over the canonical plain-JS migration runner in
// db/migrate-runner.mjs. The runner is shared with db/seed.mjs (which runs
// with plain Node in the minimal runtime container), so both entry points
// execute the identical advisory-lock / checksum / legacy-upgrade logic;
// this module only adds TypeScript signatures. See migrate-runner.mjs for the
// behavior contract.

import type { Pool } from 'pg'
import {
  computeChecksum as computeChecksumImpl,
  loadMigrations as loadMigrationsImpl,
  runMigrations as runMigrationsImpl,
  MIGRATION_ADVISORY_LOCK_ID,
  migrationsDir,
} from '../../db/migrate-runner.mjs'

export interface Migration {
  name: string
  sql: string
  checksum: string
}

export { MIGRATION_ADVISORY_LOCK_ID, migrationsDir }

export function computeChecksum(sql: string): string {
  return computeChecksumImpl(sql)
}

export function loadMigrations(dir: string = migrationsDir()): Migration[] {
  return loadMigrationsImpl(dir) as Migration[]
}

export async function runMigrations(
  pool: Pool,
  dir: string = migrationsDir()
): Promise<string[]> {
  return runMigrationsImpl(pool, dir)
}