// lib/migration/providers/session.ts
// Dedicated read-only PostgreSQL session for migration export/inspection.
//
// This deliberately does NOT reuse lib/db/pool.ts: the application pool reads
// the global DATABASE_URL, applies pending migrations on first use and installs
// process-wide type parsers. A migration connector must be explicit, must never
// migrate the database it inspects, and must fail on any write attempt.
//
// Three independent guards make the source read-only:
//   1. default_transaction_read_only = on for the whole session;
//   2. a statement allowlist on the public query API;
//   3. an explicit write probe at preflight time that must be rejected.

import { Client } from 'pg'
import { ENTITY_ORDER, sha256Hex, type ProviderName } from '../format'
import type { ResolvedDatabaseTarget } from '../connections'
import type { CatalogColumn, CatalogInspection } from '../schema'
import { MigrationRunError } from '../journal'

export interface DatabaseIdentity {
  provider: ProviderName
  /** Stable provenance namespace: survives restarts, excludes endpoint aliases. */
  namespace: string
  /** Instance identity for same-server-through-alias detection within a run. */
  runtimeFingerprint: string
  database: string
  serverVersion: string
  postmasterStartedAt: string
  systemIdentifier: string | null
  displayTarget: string
}

export interface DatabaseSession {
  readonly provider: ProviderName
  readonly displayTarget: string
  identity(): Promise<DatabaseIdentity>
  query<T extends Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>
  withReadOnlyTransaction<T>(fn: () => Promise<T>): Promise<T>
  assertReadOnly(): Promise<void>
  inspectCatalog(): Promise<CatalogInspection>
  countRows(entity: string): Promise<number>
  migrationLedger(): Promise<string[]>
  close(): Promise<void>
}

/** Handle available inside the destination's single app-data transaction. */
export interface WriteTransaction {
  query<T extends Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>
}

/**
 * Destination session used by `apply`. It is only constructible for a target
 * declared as the destination, and all app-data changes must go through one
 * `transaction()` call so a failed merge leaves nothing behind.
 */
export interface WriteSession {
  readonly provider: ProviderName
  readonly displayTarget: string
  identity(): Promise<DatabaseIdentity>
  query<T extends Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>
  inspectCatalog(): Promise<CatalogInspection>
  migrationLedger(): Promise<string[]>
  transaction<T>(fn: (tx: WriteTransaction) => Promise<T>): Promise<T>
  close(): Promise<void>
}

const READ_ONLY_STATEMENT_RE = /^\s*(?:\/\*[\s\S]*?\*\/\s*|--[^\n]*\n\s*)*(select|with|show|table|values|explain)\b/i
// A `with ... insert` or `explain analyze insert` would pass the leading-keyword
// check; no migration query needs any DML/DDL keyword, so reject them outright.
const WRITE_KEYWORD_RE = /\b(insert|update|delete|merge|truncate|create|alter|drop|grant|revoke|copy|call|do)\b/i

const SESSION_SETTINGS = [
  'set default_transaction_read_only = on',
  'set statement_timeout = 120000',
  'set lock_timeout = 15000',
  "set idle_in_transaction_session_timeout = '180s'",
]

export function computeDatabaseNamespace(
  target: Pick<ResolvedDatabaseTarget, 'provider' | 'projectRef' | 'loopback' | 'displayTarget'>,
  database: string,
  systemIdentifier: string | null
): string {
  const fallbackEndpoint = target.loopback
    ? `loopback:${target.displayTarget.split(':')[1] || target.displayTarget}`
    : target.displayTarget
  return `${target.provider}:${sha256Hex(
    [
      'vsis-instance-v1',
      target.provider,
      target.projectRef ?? '',
      database,
      systemIdentifier ?? `fallback:${fallbackEndpoint}`,
    ].join('\n')
  ).slice(0, 32)}`
}

export function openReadOnlySession(target: ResolvedDatabaseTarget): DatabaseSession {
  const client = new Client({
    connectionString: target.connectionString,
    application_name: target.applicationName,
    connectionTimeoutMillis: 15000,
  })
  let connected = false

  const rawQuery = async <T extends Record<string, unknown>>(
    text: string,
    params?: unknown[]
  ): Promise<T[]> => {
    const result = await client.query(text, params)
    return result.rows as T[]
  }

  const ensureConnected = async (): Promise<void> => {
    if (connected) return
    await client.connect()
    for (const setting of SESSION_SETTINGS) await rawQuery(setting)
    connected = true
  }

  return {
    provider: target.provider,
    displayTarget: target.displayTarget,

    async identity(): Promise<DatabaseIdentity> {
      await ensureConnected()
      const [base] = await rawQuery<{
        database: string
        server_version: string
        postmaster_started_at: string
      }>(
        "select current_database() as database, current_setting('server_version') as server_version, pg_postmaster_start_time()::text as postmaster_started_at"
      )
      let systemIdentifier: string | null = null
      try {
        const probe = await rawQuery<{ system_identifier: string }>(
          'select system_identifier::text as system_identifier from pg_control_system()'
        )
        systemIdentifier = probe[0]?.system_identifier ?? null
      } catch {
        systemIdentifier = null
      }
      const fallbackEndpoint = target.loopback
        ? `loopback:${target.displayTarget.split(':')[1] || target.displayTarget}`
        : target.displayTarget
      const namespace = computeDatabaseNamespace(target, base.database, systemIdentifier)
      const runtimeFingerprint = sha256Hex(
        [
          'vsis-runtime-v1',
          target.provider,
          base.database,
          base.postmaster_started_at,
          base.server_version,
          systemIdentifier ?? `fallback:${fallbackEndpoint}`,
        ].join('\n')
      ).slice(0, 32)
      return {
        provider: target.provider,
        namespace,
        runtimeFingerprint,
        database: base.database,
        serverVersion: base.server_version,
        postmasterStartedAt: base.postmaster_started_at,
        systemIdentifier,
        displayTarget: target.displayTarget,
      }
    },

    async query<T extends Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]> {
      await ensureConnected()
      const withoutLiterals = text.replace(/'(?:[^']|'')*'/g, "''")
      if (!READ_ONLY_STATEMENT_RE.test(text) || WRITE_KEYWORD_RE.test(withoutLiterals)) {
        throw new MigrationRunError(
          'E_SESSION_WRITE_BLOCKED',
          'Migration sessions only execute read-only statements; refusing to run the supplied statement.'
        )
      }
      return rawQuery<T>(text, params)
    },

    async withReadOnlyTransaction<T>(fn: () => Promise<T>): Promise<T> {
      await ensureConnected()
      await rawQuery('begin isolation level repeatable read read only')
      try {
        return await fn()
      } finally {
        await rawQuery('rollback')
      }
    },

    async assertReadOnly(): Promise<void> {
      await ensureConnected()
      let rejected = false
      await rawQuery('begin read only')
      try {
        await rawQuery('create table public.vsis_migration_write_probe (id integer)')
      } catch {
        rejected = true
      }
      await rawQuery('rollback')
      if (!rejected) {
        throw new MigrationRunError(
          'E_SOURCE_WRITABLE',
          'Database accepted a write inside a read-only transaction; refusing to treat it as a read-only source.'
        )
      }
    },

    async inspectCatalog(): Promise<CatalogInspection> {
      await ensureConnected()
      const tableRows = await rawQuery<{ table_name: string }>(
        "select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name"
      )
      const columnRows = await rawQuery<{ table_name: string; column_name: string; udt_name: string; is_nullable: string }>(
        "select table_name, column_name, udt_name, is_nullable from information_schema.columns where table_schema = 'public' order by table_name, ordinal_position"
      )
      const [schemas] = await rawQuery<{ has_auth: boolean; has_supabase_ledger: boolean }>(
        `select
           exists(select 1 from information_schema.schemata where schema_name = 'auth') as has_auth,
           exists(select 1 from information_schema.schemata where schema_name = 'supabase_migrations') as has_supabase_ledger`
      )
      const tables = tableRows.map((row) => row.table_name)
      const columns: CatalogColumn[] = columnRows
        .filter((row) => ENTITY_ORDER.includes(row.table_name as (typeof ENTITY_ORDER)[number]))
        .map((row) => ({
          table: row.table_name,
          column: row.column_name,
          udtName: row.udt_name,
          nullable: row.is_nullable === 'YES',
        }))
      return {
        tables,
        columns,
        hasAuthSchema: schemas?.has_auth ?? false,
        hasNativeMigrationLedger: tables.includes('schema_migrations'),
        hasSupabaseMigrationLedger: schemas?.has_supabase_ledger ?? false,
      }
    },

    async countRows(entity: string): Promise<number> {
      await ensureConnected()
      if (!ENTITY_ORDER.includes(entity as (typeof ENTITY_ORDER)[number])) {
        throw new MigrationRunError('E_UNKNOWN_ENTITY', `Refusing to count unknown entity "${entity}".`)
      }
      const rows = await rawQuery<{ count: string }>(`select count(*)::text as count from public.${entity}`)
      const value = Number(rows[0]?.count ?? '0')
      if (!Number.isSafeInteger(value)) {
        throw new MigrationRunError('E_COUNT_OVERFLOW', `Row count for ${entity} exceeds the safe integer range.`)
      }
      return value
    },

    async migrationLedger(): Promise<string[]> {
      await ensureConnected()
      if (target.provider === 'supabase') {
        const rows = await rawQuery<{ version: string }>(
          'select version::text as version from supabase_migrations.schema_migrations order by version'
        )
        return rows.map((row) => row.version)
      }
      const rows = await rawQuery<{ name: string }>(
        'select name from public.schema_migrations order by name'
      )
      return rows.map((row) => row.name)
    },

    async close(): Promise<void> {
      if (connected) await client.end()
      connected = false
    },
  }
}

const WRITE_SESSION_SETTINGS = [
  'set statement_timeout = 120000',
  'set lock_timeout = 15000',
  "set idle_in_transaction_session_timeout = '180s'",
]

/**
 * Open a destination session that can write. Only a connection explicitly
 * resolved as the destination may use it, and writes are confined to
 * `transaction()` so a failed merge rolls back atomically.
 */
export function openWriteSession(target: ResolvedDatabaseTarget): WriteSession {
  if (target.role !== 'destination') {
    throw new MigrationRunError(
      'E_WRITE_ROLE',
      'A write session requires the connection to be resolved as the destination.'
    )
  }
  const client = new Client({
    connectionString: target.connectionString,
    application_name: `${target.applicationName}-writer`,
    connectionTimeoutMillis: 15000,
  })
  let connected = false
  let inTransaction = false

  const rawQuery = async <T extends Record<string, unknown>>(
    text: string,
    params?: unknown[]
  ): Promise<T[]> => {
    const result = await client.query(text, params)
    return result.rows as T[]
  }

  const ensureConnected = async (): Promise<void> => {
    if (connected) return
    await client.connect()
    for (const setting of WRITE_SESSION_SETTINGS) await rawQuery(setting)
    connected = true
  }

  const assertWriteAllowed = (offence: string): void => {
    throw new MigrationRunError('E_SESSION_WRITE_SCOPE', offence)
  }

  return {
    provider: target.provider,
    displayTarget: target.displayTarget,

    async identity() {
      await ensureConnected()
      const identities = await rawQuery<{
        database: string
        server_version: string
        postmaster_started_at: string
      }>(
        "select current_database() as database, current_setting('server_version') as server_version, pg_postmaster_start_time()::text as postmaster_started_at"
      )
      const [base] = identities
      let systemIdentifier: string | null = null
      try {
        const probe = await rawQuery<{ system_identifier: string }>(
          'select system_identifier::text as system_identifier from pg_control_system()'
        )
        systemIdentifier = probe[0]?.system_identifier ?? null
      } catch {
        systemIdentifier = null
      }
      const runtimeFingerprint = sha256Hex(
        [
          'vsis-runtime-v1',
          target.provider,
          base.database,
          base.postmaster_started_at,
          base.server_version,
          systemIdentifier ?? `fallback:${target.displayTarget}`,
        ].join('\n')
      ).slice(0, 32)
      return {
        provider: target.provider,
        namespace: computeDatabaseNamespace(target, base.database, systemIdentifier),
        runtimeFingerprint,
        database: base.database,
        serverVersion: base.server_version,
        postmasterStartedAt: base.postmaster_started_at,
        systemIdentifier,
        displayTarget: target.displayTarget,
      }
    },

    async query<T extends Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]> {
      await ensureConnected()
      if (inTransaction) {
        assertWriteAllowed('Write-session queries outside transaction() are read-only; use the transaction handle.')
      }
      const withoutLiterals = text.replace(/'(?:[^']|'')*'/g, "''")
      if (WRITE_KEYWORD_RE.test(withoutLiterals)) {
        assertWriteAllowed('Write-session queries outside transaction() may not change data.')
      }
      return rawQuery<T>(text, params)
    },

    async inspectCatalog(): Promise<CatalogInspection> {
      await ensureConnected()
      const tableRows = await rawQuery<{ table_name: string }>(
        "select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name"
      )
      const columnRows = await rawQuery<{ table_name: string; column_name: string; udt_name: string; is_nullable: string }>(
        "select table_name, column_name, udt_name, is_nullable from information_schema.columns where table_schema = 'public' order by table_name, ordinal_position"
      )
      const [schemas] = await rawQuery<{ has_auth: boolean; has_supabase_ledger: boolean }>(
        `select
           exists(select 1 from information_schema.schemata where schema_name = 'auth') as has_auth,
           exists(select 1 from information_schema.schemata where schema_name = 'supabase_migrations') as has_supabase_ledger`
      )
      const tables = tableRows.map((row) => row.table_name)
      const columns: CatalogColumn[] = columnRows
        .filter((row) => ENTITY_ORDER.includes(row.table_name as (typeof ENTITY_ORDER)[number]))
        .map((row) => ({
          table: row.table_name,
          column: row.column_name,
          udtName: row.udt_name,
          nullable: row.is_nullable === 'YES',
        }))
      return {
        tables,
        columns,
        hasAuthSchema: schemas?.has_auth ?? false,
        hasNativeMigrationLedger: tables.includes('schema_migrations'),
        hasSupabaseMigrationLedger: schemas?.has_supabase_ledger ?? false,
      }
    },

    async migrationLedger(): Promise<string[]> {
      await ensureConnected()
      if (target.provider === 'supabase') {
        const rows = await rawQuery<{ version: string }>(
          'select version::text as version from supabase_migrations.schema_migrations order by version'
        )
        return rows.map((row) => row.version)
      }
      const rows = await rawQuery<{ name: string }>('select name from public.schema_migrations order by name')
      return rows.map((row) => row.name)
    },

    async transaction<T>(fn: (tx: WriteTransaction) => Promise<T>): Promise<T> {
      await ensureConnected()
      if (inTransaction) assertWriteAllowed('Nested destination transactions are not supported.')
      await rawQuery('begin')
      inTransaction = true
      try {
        const result = await fn({
          query: async <R extends Record<string, unknown>>(text: string, params?: unknown[]) =>
            rawQuery<R>(text, params),
        })
        await rawQuery('commit')
        return result
      } catch (error) {
        try {
          await rawQuery('rollback')
        } catch {
          // Preserve the original failure.
        }
        throw error
      } finally {
        inTransaction = false
      }
    },

    async close(): Promise<void> {
      if (connected) await client.end()
      connected = false
    },
  }
}
