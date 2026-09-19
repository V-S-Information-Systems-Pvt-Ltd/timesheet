// lib/migration/export.ts
// Read-only exporter: turns one deployment into a validated migration bundle.
//
// The whole read runs inside one repeatable-read, read-only transaction, so the
// snapshot a bundle describes is internally consistent even while the source is
// live. Rows are streamed to disk in bounded batches with keyset pagination:
// memory stays proportional to one batch regardless of table size.
//
// Every file is created exclusively and the manifest is written last, so an
// interrupted export (disk full, dropped connection, cancelled run) leaves a
// directory that validation rejects instead of a plausible-looking bundle.

import { createHash } from 'node:crypto'
import { createWriteStream, mkdirSync, writeFileSync } from 'node:fs'
import { once } from 'node:events'
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
  type MigrationEntity,
  type ProvenanceAlias,
} from './format'
import { MigrationRunError } from './journal'
import { EXCLUDED_LIVE_COLUMNS, KIND_ACCEPTED_UDTS, computeSchemaFingerprint } from './schema'
import { readEntityBatch, readEntityRows } from './providers/read'
import type { DatabaseSession } from './providers/session'
import type { CatalogInspection } from './schema'

export const MIGRATION_TOOL_VERSION = '1.0.0'

/** Rows read per batch. Bounded so a large table never has to fit in memory. */
export const EXPORT_BATCH_SIZE = 1000

export interface ExportRequest {
  directory: string
  runId: string
  bundleId: string
  applicationVersion: string
  releaseRevision?: string | null
  excludedCategories?: Array<{ category: string; reason: string }>
  batchSize?: number
  now?: () => Date
}

export interface ExportEntityStats {
  entity: MigrationEntity
  file: string
  rowCount: number
  byteSize: number
  sha256: string
  batches: number
}

export interface ExportDiagnostics {
  /** Tables present in the deployed schema that are not part of the bundle. */
  unmappedTables: string[]
  /** Columns present in the deployed schema that the bundle does not carry. */
  unmappedColumns: string[]
  /** Canonical columns missing from the deployed schema. */
  missingColumns: string[]
  /** Columns stored differently by this provider (still value-compatible). */
  providerDeltaColumns: string[]
  zeroRowEntities: MigrationEntity[]
}

export interface ExportResult {
  manifest: BundleManifest
  directory: string
  counts: Record<MigrationEntity, number>
  entities: ExportEntityStats[]
  aliases: ProvenanceAlias[]
  diagnostics: ExportDiagnostics
  /** True when the destination has no provenance table yet (nothing to carry). */
  provenanceTableMissing: boolean
}

export async function exportBundle(
  session: DatabaseSession,
  request: ExportRequest
): Promise<ExportResult> {
  const now = request.now ?? (() => new Date())
  const batchSize = request.batchSize ?? EXPORT_BATCH_SIZE
  if (!Number.isSafeInteger(batchSize) || batchSize <= 0) {
    throw new MigrationRunError('E_BATCH_SIZE', 'Export batch size must be a positive integer.')
  }
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

  const startedAt = canonicalizeTimestampText(now().toISOString())
  let transactionId: string | null = null

  // One snapshot for every entity: the bundle is internally consistent even if
  // writers keep changing the source while it is produced.
  const entities = await session.withReadOnlyTransaction(async () => {
    const [snapshotRow] = await session.query<{ snapshot: string }>(
      'select txid_current_snapshot()::text as snapshot'
    )
    transactionId = snapshotRow?.snapshot ?? null

    const stats: ExportEntityStats[] = []
    for (const entity of ENTITY_ORDER) {
      const spec = entitySpec(entity)
      const filePath = join(request.directory, spec.file)
      try {
        stats.push(await streamEntity(session, entity, filePath, batchSize))
      } catch (error) {
        throw new MigrationRunError(
          'E_EXPORT_INTERRUPTED',
          `Export of ${entity} was interrupted; the bundle is incomplete and will not validate: ${
            error instanceof Error ? error.message : String(error)
          }`
        )
      }
    }
    return stats
  })

  // Provenance is read after the snapshot: a missing provenance table must not
  // abort the repeatable-read transaction that carries the data itself.
  const { aliases, tableMissing: provenanceTableMissing } = await readProvenanceAliases(session)

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
    snapshot: { mode: 'repeatable-read', startedAt, transactionId },
    tool: { name: 'vsis-migration', version: MIGRATION_TOOL_VERSION, applicationVersion: request.applicationVersion },
    accountPolicy: { enrollment: 'destination-enrollment', passwordTransfer: 'none' },
    entities: entities.map((stats) => {
      const spec = entitySpec(stats.entity)
      return {
        entity: stats.entity,
        file: spec.file,
        primaryKey: [...spec.primaryKey],
        columns: spec.columns.map((column) => column.name),
        rowCount: stats.rowCount,
        byteSize: stats.byteSize,
        sha256: stats.sha256,
      }
    }),
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

  const counts = {} as Record<MigrationEntity, number>
  for (const stats of entities) counts[stats.entity] = stats.rowCount

  return {
    manifest,
    directory: request.directory,
    counts,
    entities,
    aliases,
    diagnostics: buildDiagnostics(catalog, counts),
    provenanceTableMissing,
  }
}

/**
 * Stream one entity to disk with keyset pagination. The caller holds the
 * snapshot; only one batch is ever resident in memory.
 */
async function streamEntity(
  session: DatabaseSession,
  entity: MigrationEntity,
  filePath: string,
  batchSize: number
): Promise<ExportEntityStats> {
  const spec = entitySpec(entity)
  const file = createWriteStream(filePath, { flags: 'wx' })
  const hash = createHash('sha256')
  let rowCount = 0
  let byteSize = 0
  let batches = 0
  let cursor: Record<string, unknown> | null = null

  try {
    for (;;) {
      const rows = await readEntityBatch(session, entity, cursor, batchSize)
      if (rows.length === 0) break
      batches += 1
      let chunk = ''
      for (const row of rows) {
        const line = `${canonicalRowLine(entity, row)}\n`
        chunk += line
        hash.update(line)
        byteSize += Buffer.byteLength(line, 'utf8')
      }
      rowCount += rows.length
      if (!file.write(chunk)) await once(file, 'drain')
      cursor = rows[rows.length - 1]
      if (rows.length < batchSize) break
    }
    file.end()
    await once(file, 'finish')
  } catch (error) {
    file.destroy()
    throw error
  }

  return { entity, file: spec.file, rowCount, byteSize, sha256: hash.digest('hex'), batches }
}

/**
 * Report schema drift instead of silently rewriting source records: unmapped
 * deployed tables/columns, canonical columns the deployment lacks, and the
 * provider storage differences that are value-compatible.
 */
function buildDiagnostics(
  catalog: CatalogInspection,
  counts: Record<MigrationEntity, number>
): ExportDiagnostics {
  const unmappedTables = catalog.tables.filter(
    (table) => !ENTITY_ORDER.includes(table as MigrationEntity) && table !== 'schema_migrations' && !table.startsWith('migration_')
  )
  const unmappedColumns: string[] = []
  const missingColumns: string[] = []
  const providerDeltaColumns: string[] = []

  for (const entity of ENTITY_ORDER) {
    const spec = entitySpec(entity)
    const live = catalog.columns.filter((column) => column.table === entity)
    const liveByName = new Map(live.map((column) => [column.column, column]))
    for (const column of live) {
      const known = spec.columns.some((candidate) => candidate.name === column.column)
      if (known || EXCLUDED_LIVE_COLUMNS.has(`${entity}.${column.column}`)) continue
      unmappedColumns.push(`${entity}.${column.column}`)
    }
    for (const column of spec.columns) {
      const liveColumn = liveByName.get(column.name)
      if (!liveColumn) {
        missingColumns.push(`${entity}.${column.name}`)
        continue
      }
      if (!KIND_ACCEPTED_UDTS[column.kind].includes(liveColumn.udtName)) {
        providerDeltaColumns.push(`${entity}.${column.name}:${liveColumn.udtName}`)
      } else if (KIND_ACCEPTED_UDTS[column.kind][0] !== liveColumn.udtName) {
        providerDeltaColumns.push(`${entity}.${column.name}:${liveColumn.udtName}`)
      }
    }
  }

  return {
    unmappedTables,
    unmappedColumns,
    missingColumns,
    providerDeltaColumns,
    zeroRowEntities: ENTITY_ORDER.filter((entity) => counts[entity] === 0),
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

/** Read one entity completely (small tables, diagnostics, tests). */
export { readEntityRows }
