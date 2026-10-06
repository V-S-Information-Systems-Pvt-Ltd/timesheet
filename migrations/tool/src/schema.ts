// migrations/tool/src/schema.ts
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

export interface SchemaCompatibilityContext {
  /** Provider that produced the bundle being checked, when known. */
  sourceProvider?: ProviderName
  /** Provider owning the live catalog, when known. */
  targetProvider?: ProviderName
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

/** Directional import admission; source export support and defaults stay at 1.0.3. */
export function isSupportedApplicationTransition(
  source: { provider: string; applicationVersion: string },
  target: { provider: string; applicationVersion: string }
): boolean {
  return (source.provider === 'native' || source.provider === 'supabase') &&
    (target.provider === 'native' || target.provider === 'supabase') &&
    source.applicationVersion === CURRENT_APPLICATION_RELEASE && (
      target.applicationVersion === CURRENT_APPLICATION_RELEASE || (
        source.provider === 'supabase' &&
        target.provider === 'native' &&
        target.applicationVersion === '1.1.6'
      )
    )
}

/**
 * Fingerprint of the canonical entity surface: tables and allowlisted columns
 * with their standard PostgreSQL UDT and nullability.
 */
export function computeCanonicalSchemaFingerprint(version: 1 | 2 = 2): string {
  const lines: string[] = []
  for (const entity of ENTITY_ORDER) {
    lines.push(`table:${entity}:present`)
    const spec = entitySpec(entity, version)
    for (const column of spec.columns) {
      const udtName = KIND_ACCEPTED_UDTS[column.kind][0]
      lines.push(`column:${entity}.${column.name}:${udtName}:${column.nullable ? 'null' : 'notnull'}`)
    }
  }
  lines.sort()
  return sha256Hex(lines.join('\n'))
}

export const LEGACY_CANONICAL_SCHEMA_FINGERPRINT = computeCanonicalSchemaFingerprint(1)
export const CANONICAL_SCHEMA_FINGERPRINT = computeCanonicalSchemaFingerprint()

/**
 * These columns are provider-owned or compatibility columns. They are
 * deliberately absent from the portable bundle contract and therefore must
 * not make an otherwise supported application schema look unknown.
 *
 * `role` is the legacy column maintained by the sync trigger. Native's
 * password/session columns and Supabase's password-change guard column are
 * likewise provider-internal state; none is exported or copied by C01.
 */
export const EXCLUDED_LIVE_COLUMNS = new Set([
  'profiles.role',
  'profiles.password_hash',
  'profiles.session_version',
  'profiles.mobile_password_change_started_at',
])

/** Provider-specific UDT differences documented by C00. */
const PROVIDER_UDT_OVERRIDES: Record<ProviderName, Readonly<Record<string, string>>> = {
  native: {
    'titles.id': 'text',
    'whitelisted_domains.id': 'text',
  },
  supabase: {},
}

function canonicalColumnsForProvider(provider: ProviderName, version: 1 | 2 = 2): CatalogColumn[] {
  return ENTITY_ORDER.flatMap((entity) =>
    entitySpec(entity, version).columns.map((column) => ({
      table: entity,
      column: column.name,
      udtName: PROVIDER_UDT_OVERRIDES[provider][`${entity}.${column.name}`] ?? KIND_ACCEPTED_UDTS[column.kind][0],
      nullable: column.nullable,
    }))
  )
}

function fingerprintLines(catalog: CatalogInspection, provider: ProviderName | null): string[] {
  const lines: string[] = []
  const tables = new Set(catalog.tables)
  for (const entity of ENTITY_ORDER) {
    lines.push(`table:${entity}:${tables.has(entity) ? 'present' : 'missing'}`)
  }

  // Provider-owned compatibility columns are excluded, but every other live
  // entity column participates. An unexplained extra column must invalidate a
  // supported fingerprint instead of silently widening the import surface.
  for (const column of catalog.columns) {
    const key = `${column.table}.${column.column}`
    if (!ENTITY_ORDER.includes(column.table as MigrationEntity) || EXCLUDED_LIVE_COLUMNS.has(key)) continue
    lines.push(`column:${key}:${column.udtName}:${column.nullable ? 'null' : 'notnull'}`)
  }
  // The provider is part of the fingerprint namespace. This prevents a
  // future provider with an identical visible catalog from being accepted as
  // the source or target of the wrong adapter.
  if (provider) lines.push(`provider:${provider}`)
  lines.sort()
  return lines
}

/** Fingerprint of the live portable surface expected for one provider. */
export function computeProviderSchemaFingerprint(provider: ProviderName, version: 1 | 2 = 2): string {
  const catalog: CatalogInspection = {
    tables: [...ENTITY_ORDER],
    columns: canonicalColumnsForProvider(provider, version),
    hasAuthSchema: provider === 'supabase',
    hasNativeMigrationLedger: provider === 'native',
    hasSupabaseMigrationLedger: provider === 'supabase',
  }
  return sha256Hex(fingerprintLines(catalog, provider).join('\n'))
}

export const PROVIDER_SCHEMA_FINGERPRINTS: Readonly<Record<ProviderName, string>> = {
  native: computeProviderSchemaFingerprint('native'),
  supabase: computeProviderSchemaFingerprint('supabase'),
}

/**
 * The inspected legacy Supabase source permits null storage in four canonical
 * columns and has an obsolete full_name. The portable rows still require values
 * and export checks that full_name carries no name distinct from profiles.name.
 * Admit only this exact source shape, plus its shape after full_name retirement;
 * neither is a supported destination schema. Do not normalize live fingerprints.
 */
function legacySupabaseSourceFingerprints(version: 1 | 2 = 2): string[] {
  const nullableColumns = new Set([
    'profiles.is_active', 'projects.created_at',
    'timesheets.work_done', 'timesheets.created_at',
  ])
  const columns = canonicalColumnsForProvider('supabase', version).map((column) => ({
    ...column,
    nullable: nullableColumns.has(`${column.table}.${column.column}`) || column.nullable,
  }))
  const catalog: CatalogInspection = {
    tables: [...ENTITY_ORDER], columns,
    hasAuthSchema: true, hasNativeMigrationLedger: false, hasSupabaseMigrationLedger: true,
  }
  const retired = sha256Hex(fingerprintLines(catalog, 'supabase').join('\n'))
  catalog.columns = [...columns, { table: 'profiles', column: 'full_name', udtName: 'text', nullable: true }]
  return [sha256Hex(fingerprintLines(catalog, 'supabase').join('\n')), retired]
}

export const LEGACY_PROVIDER_SCHEMA_FINGERPRINTS = {
  native: computeProviderSchemaFingerprint('native', 1),
  supabase: computeProviderSchemaFingerprint('supabase', 1),
}
export const LEGACY_PROVIDER_SOURCE_SCHEMA_FINGERPRINTS: Readonly<Record<ProviderName, readonly string[]>> = {
  native: [LEGACY_PROVIDER_SCHEMA_FINGERPRINTS.native],
  supabase: [LEGACY_PROVIDER_SCHEMA_FINGERPRINTS.supabase, ...legacySupabaseSourceFingerprints(1)],
}

export const PROVIDER_SOURCE_SCHEMA_FINGERPRINTS: Readonly<Record<ProviderName, readonly string[]>> = {
  native: [PROVIDER_SCHEMA_FINGERPRINTS.native],
  supabase: [PROVIDER_SCHEMA_FINGERPRINTS.supabase, ...legacySupabaseSourceFingerprints()],
}

// Keep the logical canonical fingerprint available for format-only callers,
// while CLI/provider checks use the exact provider-specific value below.
export const SUPPORTED_SCHEMA_FINGERPRINTS: readonly string[] = [
  ...new Set([CANONICAL_SCHEMA_FINGERPRINT, ...Object.values(PROVIDER_SCHEMA_FINGERPRINTS)]),
]

export function isSupportedSchemaFingerprint(
  fingerprint: string,
  provider?: ProviderName,
  role: 'source' | 'destination' = 'destination',
  formatVersion: 1 | 2 = 2
): boolean {
  if (role === 'source' && provider) return (formatVersion === 1 ? LEGACY_PROVIDER_SOURCE_SCHEMA_FINGERPRINTS : PROVIDER_SOURCE_SCHEMA_FINGERPRINTS)[provider].includes(fingerprint)
  return provider
    ? PROVIDER_SCHEMA_FINGERPRINTS[provider] === fingerprint
    : SUPPORTED_SCHEMA_FINGERPRINTS.includes(fingerprint)
}

export const REQUIRED_MIGRATIONS: Record<ProviderName, readonly string[]> = {
  native: [
    '0001_initial_schema.sql', '0031_idempotency_effects.sql', '0032_migration_receipts.sql',
    '0033_migration_write_gate.sql', '0034_migration_record_dispositions.sql', '0035_migration_retry_history.sql',
    '0036_migration_write_gate_generation.sql', '0037_migration_fresh_keys.sql',
    '0039_timesheet_classification.sql', '0040_classification_reporting.sql',
  ],
  // Supabase records the numeric migration version, while test/fixture ledgers
  // may retain the filename suffix. Matching below accepts either form.
  supabase: [
    '20260810160000', '20260920000000', '20260930000000',
    '20261001000000', '20261002000000', '20261003000000', '20261004000000', '20261005000000', '20261007000000', '20261008000000',
  ],
}

export function checkMigrationLedger(
  provider: ProviderName,
  appliedMigrations: readonly string[]
): { ok: boolean; missing: string[] } {
  const applied = new Set(appliedMigrations)
  const missing: string[] = []
  for (const required of REQUIRED_MIGRATIONS[provider]) {
    const found =
      provider === 'supabase'
        ? [...applied].some((m) => m === required || m.startsWith(`${required}_`))
        : applied.has(required)
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
export function computeSchemaFingerprint(catalog: CatalogInspection, provider?: ProviderName): string {
  const inferred =
    provider ??
    (catalog.hasAuthSchema || catalog.hasSupabaseMigrationLedger
      ? 'supabase'
      : catalog.hasNativeMigrationLedger
        ? 'native'
        : null)
  return sha256Hex(fingerprintLines(catalog, inferred).join('\n'))
}

/** Compare the live catalog against the canonical matrix plus declared transformations. */
export function checkEntitySchemaCompatibility(
  catalog: CatalogInspection,
  declaredTransformations: readonly DeclaredTransformation[] = [],
  _context: SchemaCompatibilityContext = {}
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
      // `titles.id` and `whitelisted_domains.id` are UUID-shaped strings stored
      // as text on native and as uuid on Supabase (C00 provider delta). Both
      // representations carry the same value contract — the row reader/writer
      // validates the UUID form and casts either way — so the text storage class
      // is accepted for that pair regardless of which provider produced the
      // bundle. Every other column kind stays fail-closed.
      const textUuidPrimaryKey =
        (entity === 'titles' || entity === 'whitelisted_domains') &&
        columnSpec.name === 'id' &&
        columnSpec.kind === 'uuid' &&
        live.udtName === 'text'
      if (!accepted.includes(live.udtName) && !transformed && !textUuidPrimaryKey) {
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
