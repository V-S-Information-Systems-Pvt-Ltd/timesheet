// lib/migration/providers/read.ts
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

export interface IdentityRecord {
  id: string
  email: string | null
  /** Supabase: inbox-verified fact. Native: null (no verification concept). */
  emailConfirmed: boolean | null
  /** Native: a usable local credential exists. Supabase: null (provider-managed). */
  hasCredential: boolean | null
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
    sourceId: row.source_id,
    destinationId: row.destination_id,
    runId: row.run_id,
    state: row.state,
  }))
}

export async function readIdentityInventory(
  session: CanonicalReadPort,
  provider: ProviderName
): Promise<IdentityRecord[]> {
  if (provider === 'supabase') {
    const rows = await session.query<{ id: string; email: string | null; email_confirmed: boolean }>(
      'select id::text as id, email, (email_confirmed_at is not null) as email_confirmed from auth.users order by id'
    )
    return rows.map((row) => ({
      id: row.id,
      email: row.email,
      emailConfirmed: row.email_confirmed,
      hasCredential: null,
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
  }))
}
