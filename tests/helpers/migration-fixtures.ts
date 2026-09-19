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
import { PROVIDER_SCHEMA_FINGERPRINTS } from '@/lib/migration/schema'

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

export function activityTypeRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '66666666-6666-4666-8666-666666666666',
    name: 'R&D',
    is_active: true,
    telegram_no: null,
    created_at: '2026-09-01T08:00:00.000000Z',
    ...over,
  }
}

export function titleRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '77777777-7777-4777-8777-777777777777',
    name: 'Systems Engineer',
    hierarchy_role: 'engineer',
    created_at: '2026-09-01T08:00:00.000000Z',
    ...over,
  }
}

export function domainRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '88888888-8888-4888-8888-888888888888',
    domain: 'example.com',
    auto_activate: false,
    created_at: '2026-09-01T08:00:00.000000Z',
    ...over,
  }
}

export function leaveRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '99999999-9999-4999-8999-999999999999',
    user_id: '11111111-1111-4111-8111-111111111111',
    leave_date: '2026-09-03',
    reason: 'Vacation',
    created_at: '2026-09-03T00:00:00.000000Z',
    ...over,
  }
}

export function reminderRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    user_id: '11111111-1111-4111-8111-111111111111',
    message: 'Submit report',
    remind_at: '2026-09-04T09:00:00.000000Z',
    done: false,
    created_at: '2026-09-03T00:00:00.000000Z',
    ...over,
  }
}

export function globalReminderRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    message: 'All-hands',
    remind_at: '2026-09-05T09:00:00.000000Z',
    created_at: '2026-09-03T00:00:00.000000Z',
    ...over,
  }
}

export function dismissalRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    user_id: '11111111-1111-4111-8111-111111111111',
    reminder_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    dismissed_at: '2026-09-05T10:00:00.000000Z',
    ...over,
  }
}

export function auditLogRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    actor_id: '11111111-1111-4111-8111-111111111111',
    actor_email: 'alice@example.com',
    action: 'user.update',
    target_id: null,
    detail: null,
    created_at: '2026-09-03T11:00:00.000000Z',
    ...over,
  }
}

export function appSettingsRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 1,
    backfill_window_days: 1,
    backfill_mode: 'days',
    backfill_extra_days: 0,
    default_dashboard_layout: null,
    default_admin_layout: null,
    default_mobile_layout: null,
    app_name: 'VSIS Timesheet',
    primary_color: '#1E73BE',
    logo_url: null,
    updated_at: '2026-09-01T08:00:00.000000Z',
    ...over,
  }
}

/** A manifest object without writing bundle files (for pure planning tests). */
export function makeManifest(over: Partial<BundleManifest> = {}): BundleManifest {
  return {
    format: MIGRATION_FORMAT,
    formatVersion: MIGRATION_FORMAT_VERSION,
    canonicalizationVersion: CANONICALIZATION_VERSION,
    runId: 'run-0001',
    bundleId: 'bundle-0001',
    source: {
      provider: 'native',
      namespace: 'native:source',
      applicationVersion: '1.0.3',
      schemaFingerprint: PROVIDER_SCHEMA_FINGERPRINTS.native,
      appliedMigrations: ['0001_initial_schema.sql', '0031_idempotency_effects.sql', '0032_migration_receipts.sql'],
      releaseRevision: null,
    },
    exportedAt: '2026-09-19T00:00:00.000000Z',
    snapshot: { mode: 'repeatable-read', startedAt: '2026-09-19T00:00:00.000000Z', transactionId: null },
    tool: { name: 'vsis-migration', version: '1.0.0', applicationVersion: '1.0.3' },
    accountPolicy: { enrollment: 'destination-enrollment', passwordTransfer: 'none' },
    entities: [],
    provenance: { file: PROVENANCE_FILE, count: 0, byteSize: 0, sha256: 'b'.repeat(64) },
    exclusions: [],
    transformations: [],
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
      schemaFingerprint: PROVIDER_SCHEMA_FINGERPRINTS.native,
      appliedMigrations: ['0001_initial_schema.sql', '0031_idempotency_effects.sql', '0032_migration_receipts.sql'],
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
