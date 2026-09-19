// tests/helpers/migration-fixtures.ts
// Builds disposable migration bundles for the CLI/format tests. Every digest is
// computed exactly the way an exporter must compute it, so a fixture passes
// validation until a test deliberately corrupts one field.

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  CANONICALIZATION_VERSION,
  ENTITY_ORDER,
  MANIFEST_FILE,
  MIGRATION_FORMAT,
  MIGRATION_FORMAT_VERSION,
  PROVENANCE_FILE,
  canonicalRowLine,
  canonicalStringify,
  entitySpec,
  sha256Hex,
  type BundleManifest,
  type MigrationEntity,
} from '@/lib/migration/format'

export type EntityRows = Partial<Record<MigrationEntity, Record<string, unknown>[]>>

export interface BundleFixture {
  directory: string
  manifest: BundleManifest
  rows: Record<MigrationEntity, Record<string, unknown>[]>
}

export interface BundleFixtureOptions {
  rows?: EntityRows
  /** Raw JSONL lines used verbatim (for deliberately non-conforming rows). */
  rawLines?: Partial<Record<MigrationEntity, string[]>>
  aliases?: unknown[]
  mutateManifest?: (manifest: BundleManifest) => BundleManifest
  mutateRows?: (rows: Record<MigrationEntity, Record<string, unknown>[]>) => void
  mutateFiles?: (directory: string) => void
  omitProvenance?: boolean
  manifestDigestOverride?: string
}

export const TS = (iso: string): string => iso

export function profileRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'alice@example.com',
    name: 'Alice',
    department: 'Engineering',
    title: 'Engineer',
    permission_role: 'user',
    hierarchy_role: 'engineer',
    is_active: true,
    manager_id: null,
    dashboard_layout: null,
    admin_layout: null,
    mobile_layout: null,
    created_at: '2026-09-01T08:00:00.000000Z',
    ...over,
  }
}

export function projectRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'Support',
    so_number: 'SO-1',
    telegram_no: 94,
    created_at: '2026-09-01T08:00:00.000000Z',
    ...over,
  }
}

export function timesheetRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    user_id: '11111111-1111-4111-8111-111111111111',
    project_id: '22222222-2222-4222-8222-222222222222',
    activity_type_id: null,
    log_date: '2026-09-02',
    hours_worked: '7.50',
    work_done: 'Wrote tests',
    created_at: '2026-09-02T16:30:00.123456Z',
    ...over,
  }
}

export function writeBundleFixture(directory: string, options: BundleFixtureOptions = {}): BundleFixture {
  mkdirSync(directory, { recursive: true })
  const rows = {} as Record<MigrationEntity, Record<string, unknown>[]>
  for (const entity of ENTITY_ORDER) rows[entity] = options.rows?.[entity] ?? []
  if (options.mutateRows) options.mutateRows(rows)

  const entities = ENTITY_ORDER.map((entity) => {
    const spec = entitySpec(entity)
    const lines = options.rawLines?.[entity] ?? rows[entity].map((row) => canonicalRowLine(entity, row))
    const contents = lines.length > 0 ? `${lines.join('\n')}\n` : ''
    writeFileSync(join(directory, spec.file), contents)
    return {
      entity,
      file: spec.file,
      primaryKey: [...spec.primaryKey],
      columns: spec.columns.map((column) => column.name),
      rowCount: lines.length,
      byteSize: Buffer.byteLength(contents, 'utf8'),
      sha256: sha256Hex(contents),
    }
  })

  const provenanceContents = canonicalStringify({
    format: MIGRATION_FORMAT,
    formatVersion: MIGRATION_FORMAT_VERSION,
    aliases: options.aliases ?? [],
  }) + '\n'
  if (!options.omitProvenance) writeFileSync(join(directory, PROVENANCE_FILE), provenanceContents)

  let manifest: BundleManifest = {
    format: MIGRATION_FORMAT,
    formatVersion: MIGRATION_FORMAT_VERSION,
    canonicalizationVersion: CANONICALIZATION_VERSION,
    runId: 'run-0001',
    bundleId: 'bundle-0001',
    source: {
      provider: 'native',
      namespace: 'native:fixture',
      applicationVersion: '1.0.3',
      schemaFingerprint: 'a'.repeat(64),
      appliedMigrations: ['0001_initial_schema.sql'],
      releaseRevision: null,
    },
    exportedAt: '2026-09-19T00:00:00.000000Z',
    snapshot: {
      mode: 'repeatable-read',
      startedAt: '2026-09-19T00:00:00.000000Z',
      transactionId: null,
    },
    tool: { name: 'vsis-migration', version: '1.0.0', applicationVersion: '1.0.3' },
    accountPolicy: { enrollment: 'destination-enrollment', passwordTransfer: 'none' },
    entities,
    provenance: {
      file: PROVENANCE_FILE,
      count: (options.aliases ?? []).length,
      byteSize: Buffer.byteLength(provenanceContents, 'utf8'),
      sha256: sha256Hex(provenanceContents),
    },
    exclusions: [],
    transformations: [],
  }
  if (options.mutateManifest) manifest = options.mutateManifest(manifest)
  const manifestContents = `${canonicalStringify(manifest)}\n`
  writeFileSync(join(directory, MANIFEST_FILE), manifestContents)
  if (options.manifestDigestOverride) {
    writeFileSync(join(directory, MANIFEST_FILE), options.manifestDigestOverride)
  }
  if (options.mutateFiles) options.mutateFiles(directory)

  return { directory, manifest, rows }
}
