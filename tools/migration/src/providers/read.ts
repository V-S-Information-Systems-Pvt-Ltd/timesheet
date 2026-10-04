// tools/migration/src/providers/read.ts
// Read-only canonical reads of one deployment: entity rows for planning and
// export, plus the account/identity inventory used for matching.
//
// Every column is cast explicitly to its canonical text form; no application
// type parser and no lossy JS number/Date conversion participates.

import {
  ENTITY_ORDER,
  MigrationFormatError,
  canonicalizeJsonText,
  canonicalizeRow,
  entitySpec,
  type CanonicalRow,
  type ColumnSpec,
  type MigrationEntity,
  type ProviderName,
} from '../format'
import type { DestinationProvenanceReceipt } from '../matching'
import type { DatabaseIdentity } from './session'
import { decodePersistedKey } from '../persisted-key'

/**
 * Minimal read surface shared by the read-only source session and the
 * destination write session, so planning, export and post-commit reconciliation
 * all use the exact same canonical readers.
 */
export interface CanonicalReadPort {
  query<T extends Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>
}

export interface SnapshotPort extends CanonicalReadPort {
  identity(): Promise<DatabaseIdentity>
}

function columnExpression(column: ColumnSpec): string {
  const name = `"${column.name}"`
  switch (column.kind) {
    case 'uuid':
      return `${name}::text as "${column.name}"`
    case 'date':
      return `${name}::text as "${column.name}"`
    case 'timestamptz':
      return `to_char(${name} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "${column.name}"`
    case 'decimal':
      return `${name}::text as "${column.name}"`
    case 'json':
      return `${name}::text as "${column.name}"`
    default:
      return `${name} as "${column.name}"`
  }
}

/**
 * PostgreSQL's jsonb text output is value-preserving but not canonical (it
 * prints `{"a": 1}`), so json columns are canonicalized on read. This keeps
 * numeric literals exact while making the bundle representation byte-stable.
 */
function canonicalizeJsonColumns(
  entity: MigrationEntity,
  row: Record<string, unknown>
): Record<string, unknown> {
  const spec = entitySpec(entity)
  let out = row
  for (const column of spec.columns) {
    if (column.kind !== 'json') continue
    const value = row[column.name]
    if (value === null || value === undefined) continue
    if (typeof value !== 'string') {
      throw new MigrationFormatError(
        'E_VALUE_INVALID',
        `Column ${entity}.${column.name} must be read as JSON text.`
      )
    }
    const canonical = canonicalizeJsonText(value)
    if (canonical !== value) {
      if (out === row) out = { ...row }
      out[column.name] = canonical
    }
  }
  return out
}

/** All rows of one entity in canonical form, ordered by primary key. */
export async function readEntityRows(
  session: CanonicalReadPort,
  entity: MigrationEntity
): Promise<CanonicalRow[]> {
  const spec = entitySpec(entity)
  const select = spec.columns.map(columnExpression).join(', ')
  const orderBy = spec.primaryKey.map((key) => `"${key}"`).join(', ')
  const rows = await session.query<Record<string, unknown>>(
    `select ${select} from public.${entity} order by ${orderBy}`
  )
  return rows.map((row) => canonicalizeRow(entity, canonicalizeJsonColumns(entity, row)))
}

/**
 * One keyset-paginated batch of canonical rows, ordered by primary key. The
 * caller passes the last row of the previous batch as `after`, so a large table
 * can be streamed without holding it in memory. UUID-shaped keys are compared
 * as text: the order is total and stable on both providers even where the
 * column type differs (native `text` vs Supabase `uuid`).
 */
export async function readEntityBatch(
  session: CanonicalReadPort,
  entity: MigrationEntity,
  after: Record<string, unknown> | null,
  limit: number
): Promise<CanonicalRow[]> {
  const spec = entitySpec(entity)
  const select = spec.columns.map(columnExpression).join(', ')
  const keyExpressions = spec.primaryKey.map((key) => {
    const column = spec.columns.find((candidate) => candidate.name === key)
    switch (column?.kind) {
      case 'uuid':
        return `"${key}"::text`
      case 'date':
        return `"${key}"::text`
      case 'timestamptz':
        return `to_char("${key}" at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`
      case 'decimal':
        return `"${key}"::text`
      default:
        return `"${key}"`
    }
  })
  const params: unknown[] = []
  let where = ''
  if (after) {
    const placeholders = spec.primaryKey.map((key) => {
      params.push(after[key] ?? null)
      return `$${params.length}`
    })
    where = `where (${keyExpressions.join(', ')}) > (${placeholders.join(', ')})`
  }
  params.push(limit)
  const rows = await session.query<Record<string, unknown>>(
    `select ${select} from public.${entity} ${where} order by ${keyExpressions.join(', ')} limit $${params.length}`,
    params
  )
  return rows.map((row) => canonicalizeRow(entity, canonicalizeJsonColumns(entity, row)))
}

export interface IdentityRecord {
  id: string
  email: string | null
  /** Supabase: inbox-verified fact. Native: null (no verification concept). */
  emailConfirmed: boolean | null
  /** Native: a usable local credential exists. Supabase: null (provider-managed). */
  hasCredential: boolean | null
  /**
   * Supabase: sign-in providers attached to the account (`email`, `google`,
   * ...). Native: null. Optional because artifacts written before this fact was
   * recorded simply do not carry it. An account that cannot be re-created as a
   * password account blocks provisioning rather than losing its assurance.
   */
  providerIdentities?: string[] | null
  /**
   * Supabase: number of registered second factors. Native: null. A second
   * factor is an assurance that provisioning cannot re-create either.
   */
  mfaFactors?: number | null
}

export interface DeploymentSnapshot {
  provider: ProviderName
  namespace: string
  runtimeFingerprint: string
  rows: Record<MigrationEntity, CanonicalRow[]>
  identities: IdentityRecord[]
  /** Destination-local committed receipts used to confirm prior mappings. */
  receipts?: DestinationProvenanceReceipt[]
}

/** Read the complete durable state of one deployment for planning. */
export async function readDeploymentSnapshot(
  session: SnapshotPort,
  sourceNamespace?: string
): Promise<DeploymentSnapshot> {
  const identity = await session.identity()
  const rows = {} as Record<MigrationEntity, CanonicalRow[]>
  for (const entity of ENTITY_ORDER) rows[entity] = await readEntityRows(session, entity)
  const identities = await readIdentityInventory(session, identity.provider)
  const receipts = await readDestinationProvenanceReceipts(session, identity.namespace, sourceNamespace)
  return {
    provider: identity.provider,
    namespace: identity.namespace,
    runtimeFingerprint: identity.runtimeFingerprint,
    rows,
    identities,
    receipts,
  }
}

/**
 * Read only destination-owned provenance. The join makes a mapping eligible
 * only when its run belongs to the same source/target pair and has reached a
 * committed state; bundle provenance alone is never sufficient confirmation.
 */
export async function readDestinationProvenanceReceipts(
  session: CanonicalReadPort,
  targetNamespace: string,
  sourceNamespace?: string
): Promise<DestinationProvenanceReceipt[]> {
  const params = sourceNamespace ? [sourceNamespace, targetNamespace] : [targetNamespace]
  const sourcePredicate = sourceNamespace ? 'm.source_namespace = $1 and ' : ''
  const targetParam = sourceNamespace ? '$2' : '$1'
  const rows = await session.query<{
    source_namespace: string
    target_namespace: string
    entity: MigrationEntity
    source_id: string
    destination_id: string
    run_id: string
    state: DestinationProvenanceReceipt['state']
  }>(
    `select m.source_namespace, r.target_namespace, m.entity, m.source_id, m.destination_id, m.run_id, r.state
       from public.migration_record_map m
       join public.migration_runs r
         on r.run_id = m.run_id
        and r.source_namespace = m.source_namespace
        and r.target_namespace = ${targetParam}
      where ${sourcePredicate}r.target_namespace = ${targetParam}
        and r.state in ('data-committed', 'verified', 'publication-intent', 'writable')
      order by m.source_namespace, m.entity, m.source_id`
    ,
    params
  )
  return rows.map((row) => ({
    kind: 'destination-receipt' as const,
    sourceNamespace: row.source_namespace,
    targetNamespace: row.target_namespace,
    entity: row.entity,
    sourceId: decodePersistedKey(row.source_id),
    destinationId: decodePersistedKey(row.destination_id),
    runId: row.run_id,
    state: row.state,
  }))
}

export async function readIdentityInventory(
  session: CanonicalReadPort,
  provider: ProviderName
): Promise<IdentityRecord[]> {
  if (provider === 'supabase') {
    // Provider identities are read so the reviewed plan can see an account that
    // signs in through OAuth: such an assurance cannot be re-created as a
    // password account, so provisioning it would silently downgrade it.
    const rows = await session.query<{
      id: string
      email: string | null
      email_confirmed: boolean
      providers: string[] | null
    }>(
      `select u.id::text as id, u.email, (u.email_confirmed_at is not null) as email_confirmed,
              array_agg(distinct i.provider) filter (where i.provider is not null) as providers
       from auth.users u
       left join auth.identities i on i.user_id = u.id
       group by u.id, u.email, u.email_confirmed_at
       order by u.id`
    )
    const factors = await readMfaFactorCounts(session)
    return rows.map((row) => ({
      id: row.id,
      email: row.email,
      emailConfirmed: row.email_confirmed,
      hasCredential: null,
      providerIdentities: (row.providers ?? []).slice().sort(),
      mfaFactors: factors.get(row.id) ?? 0,
    }))
  }
  const rows = await session.query<{ id: string; email: string | null; has_password: boolean }>(
    'select id::text as id, email, (password_hash is not null) as has_password from public.profiles order by id'
  )
  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    emailConfirmed: null,
    hasCredential: row.has_password,
    providerIdentities: null,
    mfaFactors: null,
  }))
}

/**
 * Second-factor counts per account. A deployment without `auth.mfa_factors`
 * (older Supabase, or a native database) simply has no second factors to
 * report, so a missing relation is not an error.
 *
 * The relation is probed instead of catching the failure: this read runs inside
 * the planning/export snapshot transaction, and a failed statement leaves that
 * transaction aborted, so the catch would turn a supported compatibility case
 * into a `25P02` failure on every later query.
 */
async function readMfaFactorCounts(session: CanonicalReadPort): Promise<Map<string, number>> {
  const [probe] = await session.query<{ present: boolean }>(
    "select to_regclass('auth.mfa_factors') is not null as present"
  )
  if (!probe?.present) return new Map()
  const rows = await session.query<{ user_id: string; factors: string }>(
    'select user_id::text as user_id, count(*)::text as factors from auth.mfa_factors group by user_id'
  )
  return new Map(rows.map((row) => [row.user_id, Number(row.factors)]))
}
