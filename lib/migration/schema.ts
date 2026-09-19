// lib/migration/schema.ts
// Pure catalog model and compatibility rules used by inspect/preflight/plan.
// A provider's live schema is compared against the canonical entity matrix and
// any transformation the bundle declares; anything unexplained blocks the run.

import {
  ENTITY_ORDER,
  entitySpec,
  sha256Hex,
  type CanonicalValueKind,
  type MigrationEntity,
  type ProviderName,
} from './format'

export interface CatalogColumn {
  table: string
  column: string
  udtName: string
  nullable: boolean
}

export interface CatalogInspection {
  tables: string[]
  columns: CatalogColumn[]
  hasAuthSchema: boolean
  hasNativeMigrationLedger: boolean
  hasSupabaseMigrationLedger: boolean
}

export interface SchemaCompatIssue {
  entity: MigrationEntity
  column: string | null
  code: string
  message: string
}

/** UDT names the canonical kind can be read from without a declared transformation. */
export const KIND_ACCEPTED_UDTS: Record<CanonicalValueKind, readonly string[]> = {
  uuid: ['uuid'],
  text: ['text', 'varchar', 'bpchar', 'citext'],
  boolean: ['bool'],
  date: ['date'],
  timestamptz: ['timestamptz'],
  decimal: ['numeric'],
  integer: ['int4', 'int2', 'int8'],
  json: ['jsonb', 'json'],
}

export interface DeclaredTransformation {
  entity: string
  column: string
  kind?: string
  detail?: string
}

export const CURRENT_APPLICATION_RELEASE = '1.0.3'
export const SUPPORTED_APPLICATION_RELEASES: readonly string[] = [CURRENT_APPLICATION_RELEASE]

export function isSupportedApplicationRelease(release: string): boolean {
  return SUPPORTED_APPLICATION_RELEASES.includes(release)
}

/**
 * Fingerprint of the canonical entity surface: tables and allowlisted columns
 * with their standard PostgreSQL UDT and nullability.
 */
export function computeCanonicalSchemaFingerprint(): string {
  const lines: string[] = []
  for (const entity of ENTITY_ORDER) {
    lines.push(`table:${entity}:present`)
    const spec = entitySpec(entity)
    for (const column of spec.columns) {
      const udtName = KIND_ACCEPTED_UDTS[column.kind][0]
      lines.push(`column:${entity}.${column.name}:${udtName}:${column.nullable ? 'null' : 'notnull'}`)
    }
  }
  lines.sort()
  return sha256Hex(lines.join('\n'))
}

export const CANONICAL_SCHEMA_FINGERPRINT = computeCanonicalSchemaFingerprint()

export const SUPPORTED_SCHEMA_FINGERPRINTS: readonly string[] = [CANONICAL_SCHEMA_FINGERPRINT]

export function isSupportedSchemaFingerprint(fingerprint: string): boolean {
  return SUPPORTED_SCHEMA_FINGERPRINTS.includes(fingerprint)
}

export const REQUIRED_MIGRATIONS: Record<ProviderName, readonly string[]> = {
  native: ['0001_initial_schema.sql', '0031_idempotency_effects.sql'],
  supabase: ['20260810160000', '20260920000000_idempotency_effects.sql'],
}

export function checkMigrationLedger(
  provider: ProviderName,
  appliedMigrations: readonly string[]
): { ok: boolean; missing: string[] } {
  const applied = new Set(appliedMigrations)
  const missing: string[] = []
  for (const required of REQUIRED_MIGRATIONS[provider]) {
    const found = applied.has(required) || [...applied].some((m) => m.startsWith(required))
    if (!found) missing.push(required)
  }
  return { ok: missing.length === 0, missing }
}

/**
 * Whether a declared transformation is supported by format version 1.
 * Format v1 defines an identical schema across native and Supabase, so no active
 * transformations are registered.
 */
export function isSupportedTransformation(
  _transformation: DeclaredTransformation,
  _liveUdt?: string,
  _canonicalKind?: CanonicalValueKind
): boolean {
  return false
}

/**
 * Fingerprint of the allowlisted entity surface only: provider internals,
 * credential columns and unrelated tables deliberately do not participate, so
 * two providers of the same application release can be compared.
 */
export function computeSchemaFingerprint(catalog: CatalogInspection): string {
  const lines: string[] = []
  const tables = new Set(catalog.tables)
  for (const entity of ENTITY_ORDER) {
    lines.push(`table:${entity}:${tables.has(entity) ? 'present' : 'missing'}`)
  }
  for (const column of catalog.columns) {
    if (ENTITY_ORDER.includes(column.table as (typeof ENTITY_ORDER)[number])) {
      // Exclude provider-internal credential column password_hash on native profiles
      if (column.table === 'profiles' && column.column === 'password_hash') continue
      lines.push(`column:${column.table}.${column.column}:${column.udtName}:${column.nullable ? 'null' : 'notnull'}`)
    }
  }
  lines.sort()
  return sha256Hex(lines.join('\n'))
}

/** Compare the live catalog against the canonical matrix plus declared transformations. */
export function checkEntitySchemaCompatibility(
  catalog: CatalogInspection,
  declaredTransformations: readonly DeclaredTransformation[] = []
): SchemaCompatIssue[] {
  const issues: SchemaCompatIssue[] = []
  const tables = new Set(catalog.tables)
  const byTable = new Map<string, Map<string, CatalogColumn>>()
  for (const column of catalog.columns) {
    let map = byTable.get(column.table)
    if (!map) {
      map = new Map()
      byTable.set(column.table, map)
    }
    map.set(column.column, column)
  }

  // Validate declared transformations: every declaration must refer to a supported transformation.
  for (const t of declaredTransformations) {
    if (!isSupportedTransformation(t)) {
      issues.push({
        entity: t.entity as MigrationEntity,
        column: t.column,
        code: 'E_SCHEMA_UNSUPPORTED_TRANSFORMATION',
        message: `Declared transformation for ${t.entity}.${t.column} (kind "${t.kind ?? 'unspecified'}") is not supported.`,
      })
    }
  }

  for (const entity of ENTITY_ORDER) {
    const spec = entitySpec(entity)
    if (!tables.has(entity)) {
      issues.push({
        entity,
        column: null,
        code: 'E_SCHEMA_TABLE_MISSING',
        message: `Target schema is missing table "${entity}".`,
      })
      continue
    }
    const columns = byTable.get(entity) ?? new Map<string, CatalogColumn>()
    for (const columnSpec of spec.columns) {
      const live = columns.get(columnSpec.name)
      if (!live) {
        issues.push({
          entity,
          column: columnSpec.name,
          code: 'E_SCHEMA_COLUMN_MISSING',
          message: `Target schema is missing ${entity}.${columnSpec.name}.`,
        })
        continue
      }
      const accepted = KIND_ACCEPTED_UDTS[columnSpec.kind]
      const transformed = declaredTransformations.some(
        (t) =>
          t.entity === entity &&
          t.column === columnSpec.name &&
          isSupportedTransformation(t, live.udtName, columnSpec.kind)
      )
      if (!accepted.includes(live.udtName) && !transformed) {
        issues.push({
          entity,
          column: columnSpec.name,
          code: 'E_SCHEMA_TYPE_MISMATCH',
          message: `Target ${entity}.${columnSpec.name} is ${live.udtName}; canonical ${columnSpec.kind} expects ${accepted.join('/')} or a declared transformation.`,
        })
      }
      if (!live.nullable && columnSpec.nullable) {
        issues.push({
          entity,
          column: columnSpec.name,
          code: 'E_SCHEMA_NULLABILITY',
          message: `Target ${entity}.${columnSpec.name} is NOT NULL but the bundle may contain null values.`,
        })
      }
    }
  }
  return issues
}
