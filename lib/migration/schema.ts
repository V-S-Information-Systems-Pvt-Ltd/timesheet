// lib/migration/schema.ts
// Pure catalog model and compatibility rules used by inspect/preflight/plan.
// A provider's live schema is compared against the canonical entity matrix and
// any transformation the bundle declares; anything unexplained blocks the run.

import { ENTITY_ORDER, entitySpec, sha256Hex, type CanonicalValueKind, type MigrationEntity } from './format'

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
  integer: ['int2', 'int4', 'int8'],
  json: ['json', 'jsonb'],
}

export interface DeclaredTransformation {
  entity: string
  column: string
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
    lines.push(`column:${column.table}.${column.column}:${column.udtName}:${column.nullable ? 'null' : 'notnull'}`)
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
  const declared = new Set(
    declaredTransformations.map((t) => `${t.entity}.${t.column}`)
  )

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
      const transformed = declared.has(`${entity}.${columnSpec.name}`)
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
