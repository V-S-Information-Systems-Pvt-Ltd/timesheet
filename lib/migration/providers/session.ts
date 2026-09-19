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
      const namespace = `${target.provider}:${sha256Hex(
        ['vsis-instance-v1', target.provider, target.projectRef ?? '', base.database, systemIdentifier ?? 'no-system-identifier'].join('\n')
      ).slice(0, 32)}`
      const runtimeFingerprint = sha256Hex(
        [
          'vsis-runtime-v1',
          target.provider,
          base.database,
          base.postmaster_started_at,
          base.server_version,
          systemIdentifier ?? '',
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
