// tools/migration/src/providers/fence.ts
// Provider-level write fence (plan §11 amendment: "Infrastructure/provider
// write fencing — required in addition to the durable application gate").
//
// The durable `migration_write_gate` row stops application requests; it does
// not stop direct PostgREST calls, Auth/Admin mutations, jobs, or existing
// pooled connections. This module implements the deployment-specific control
// the plan requires: exact DML-privilege revocation for the provider's writer
// roles, an inventory captured before any change so release restores supported
// direct table-level grants exactly, and a verify step that proves writes fail through real write
// attempts. `NOLOGIN` and `default_transaction_read_only` are deliberately
// not used (plan §11 rejects them as Supabase/sole fences).
//
// Ordering contract (C08 runbook): activate, then verify the SQL privilege
// denial while the API is still running, then apply the ingress/platform
// shutdown as a separate operator step, then verify again. The CLI releases
// only through the durable publication successor (writable receipt + open
// gate) or an explicit recovery decision on the exact fenced generation.

import { MigrationRunError } from '../journal'
import { canonicalStringify, sha256Hex, type ProviderName } from '../format'
import type { WriteSession, WriteTransaction } from './session'

/** The DML privileges the fence removes. SELECT stays: reads pass while fenced. */
const FENCED_PRIVILEGES = ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] as const

export interface FenceGrant {
  role: string
  table: string
  privileges: string[]
}

export interface FenceInventory {
  provider: ProviderName
  roles: string[]
  grants: FenceGrant[]
}

class FenceProbeRollback extends Error {
  constructor() {
    super('fence probe rollback')
  }
}

class FenceProbeFailure extends Error {
  constructor(readonly phase: 'assume-role' | 'write', readonly cause: unknown) {
    super(phase)
  }
}

export interface FenceCheck {
  surface: string
  ok: boolean
  detail: string
}

export interface FenceArtifact extends FenceInventory {
  format: 'vsis-migration-fence-inventory'
  formatVersion: 3
  capturedFor: string
  runId: string
  /** Exact durable gate generation that authorized this activation. */
  gateUpdatedAt: string
  /** Stable durable identifier for this fenced window. */
  gateGeneration: string
  reason: string
  actor: string
  capturedAt: string
  inventoryDigest: string
}

/** PostgreSQL identifiers are restricted to this shape, then quoted exactly. */
const ROLE_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/
const TABLE_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function artifactBody(artifact: Omit<FenceArtifact, 'inventoryDigest'>) {
  return {
    format: artifact.format,
    formatVersion: artifact.formatVersion,
    provider: artifact.provider,
    roles: artifact.roles,
    grants: artifact.grants,
    capturedFor: artifact.capturedFor,
    runId: artifact.runId,
    gateUpdatedAt: artifact.gateUpdatedAt,
    gateGeneration: artifact.gateGeneration,
    reason: artifact.reason,
    actor: artifact.actor,
    capturedAt: artifact.capturedAt,
  }
}

export function createFenceArtifact(inventory: FenceInventory, binding: Omit<FenceArtifact, keyof FenceInventory | 'format' | 'formatVersion' | 'inventoryDigest'>): FenceArtifact {
  const artifact = {
    format: 'vsis-migration-fence-inventory' as const,
    formatVersion: 3 as const,
    ...inventory,
    ...binding,
  }
  return { ...artifact, inventoryDigest: sha256Hex(canonicalStringify(artifactBody(artifact))) }
}

/** Strictly parse the operator artifact before it can restore any grant. */
export function parseFenceArtifact(value: unknown): FenceArtifact {
  if (typeof value !== 'object' || value === null) throw new MigrationRunError('E_FENCE_INVENTORY_INVALID', 'Inventory artifact must be an object.')
  const item = value as Record<string, unknown>
  if (item.format !== 'vsis-migration-fence-inventory' || item.formatVersion !== 3) {
    throw new MigrationRunError('E_FENCE_INVENTORY_INVALID', 'Inventory artifact format/version is unsupported.')
  }
  if (item.provider !== 'native' && item.provider !== 'supabase') throw new MigrationRunError('E_FENCE_INVENTORY_INVALID', 'Inventory artifact provider is invalid.')
  if (!Array.isArray(item.roles) || item.roles.length === 0 || item.roles.some((role) => typeof role !== 'string' || !ROLE_RE.test(role))) {
    throw new MigrationRunError('E_FENCE_INVENTORY_INVALID', 'Inventory artifact roles are invalid.')
  }
  const roles = item.roles as string[]
  if (new Set(roles).size !== roles.length) throw new MigrationRunError('E_FENCE_INVENTORY_INVALID', 'Inventory artifact roles must not be duplicated.')
  if (!Array.isArray(item.grants)) throw new MigrationRunError('E_FENCE_INVENTORY_INVALID', 'Inventory artifact grants are invalid.')
  const seen = new Set<string>()
  const grants: FenceGrant[] = item.grants.map((grant) => {
    if (typeof grant !== 'object' || grant === null) throw new MigrationRunError('E_FENCE_INVENTORY_INVALID', 'Inventory artifact has a malformed grant.')
    const record = grant as Record<string, unknown>
    if (typeof record.role !== 'string' || !roles.includes(record.role) || typeof record.table !== 'string' || !TABLE_RE.test(record.table) || !Array.isArray(record.privileges) || record.privileges.length === 0 || record.privileges.some((privilege) => typeof privilege !== 'string' || !FENCED_PRIVILEGES.includes(privilege as typeof FENCED_PRIVILEGES[number]))) {
      throw new MigrationRunError('E_FENCE_INVENTORY_INVALID', 'Inventory artifact has a malformed grant.')
    }
    const privileges = record.privileges as string[]
    if (new Set(privileges).size !== privileges.length) throw new MigrationRunError('E_FENCE_INVENTORY_INVALID', 'Inventory artifact grant privileges must not be duplicated.')
    const key = `${record.role}\u0000${record.table}`
    if (seen.has(key)) throw new MigrationRunError('E_FENCE_INVENTORY_INVALID', 'Inventory artifact grant entries must not be duplicated.')
    seen.add(key)
    return { role: record.role, table: record.table, privileges }
  })
  for (const field of ['capturedFor', 'runId', 'gateUpdatedAt', 'gateGeneration', 'reason', 'actor', 'capturedAt', 'inventoryDigest'] as const) {
    if (typeof item[field] !== 'string' || item[field].trim() === '') throw new MigrationRunError('E_FENCE_INVENTORY_INVALID', `Inventory artifact ${field} is invalid.`)
  }
  if (!UUID_RE.test(item.gateGeneration as string)) {
    throw new MigrationRunError('E_FENCE_INVENTORY_INVALID', 'Inventory artifact gateGeneration must be a UUID.')
  }
  const artifact: FenceArtifact = { format: item.format, formatVersion: item.formatVersion, provider: item.provider, roles, grants, capturedFor: item.capturedFor as string, runId: item.runId as string, gateUpdatedAt: item.gateUpdatedAt as string, gateGeneration: item.gateGeneration as string, reason: item.reason as string, actor: item.actor as string, capturedAt: item.capturedAt as string, inventoryDigest: item.inventoryDigest as string }
  if (artifact.inventoryDigest !== sha256Hex(canonicalStringify(artifactBody(artifact)))) throw new MigrationRunError('E_FENCE_INVENTORY_INVALID', 'Inventory artifact digest does not match its contents.')
  return artifact
}

export function parseFenceRoles(value: string | undefined, provider: ProviderName): string[] {
  if (value === undefined || value.trim() === '') {
    const defaults = provider === 'supabase' ? ['anon', 'authenticated'] : []
    if (defaults.length > 0) return defaults
    throw new MigrationRunError(
      'E_FENCE_ROLE_REQUIRED',
      'A native fence needs at least one writer role (--role), e.g. --role vsis_app.'
    )
  }
  const roles = value
    .split(',')
    .map((role) => role.trim())
    .filter((role) => role.length > 0)
  for (const role of roles) {
    if (!ROLE_RE.test(role)) {
      throw new MigrationRunError('E_FENCE_ROLE_INVALID', `Fence role "${role}" is not a valid PostgreSQL identifier.`)
    }
  }
  if (roles.length === 0) {
    throw new MigrationRunError(
      'E_FENCE_ROLE_REQUIRED',
      'The fence needs at least one writer role (--role), e.g. --role anon,authenticated for Supabase.'
    )
  }
  if (new Set(roles).size !== roles.length) {
    throw new MigrationRunError('E_FENCE_ROLE_DUPLICATE', 'Fence roles must not be duplicated.')
  }
  return roles
}

function quoteIdent(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`
}

/**
 * Capture supported direct table-level DML grants. Column grants, grant
 * options, and grants made by another grantor cannot be restored exactly by
 * this primitive, so activation refuses those ACL shapes rather than
 * producing a misleading release artifact.
 */
export async function inventoryFence(session: Pick<WriteSession, 'query'>, provider: ProviderName, roles: string[]): Promise<FenceInventory> {
  const rows = await session.query<{
    grantor: string
    grantee: string
    table_name: string
    privilege_type: string
    is_grantable: string
    current_user: string
  }>(
    `select grantor, grantee, table_name, privilege_type, is_grantable, current_user as current_user
       from information_schema.role_table_grants
      where table_schema = 'public' and grantee = any($1::text[])
        and privilege_type = any($2::text[])
      order by grantee, table_name, privilege_type`,
    [roles, [...FENCED_PRIVILEGES]]
  )
  // information_schema.column_privileges expands table grants too, which
  // falsely classifies an ordinary table grant as column-scoped. Inspect only
  // explicit per-column ACL arrays instead.
  const columnGrants = await session.query<{ grantee: string; table_name: string; column_name: string; privilege_type: string }>(
    `select grantee.rolname as grantee, relation.relname as table_name,
            attribute.attname as column_name, upper(acl.privilege_type) as privilege_type
       from pg_catalog.pg_attribute attribute
       join pg_catalog.pg_class relation on relation.oid = attribute.attrelid
       join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
       cross join lateral pg_catalog.aclexplode(attribute.attacl) acl
       join pg_catalog.pg_roles grantee on grantee.oid = acl.grantee
      where namespace.nspname = 'public'
        and relation.relkind in ('r', 'p')
        and attribute.attnum > 0 and not attribute.attisdropped
        and grantee.rolname = any($1::text[])
        and upper(acl.privilege_type) = any($2::text[])
      order by grantee.rolname, relation.relname, attribute.attname, acl.privilege_type`,
    [roles, [...FENCED_PRIVILEGES]]
  )
  if (columnGrants.length > 0) {
    const grant = columnGrants[0]
    throw new MigrationRunError(
      'E_FENCE_UNSUPPORTED_ACL',
      `Fence cannot restore column-level ${grant.privilege_type} grant for ${grant.grantee} on ${grant.table_name}.${grant.column_name} exactly.`
    )
  }
  for (const row of rows) {
    if (row.is_grantable !== 'NO') {
      throw new MigrationRunError(
        'E_FENCE_UNSUPPORTED_ACL',
        `Fence cannot restore ${row.privilege_type} WITH GRANT OPTION for ${row.grantee} on ${row.table_name} exactly.`
      )
    }
    if (row.grantor !== row.current_user) {
      throw new MigrationRunError(
        'E_FENCE_UNSUPPORTED_ACL',
        `Fence cannot restore ${row.privilege_type} granted by ${row.grantor} (current user is ${row.current_user}) exactly.`
      )
    }
  }
  const grouped = new Map<string, FenceGrant>()
  for (const row of rows) {
    const key = `${row.grantee}\u0000${row.table_name}`
    const grant = grouped.get(key) ?? { role: row.grantee, table: row.table_name, privileges: [] }
    grant.privileges.push(row.privilege_type)
    grouped.set(key, grant)
  }
  return {
    provider,
    roles: [...roles],
    grants: [...grouped.values()],
  }
}

/** Revoke the fenced DML privileges from every role on every public table. */
export async function activateFence(
  session: WriteSession,
  roles: string[]
): Promise<{ revokedStatements: number }> {
  return session.transaction((tx) => activateFenceInTransaction(tx, roles))
}

/** Revoke while the caller holds the current gate row lock. */
export async function activateFenceInTransaction(
  tx: WriteTransaction,
  roles: string[]
): Promise<{ revokedStatements: number }> {
  let statements = 0
  for (const role of roles) {
    await tx.query(`revoke ${FENCED_PRIVILEGES.join(', ')} on all tables in schema public from ${quoteIdent(role)}`)
    statements += 1
  }
  return { revokedStatements: statements }
}

/** Restore a supported direct table-level, non-grantable inventory inside a caller-held lock. */
export async function restoreFenceGrants(
  tx: WriteTransaction,
  inventory: FenceInventory
): Promise<{ restoredStatements: number }> {
  let statements = 0
  for (const role of inventory.roles) {
    await tx.query(
      `revoke ${FENCED_PRIVILEGES.join(', ')} on all tables in schema public from ${quoteIdent(role)}`
    )
    statements += 1
  }
  for (const grant of inventory.grants) {
    await tx.query(
      `grant ${grant.privileges.join(', ')}
         on table public.${quoteIdent(grant.table)} to ${quoteIdent(grant.role)}`
    )
    statements += 1
  }
  return { restoredStatements: statements }
}

/** Restore a supported direct table-level, non-grantable inventory exactly. */
export async function releaseFence(session: WriteSession, inventory: FenceInventory): Promise<{ restoredStatements: number }> {
  return session.transaction((tx) => restoreFenceGrants(tx, inventory))
}

/**
 * Prove the privilege fence with real write attempts. For each role the probe
 * switches the session to that role and attempts a DML statement; the wrapper
 * transaction rolls the probe back, so an unfenced role leaves nothing behind
 * and a fenced role fails with 42501 before anything could be written. A role
 * that cannot be assumed is a failed check, never a pass.
 */
export async function verifyFence(
  session: WriteSession,
  roles: string[]
): Promise<{ ok: boolean; checks: FenceCheck[] }> {
  const checks: FenceCheck[] = []
  const publicTables = await session.query<{ table_name: string }>(
    `select table_name from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'
      order by table_name`
  )
  for (const role of roles) {
    const surface = `sql:${role}`
    try {
      await session.transaction(async (tx) => {
        try {
          await tx.query(`set local role ${quoteIdent(role)}`)
        } catch (error) {
          throw new FenceProbeFailure('assume-role', error)
        }
        for (const table of publicTables) {
          for (const privilege of FENCED_PRIVILEGES) {
            const effective = await tx.query<{ granted: boolean }>(
              'select has_table_privilege(current_user, $1, $2) as granted',
              [`public.${quoteIdent(table.table_name)}`, privilege]
            )
            if (effective[0]?.granted) {
              throw new FenceProbeFailure('write', new Error(`effective ${privilege} remains on ${table.table_name}`))
            }
          }
        }
        try {
          await tx.query('update public.app_settings set updated_at = updated_at where id = 1')
        } catch (error) {
          throw new FenceProbeFailure('write', error)
        }
        // A successful probe is evidence of an unfenced writer, but it must
        // still roll back its transaction so verification can never commit.
        throw new FenceProbeRollback()
      })
    } catch (error) {
      if (error instanceof FenceProbeRollback) {
        checks.push({
          surface,
          ok: false,
          detail: 'a write attempt succeeded while fenced; the privilege fence is not in effect',
        })
        continue
      }
      if (error instanceof FenceProbeFailure) {
        const code = (error.cause as { code?: string }).code
        const message = error.cause instanceof Error ? error.cause.message : String(error.cause)
        if (error.phase === 'write' && code === '42501') {
          checks.push({ surface, ok: true, detail: 'write attempt denied with permission_denied (42501)' })
        } else if (error.phase === 'assume-role') {
          checks.push({ surface, ok: false, detail: `role assumption failed: ${message}` })
        } else {
          checks.push({ surface, ok: false, detail: `probe failed unexpectedly: ${message}` })
        }
      } else {
        const message = error instanceof Error ? error.message : String(error)
        checks.push({ surface, ok: false, detail: `probe failed unexpectedly: ${message}` })
      }
    }
  }
  return { ok: checks.every((check) => check.ok), checks }
}

/**
 * PostgREST write probe for the Supabase privilege stage: while the API is
 * still running, a business write through REST must fail once the fence is
 * active. The probe updates a column to its current value (a no-op when the
 * fence is missing), so a probe that slips through changes nothing. The caller
 * supplies an authenticated user access token — RLS normally allows a user to
 * update their own profile, so the denial can only come from the revoked
 * table privilege.
 */
export async function verifySupabaseRestFence(options: {
  restUrl: string
  accessToken: string
  anonKey: string
  userId: string
}): Promise<FenceCheck> {
  const surface = 'rest:profiles'
  const headers: Record<string, string> = {
    apikey: options.anonKey,
    authorization: `Bearer ${options.accessToken}`,
    'content-type': 'application/json',
    prefer: 'return=minimal',
  }
  try {
    const read = await fetch(`${options.restUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(options.userId)}`, {
      headers: { ...headers, prefer: 'return=representation' },
    })
    if (!read.ok) {
      return { surface, ok: false, detail: `the probe could not read the profile row (status ${read.status}); it cannot prove the fence either way` }
    }
    const rows = (await read.json()) as Array<Record<string, unknown>>
    const profile = rows[0]
    if (!profile) {
      return { surface, ok: false, detail: 'no profile row for the probe user; it cannot prove the fence either way' }
    }
    const write = await fetch(`${options.restUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(options.userId)}`, {
      method: 'PATCH',
      headers,
      // `name` is intentionally locked by the own-profile RLS policy, so it
      // would be denied even before the provider fence. `department` is the
      // ordinary self-service field and therefore proves the write was
      // admitted before privilege revocation.
      body: JSON.stringify({ department: profile.department ?? null }),
    })
    if (write.ok) {
      return { surface, ok: false, detail: 'a REST write attempt succeeded while fenced; the privilege fence is not in effect' }
    }
    let body: unknown
    try {
      body = await write.json()
    } catch {
      return { surface, ok: false, detail: `REST write failed with non-permission response (status ${write.status})` }
    }
    if (
      (write.status === 401 || write.status === 403) &&
      typeof body === 'object' &&
      body !== null &&
      (body as { code?: unknown }).code === '42501'
    ) {
      return { surface, ok: true, detail: `REST write attempt denied with permission_denied (42501; status ${write.status})` }
    }
    return { surface, ok: false, detail: `REST write failed with non-permission response (status ${write.status})` }
  } catch (error) {
    return {
      surface,
      ok: false,
      detail: `REST probe failed unexpectedly: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}
