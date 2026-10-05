// migrations/tool/src/providers/session.ts
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

const READ_ONLY_STATEMENT_RE = /^(select|with|show|table|values|explain)\b/i
// A `with ... insert` or `explain analyze insert` would pass the leading-keyword
// check; no migration query needs any DML/DDL keyword, so reject them outright.
const WRITE_KEYWORD_RE = /\b(insert|update|delete|merge|truncate|create|alter|drop|grant|revoke|copy|call|do)\b/i
// Functions a read-only statement could still call for side effects. The
// statement is a single SELECT, but SELECT is not read-only by itself.
const FORBIDDEN_FUNCTION_RE = /\b(set_config|pg_reload_conf|pg_terminate_backend|pg_cancel_backend|lo_import|lo_export|dblink)\b/i

/**
 * Strip comments, quoted identifiers/strings and dollar-quoted bodies, and
 * split the remaining code into statements.
 *
 * The previous implementation stripped literals with a single regex, so a
 * quote inside a comment could desynchronize it: a `select` followed by a
 * comment holding a quote and then a second statement looked keyword-free while
 * PostgreSQL saw two statements. A hand-written scanner cannot be desynchronized
 * that way, and it also exposes statement separators so multi-statement input
 * can be refused outright.
 */
function scanSqlText(text: string): { code: string; statements: string[] } {
  let code = ''
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    const next = text[i + 1]
    if (ch === '-' && next === '-') {
      const newline = text.indexOf('\n', i + 2)
      i = newline === -1 ? text.length : newline + 1
      continue
    }
    if (ch === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2)
      i = end === -1 ? text.length : end + 2
      continue
    }
    if (ch === "'") {
      i += 1
      while (i < text.length) {
        if (text[i] === "'" && text[i + 1] === "'") {
          i += 2
          continue
        }
        if (text[i] === "'") {
          i += 1
          break
        }
        i += 1
      }
      code += " '' "
      continue
    }
    if (ch === '"') {
      i += 1
      while (i < text.length && text[i] !== '"') i += 1
      i += 1
      code += ' "quoted" '
      continue
    }
    if (ch === '$') {
      const tag = /^\$[A-Za-z_]*\$/.exec(text.slice(i))
      if (tag) {
        const end = text.indexOf(tag[0], i + tag[0].length)
        i = end === -1 ? text.length : end + tag[0].length
        code += ' $$ '
        continue
      }
    }
    code += ch
    i += 1
  }
  const statements = code
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
  return { code, statements }
}

/** Exactly one read-only statement, with no write keyword or side-effecting call. */
function assertReadOnlySql(text: string): void {
  const { code, statements } = scanSqlText(text)
  const statement = statements[0] ?? ''
  if (
    statements.length !== 1 ||
    !READ_ONLY_STATEMENT_RE.test(statement) ||
    WRITE_KEYWORD_RE.test(code) ||
    FORBIDDEN_FUNCTION_RE.test(code)
  ) {
    throw new MigrationRunError(
      'E_SESSION_WRITE_BLOCKED',
      'Migration sessions only execute a single read-only statement; refusing to run the supplied statement.'
    )
  }
}

function containsWriteKeyword(text: string): boolean {
  return WRITE_KEYWORD_RE.test(scanSqlText(text).code)
}

/** Statement limits every migration session runs under (plan C03 task 2). */
export const SESSION_STATEMENT_LIMITS = {
  statementTimeoutMs: 120_000,
  lockTimeoutMs: 15_000,
  idleInTransactionTimeout: '180s',
} as const

const SESSION_SETTINGS = [
  'set default_transaction_read_only = on',
  `set statement_timeout = ${SESSION_STATEMENT_LIMITS.statementTimeoutMs}`,
  `set lock_timeout = ${SESSION_STATEMENT_LIMITS.lockTimeoutMs}`,
  `set idle_in_transaction_session_timeout = '${SESSION_STATEMENT_LIMITS.idleInTransactionTimeout}'`,
]

type RawQuery = <T extends Record<string, unknown>>(text: string, params?: unknown[]) => Promise<T[]>

/**
 * Alias-free instance facts: the server's own postmaster start time and
 * version. Unlike the privileged system identifier these are readable by every
 * role, so two connections to one database (direct and pooled, privileged and
 * restricted) derive the same runtime fingerprint.
 */
function instanceFallback(base: { postmaster_started_at: string; server_version: string }): string {
  return `${base.postmaster_started_at}|${base.server_version}`
}

const SYSTEM_IDENTIFIER_SAVEPOINT = 'vsis_system_identifier_probe'

/**
 * Read the cluster's system identifier.
 *
 * `pg_control_system()` is superuser-restricted on managed deployments, and
 * PostgreSQL aborts the whole transaction after a permission error. A caller
 * inside a snapshot transaction (export, plan) therefore probes under a
 * savepoint and rolls back to it, so a denied probe cannot poison the
 * repeatable-read transaction with `25P02` for every later query.
 */
async function probeSystemIdentifier(rawQuery: RawQuery, inTransaction: () => boolean): Promise<string | null> {
  const savepoint = inTransaction() ? SYSTEM_IDENTIFIER_SAVEPOINT : null
  if (savepoint) await rawQuery(`savepoint ${savepoint}`)
  try {
    const probe = await rawQuery<{ system_identifier: string }>(
      'select system_identifier::text as system_identifier from pg_control_system()'
    )
    if (savepoint) await rawQuery(`release savepoint ${savepoint}`)
    return probe[0]?.system_identifier ?? null
  } catch {
    if (!savepoint) return null
    // A failed rollback to the savepoint means the connection is gone; let that
    // surface instead of continuing with a dead session.
    await rawQuery(`rollback to savepoint ${savepoint}`)
    return null
  }
}

export function computeDatabaseNamespace(
  target: Pick<ResolvedDatabaseTarget, 'provider' | 'projectRef'>,
  database: string,
  systemIdentifier: string | null
): string {
  // A Supabase project reference is stable across direct and pooler roles,
  // while pg_control_system() can be visible to one role and denied to
  // another. Always prefer the verified project identity so privilege changes
  // cannot split one database into two durable provenance namespaces.
  const stableInstance = target.provider === 'supabase' && target.projectRef
    ? `supabase-project:${target.projectRef}`
    : systemIdentifier
      ? `system:${systemIdentifier}`
      : null
  if (!stableInstance) {
    throw new MigrationRunError(
      'E_INSTANCE_IDENTITY_UNAVAILABLE',
      'The database does not expose a durable instance identifier. Use a connection with a verifiable Supabase project reference or grant access to pg_control_system(); refusing an unstable provenance namespace.'
    )
  }
  return `${target.provider}:${sha256Hex(
    [
      'vsis-instance-v1',
      target.provider,
      database,
      stableInstance,
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
      const systemIdentifier = await probeSystemIdentifier(rawQuery, () => inTransaction)
      const fallback = instanceFallback(base)
      const namespace = computeDatabaseNamespace(target, base.database, systemIdentifier)
      // Deliberately built from server facts only: the system identifier is
      // privileged, so including it would give the same database two different
      // fingerprints depending on which role connected, defeating the
      // same-instance comparisons.
      const runtimeFingerprint = sha256Hex(
        [
          'vsis-runtime-v1',
          target.provider,
          base.database,
          base.postmaster_started_at,
          base.server_version,
          `facts:${fallback}`,
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
      assertReadOnlySql(text)
      return rawQuery<T>(text, params)
    },

    async withReadOnlyTransaction<T>(fn: () => Promise<T>): Promise<T> {
      await ensureConnected()
      await rawQuery('begin isolation level repeatable read read only')
      inTransaction = true
      let callbackFailed = false
      try {
        return await fn()
      } catch (error) {
        callbackFailed = true
        throw error
      } finally {
        inTransaction = false
        try {
          await rawQuery('rollback')
        } catch (rollbackError) {
          // Preserve the operation that failed inside the transaction. A
          // dropped connection can make the cleanup rollback fail as well;
          // replacing the original error would hide E_EXPORT_INTERRUPTED and
          // make callers treat a known interruption as an unexpected failure.
          if (!callbackFailed) throw rollbackError
        }
      }
    },

    async assertReadOnly(): Promise<void> {
      await ensureConnected()
      let rejectedCode: string | null = null
      await rawQuery('begin read only')
      try {
        await rawQuery('create table public.vsis_migration_write_probe (id integer)')
      } catch (error) {
        rejectedCode = (error as { code?: string }).code ?? 'unknown'
      }
      await rawQuery('rollback')
      if (rejectedCode !== '25006') {
        // Only `25006 read_only_sql_transaction` proves the write was refused by
        // read-only mode. A permission error, a leftover probe table or any
        // other failure says nothing about the session's write capability.
        throw new MigrationRunError(
          'E_SOURCE_WRITABLE',
          `The write probe failed with ${rejectedCode ?? 'no error'}; a read-only source must reject it with SQLSTATE 25006.`
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
      const systemIdentifier = await probeSystemIdentifier(rawQuery, () => inTransaction)
      const fallback = instanceFallback(base)
      // Server facts only; see the read-session note on privileged system ids.
      const runtimeFingerprint = sha256Hex(
        [
          'vsis-runtime-v1',
          target.provider,
          base.database,
          base.postmaster_started_at,
          base.server_version,
          `facts:${fallback}`,
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
      if (containsWriteKeyword(text) && !inTransaction) {
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
