// lib/migration/export.ts
// Read-only exporter: turns one deployment into a validated migration bundle.
//
// The whole read runs inside one repeatable-read, read-only transaction, so the
// snapshot a bundle describes is internally consistent even while the source is
// live. Files are created exclusively and the manifest is written last, so an
// interrupted export can never look importable.

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
  canonicalizeTimestampText,
  entitySpec,
  sha256Hex,
  type BundleManifest,
  type CanonicalRow,
  type MigrationEntity,
  type ProvenanceAlias,
} from './format'
import { MigrationRunError } from './journal'
import { computeSchemaFingerprint } from './schema'
import { readEntityRows } from './providers/read'
import type { DatabaseSession } from './providers/session'

export const MIGRATION_TOOL_VERSION = '1.0.0'

export interface ExportRequest {
  directory: string
  runId: string
  bundleId: string
  applicationVersion: string
  releaseRevision?: string | null
  excludedCategories?: Array<{ category: string; reason: string }>
  now?: () => Date
}

export interface ExportResult {
  manifest: BundleManifest
  directory: string
  counts: Record<MigrationEntity, number>
  aliases: ProvenanceAlias[]
  /** True when the destination has no provenance table yet (nothing to carry). */
  provenanceTableMissing: boolean
}

export async function exportBundle(
  session: DatabaseSession,
  request: ExportRequest
): Promise<ExportResult> {
  const now = request.now ?? (() => new Date())
  try {
    mkdirSync(request.directory)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new MigrationRunError(
        'E_BUNDLE_EXISTS',
        `Refusing to export into an existing directory: ${request.directory}`
      )
    }
    throw err
  }

  const identity = await session.identity()
  const catalog = await session.inspectCatalog()
  const appliedMigrations = await session.migrationLedger()
  const schemaFingerprint = computeSchemaFingerprint(catalog, identity.provider)

  const snapshot = await session.withReadOnlyTransaction(async () => {
    const rows = {} as Record<MigrationEntity, CanonicalRow[]>
    for (const entity of ENTITY_ORDER) rows[entity] = await readEntityRows(session, entity)
    return { rows }
  })
  // Provenance is read after the snapshot: a missing provenance table must not
  // abort the repeatable-read transaction that carries the data itself.
  const { aliases, tableMissing: provenanceTableMissing } = await readProvenanceAliases(session)

  const entities = ENTITY_ORDER.map((entity) => {
    const spec = entitySpec(entity)
    const rows = snapshot.rows[entity]
    const contents = rows.length > 0 ? `${rows.map((row) => canonicalRowLine(entity, row)).join('\n')}\n` : ''
    writeFileSync(join(request.directory, spec.file), contents, { flag: 'wx' })
    return {
      entity,
      file: spec.file,
      primaryKey: [...spec.primaryKey],
      columns: spec.columns.map((column) => column.name),
      rowCount: rows.length,
      byteSize: Buffer.byteLength(contents, 'utf8'),
      sha256: sha256Hex(contents),
    }
  })

  const provenanceContents =
    `${canonicalStringify({
      format: MIGRATION_FORMAT,
      formatVersion: MIGRATION_FORMAT_VERSION,
      aliases,
    })}\n`
  writeFileSync(join(request.directory, PROVENANCE_FILE), provenanceContents, { flag: 'wx' })

  const exportedAt = canonicalizeTimestampText(now().toISOString())
  const manifest: BundleManifest = {
    format: MIGRATION_FORMAT,
    formatVersion: MIGRATION_FORMAT_VERSION,
    canonicalizationVersion: CANONICALIZATION_VERSION,
    runId: request.runId,
    bundleId: request.bundleId,
    source: {
      provider: identity.provider,
      namespace: identity.namespace,
      applicationVersion: request.applicationVersion,
      schemaFingerprint,
      appliedMigrations,
      releaseRevision: request.releaseRevision ?? null,
    },
    exportedAt,
    snapshot: { mode: 'repeatable-read', startedAt: exportedAt, transactionId: null },
    tool: { name: 'vsis-migration', version: MIGRATION_TOOL_VERSION, applicationVersion: request.applicationVersion },
    accountPolicy: { enrollment: 'destination-enrollment', passwordTransfer: 'none' },
    entities,
    provenance: {
      file: PROVENANCE_FILE,
      count: aliases.length,
      byteSize: Buffer.byteLength(provenanceContents, 'utf8'),
      sha256: sha256Hex(provenanceContents),
    },
    exclusions: request.excludedCategories ?? [],
    transformations: [],
  }
  writeFileSync(join(request.directory, MANIFEST_FILE), `${canonicalStringify(manifest)}\n`, { flag: 'wx' })

  return {
    manifest,
    directory: request.directory,
    counts: Object.fromEntries(ENTITY_ORDER.map((entity) => [entity, snapshot.rows[entity].length])) as Record<
      MigrationEntity,
      number
    >,
    aliases,
    provenanceTableMissing,
  }
}

/**
 * Provenance a later export carries: for every record this deployment received
 * from another instance, the alias is expressed from this bundle's perspective
 * ("my record X corresponds to <instanceNamespace>'s record Y") so a return
 * migration maps instead of recreating.
 */
export async function readProvenanceAliases(
  session: DatabaseSession
): Promise<{ aliases: ProvenanceAlias[]; tableMissing: boolean }> {
  try {
    const rows = await session.query<{
      entity: string
      source_namespace: string
      source_id: string
      destination_id: string
      recorded_at: string
    }>(
      `select entity, source_namespace, source_id, destination_id,
              to_char(recorded_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as recorded_at
       from public.migration_record_map
       where destination_id is not null
       order by entity, source_id`
    )
    const aliases: ProvenanceAlias[] = []
    for (const row of rows) {
      if (!ENTITY_ORDER.includes(row.entity as MigrationEntity)) continue
      aliases.push({
        entity: row.entity,
        sourceId: row.destination_id,
        destinationId: row.source_id,
        instanceNamespace: row.source_namespace,
        recordedAt: row.recorded_at,
      })
    }
    return { aliases, tableMissing: false }
  } catch (err) {
    const code = (err as { code?: string }).code
    if (code === '42P01') return { aliases: [], tableMissing: true }
    throw err
  }
}
