// migrations/tool/src/export.ts
// Read-only exporter: turns one deployment into a validated migration bundle.
//
// The whole read runs inside one repeatable-read, read-only transaction, so the
// snapshot a bundle describes is internally consistent even while the source is
// live. Rows are streamed to disk in bounded batches with keyset pagination:
// memory stays proportional to one batch regardless of table size.
//
// Every file is created exclusively and the manifest is written last, so an
// interrupted export (disk full, dropped connection, cancelled run) leaves a
// directory that validation rejects instead of a plausible-looking bundle. The
// validator's hard row/entity/provenance bounds are enforced while streaming,
// so the exporter can never complete a bundle its own validator rejects.

import { createHash } from 'node:crypto'
import { createWriteStream, mkdirSync, writeFileSync } from 'node:fs'
import { once } from 'node:events'
import { join } from 'node:path'
import {
  CANONICALIZATION_VERSION,
  BUNDLE_LIMITS,
  ENTITY_ORDER,
  IDENTITIES_FILE,
  MANIFEST_FILE,
  MIGRATION_FORMAT,
  MIGRATION_FORMAT_VERSION,
  PROVENANCE_FILE,
  RETRY_HISTORY_FILE,
  canonicalRowLine,
  canonicalStringify,
  canonicalizeTimestampText,
  entitySpec,
  sha256Hex,
  type BundleManifest,
  type IdentityFact,
  type MigrationEntity,
  type RetryHistoryFact,
} from './format'
import { MigrationRunError } from './journal'
import { decodePersistedKey } from './persisted-key'
import {
  EXCLUDED_LIVE_COLUMNS,
  KIND_ACCEPTED_UDTS,
  computeSchemaFingerprint,
} from './schema'
import { readEntityBatch, readEntityRows, readIdentityInventory } from './providers/read'
import { SESSION_STATEMENT_LIMITS, type DatabaseSession } from './providers/session'
import type { CatalogInspection } from './schema'

export const MIGRATION_TOOL_VERSION = '1.0.0'

/** Rows read per batch. Bounded so a large table never has to fit in memory. */
export const EXPORT_BATCH_SIZE = 1000

interface ExportLimits {
  rowBytes: number
  entityFileBytes: number
  provenanceBytes: number
  identitiesBytes: number
  retryHistoryBytes: number
}

export interface ExportRequest {
  directory: string
  runId: string
  bundleId: string
  applicationVersion: string
  releaseRevision?: string | null
  excludedCategories?: Array<{ category: string; reason: string }>
  batchSize?: number
  /** Hard bundle bounds enforced while streaming; defaults to BUNDLE_LIMITS. */
  limits?: Partial<ExportLimits>
  now?: () => Date
}

export interface ExportEntityStats {
  entity: MigrationEntity
  file: string
  rowCount: number
  byteSize: number
  sha256: string
  batches: number
  incompatibleValues: Array<{ column: string; count: number; rule: string }>
}

interface ProvenanceStats {
  count: number
  byteSize: number
  sha256: string
  tableMissing: boolean
}

interface IdentityStats {
  count: number
  byteSize: number
  sha256: string
}

type RetryHistoryStats = IdentityStats

interface ProvenanceRow extends Record<string, unknown> {
  entity: string
  source_namespace: string
  source_id: string
  destination_id: string
  recorded_at: string
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
  /** Existing rows that the destination's shared constraints would reject. */
  incompatibleValues: Array<{ entity: MigrationEntity; column: string; count: number; rule: string }>
}

export interface ExportResult {
  manifest: BundleManifest
  directory: string
  counts: Record<MigrationEntity, number>
  entities: ExportEntityStats[]
  aliasCount: number
  /** Source account assurance facts carried in the bundle. */
  identityCount: number
  retryHistoryCount: number
  diagnostics: ExportDiagnostics
  /** Statement limits the read-only snapshot ran under (plan C03 task 2). */
  statementLimits: typeof SESSION_STATEMENT_LIMITS
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
  const limits = {
    rowBytes: request.limits?.rowBytes ?? BUNDLE_LIMITS.rowBytes,
    entityFileBytes: request.limits?.entityFileBytes ?? BUNDLE_LIMITS.entityFileBytes,
    provenanceBytes: request.limits?.provenanceBytes ?? BUNDLE_LIMITS.provenanceBytes,
    identitiesBytes: request.limits?.identitiesBytes ?? BUNDLE_LIMITS.identitiesBytes,
    retryHistoryBytes: request.limits?.retryHistoryBytes ?? BUNDLE_LIMITS.retryHistoryBytes,
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

  const startedAt = canonicalizeTimestampText(now().toISOString())
  let transactionId: string | null = null

  // Keep schema, rows and provenance under one snapshot. A mapping committed
  // after the rows were read must not enter this bundle.
  const snapshot = await session.withReadOnlyTransaction(async () => {
    const [snapshotRow] = await session.query<{ snapshot: string }>(
      'select txid_current_snapshot()::text as snapshot'
    )
    transactionId = snapshotRow?.snapshot ?? null

    const identity = await session.identity()
    const catalog = await session.inspectCatalog()
    const appliedMigrations = await session.migrationLedger()

    if (
      identity.provider === 'supabase' &&
      catalog.columns.some((column) => column.table === 'profiles' && column.column === 'full_name')
    ) {
      await assertLegacyProfileData(session)
    }

    // Source assurance facts (sign-in providers, second factors) are captured
    // under the same snapshot: without them a review cannot tell that
    // provisioning an account would downgrade it.
    const inventory = await readIdentityInventory(session, identity.provider)
    const identities: IdentityFact[] = inventory.map((record) => ({
      id: record.id,
      email: record.email,
      emailConfirmed: record.emailConfirmed,
      hasCredential: record.hasCredential,
      providerIdentities: record.providerIdentities ?? null,
      mfaFactors: record.mfaFactors ?? null,
    }))

    const stats: ExportEntityStats[] = []
    for (const entity of ENTITY_ORDER) {
      const spec = entitySpec(entity)
      const filePath = join(request.directory, spec.file)
      try {
        stats.push(await streamEntity(session, entity, filePath, batchSize, limits))
      } catch (error) {
        throwExportFailure(entity, error)
      }
    }
    const [mappingTable] = await session.query<{ present: boolean }>(
      "select to_regclass('public.migration_record_map') is not null as present"
    )
    if (typeof mappingTable?.present !== 'boolean') {
      throw new MigrationRunError('E_CATALOG_PROBE', 'Could not determine whether the source provenance table exists.')
    }
    let provenance: ProvenanceStats
    try {
      provenance = await streamProvenance(
        session,
        identity.namespace,
        join(request.directory, PROVENANCE_FILE),
        batchSize,
        !mappingTable.present,
        limits.provenanceBytes
      )
    } catch (error) {
      throwExportFailure('provenance', error)
    }

    let identityStats: IdentityStats
    try {
      identityStats = writeIdentitiesFile(
        join(request.directory, IDENTITIES_FILE),
        identities,
        limits.identitiesBytes
      )
    } catch (error) {
      throwExportFailure('identities', error)
    }
    let retryHistory: RetryHistoryStats
    try {
      retryHistory = await writeRetryHistoryFile(
        session,
        identity.provider,
        identity.namespace,
        join(request.directory, RETRY_HISTORY_FILE),
        limits.retryHistoryBytes
      )
    } catch (error) {
      throwExportFailure('retry history', error)
    }
    return { identity, catalog, appliedMigrations, entities: stats, provenance, identities: identityStats, retryHistory }
  })
  const { identity, catalog, appliedMigrations, entities } = snapshot
  const { count: aliasCount, tableMissing: provenanceTableMissing } = snapshot.provenance
  const schemaFingerprint = computeSchemaFingerprint(catalog, identity.provider)

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
      runtimeFingerprint: identity.runtimeFingerprint,
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
      count: aliasCount,
      byteSize: snapshot.provenance.byteSize,
      sha256: snapshot.provenance.sha256,
    },
    identities: {
      file: IDENTITIES_FILE,
      count: snapshot.identities.count,
      byteSize: snapshot.identities.byteSize,
      sha256: snapshot.identities.sha256,
    },
    retryHistory: {
      file: RETRY_HISTORY_FILE,
      count: snapshot.retryHistory.count,
      byteSize: snapshot.retryHistory.byteSize,
      sha256: snapshot.retryHistory.sha256,
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
    aliasCount,
    identityCount: snapshot.identities.count,
    retryHistoryCount: snapshot.retryHistory.count,
    diagnostics: buildDiagnostics(catalog, counts, entities),
    statementLimits: SESSION_STATEMENT_LIMITS,
    provenanceTableMissing,
  }
}

/** Refuse to omit an independent legacy name from the portable profile row. */
export async function assertLegacyProfileData(session: Pick<DatabaseSession, 'query'>): Promise<void> {
  const [legacyProfile] = await session.query<{ divergent: number }>(
    `select count(*)::integer as divergent
       from public.profiles
      where full_name is not null and full_name is distinct from name`
  )
  if (!legacyProfile || legacyProfile.divergent !== 0) {
    throw new MigrationRunError(
      'E_LEGACY_PROFILE_DATA',
      'Legacy profiles.full_name contains data not represented by profiles.name; export requires review.'
    )
  }
}

/**
 * Write the source account assurance facts as canonical JSON. The file is
 * written exclusively and digest-bound in the manifest so `plan` can carry the
 * facts into the reviewed artifact and `apply` can fail closed without them.
 */
function writeIdentitiesFile(filePath: string, identities: IdentityFact[], limitBytes: number): IdentityStats {
  const contents = `${canonicalStringify({
    format: MIGRATION_FORMAT,
    formatVersion: MIGRATION_FORMAT_VERSION,
    identities,
  })}\n`
  const byteSize = Buffer.byteLength(contents, 'utf8')
  if (byteSize > limitBytes) {
    throw new MigrationRunError(
      'E_IDENTITIES_TOO_LARGE',
      'The source identity inventory exceeds the supported bundle size.'
    )
  }
  writeFileSync(filePath, contents, { flag: 'wx' })
  return { count: identities.length, byteSize, sha256: sha256Hex(contents) }
}

async function writeRetryHistoryFile(
  session: DatabaseSession,
  provider: 'native' | 'supabase',
  sourceNamespace: string,
  filePath: string,
  limitBytes: number
): Promise<RetryHistoryStats> {
  const cutoff = new Date(Date.now() - 97 * 24 * 60 * 60 * 1000).toISOString()
  const supportedOperations = [
    'create_timesheet', 'update_timesheet', 'delete_timesheet',
    'create_leave', 'delete_leave',
    'create_reminder', 'update_reminder', 'delete_reminder',
  ] as const
  const records: RetryHistoryFact[] = []
  if (provider === 'native') {
    const rows = await session.query<{
      key: string
      actor_id: string
      operation: RetryHistoryFact['operation']
      payload_fingerprint: string
      response_status: number
      committed_unknown: boolean
      created_at: string
    }>(
      `select key, actor_id::text as actor_id, operation, payload_fingerprint,
              response_status, committed_unknown,
              to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_at
         from public.idempotency_keys
        where created_at >= $1::timestamptz
          and operation = any($2::text[])
        order by key, actor_id, operation`,
      [cutoff, supportedOperations]
    )
    for (const row of rows) {
      const committed = row.response_status > 0 && !row.committed_unknown
      records.push({
        sourceNamespace,
        key: row.key,
        sourceActorId: row.actor_id,
        operation: row.operation,
        outcome: committed ? 'committed' : 'uncertain',
        responseStatus: committed ? row.response_status : 0,
        fingerprintKind: 'request-json-v1',
        fingerprint: /^[0-9a-f]{64}$/.test(row.payload_fingerprint) ? row.payload_fingerprint : null,
        sourceResourceId: null,
        createdAt: canonicalizeTimestampText(row.created_at),
      })
    }
  } else {
    const rows = await session.query<{
      key: string
      actor_id: string
      operation: RetryHistoryFact['operation']
      effect_fingerprint: string
      response_status: number
      resource_id: string | null
      created_at: string
    }>(
      `select key, actor_id::text as actor_id, operation, effect_fingerprint,
              response_status, resource_id,
              to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_at
         from public.idempotency_effects
        where created_at >= $1::timestamptz
          and operation = any($2::text[])
        order by key, actor_id, operation`,
      [cutoff, supportedOperations]
    )
    for (const row of rows) {
      records.push({
        sourceNamespace,
        key: row.key,
        sourceActorId: row.actor_id,
        operation: row.operation,
        outcome: row.response_status > 0 ? 'committed' : 'uncertain',
        responseStatus: row.response_status,
        fingerprintKind: 'effect-v1',
        fingerprint: /^[0-9a-f]{64}$/.test(row.effect_fingerprint) ? row.effect_fingerprint : null,
        sourceResourceId: row.resource_id,
        createdAt: canonicalizeTimestampText(row.created_at),
      })
    }
    const effectKeys = new Set(rows.map((row) => `${row.key}\u0000${row.actor_id}\u0000${row.operation}`))
    const legacyRows = await session.query<{
      key: string
      actor_id: string
      operation: RetryHistoryFact['operation']
      payload_fingerprint: string
      response_status: number
      committed_unknown: boolean
      created_at: string
    }>(
      `select key, actor_id::text as actor_id, operation, payload_fingerprint,
              response_status, committed_unknown,
              to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_at
         from public.idempotency_keys
        where created_at >= $1::timestamptz
          and operation = any($2::text[])
        order by key, actor_id, operation`,
      [cutoff, supportedOperations]
    )
    for (const row of legacyRows) {
      if (effectKeys.has(`${row.key}\u0000${row.actor_id}\u0000${row.operation}`)) continue
      const committed = row.response_status > 0 && !row.committed_unknown
      records.push({
        sourceNamespace,
        key: row.key,
        sourceActorId: row.actor_id,
        operation: row.operation,
        outcome: committed ? 'committed' : 'uncertain',
        responseStatus: committed ? row.response_status : 0,
        fingerprintKind: 'request-json-v1',
        fingerprint: /^[0-9a-f]{64}$/.test(row.payload_fingerprint) ? row.payload_fingerprint : null,
        sourceResourceId: null,
        createdAt: canonicalizeTimestampText(row.created_at),
      })
    }
  }
  const contents = `${canonicalStringify({
    format: MIGRATION_FORMAT,
    formatVersion: MIGRATION_FORMAT_VERSION,
    records,
  })}\n`
  const byteSize = Buffer.byteLength(contents, 'utf8')
  if (byteSize > limitBytes) {
    throw new MigrationRunError('E_RETRY_HISTORY_TOO_LARGE', 'The portable retry history exceeds the supported bundle size.')
  }
  writeFileSync(filePath, contents, { flag: 'wx' })
  return { count: records.length, byteSize, sha256: sha256Hex(contents) }
}

const BUNDLE_LIMIT_CODES = new Set([
  'E_ROW_TOO_LARGE',
  'E_ENTITY_TOO_LARGE',
  'E_PROVENANCE_TOO_LARGE',
  'E_IDENTITIES_TOO_LARGE',
  'E_RETRY_HISTORY_TOO_LARGE',
])

/**
 * Preserve an explicit bundle-limit rejection; wrap anything else as an
 * interruption so a partial directory is never mistaken for a bundle.
 */
function throwExportFailure(subject: string, error: unknown): never {
  if (error instanceof MigrationRunError && BUNDLE_LIMIT_CODES.has(error.code)) throw error
  throw new MigrationRunError(
    'E_EXPORT_INTERRUPTED',
    `Export of ${subject} was interrupted; the bundle is incomplete and will not validate: ${
      error instanceof Error ? error.message : String(error)
    }`
  )
}

/**
 * Stream one entity to disk with keyset pagination. The caller holds the
 * snapshot; only one batch is ever resident in memory.
 */
async function streamEntity(
  session: DatabaseSession,
  entity: MigrationEntity,
  filePath: string,
  batchSize: number,
  limits: ExportLimits
): Promise<ExportEntityStats> {
  const spec = entitySpec(entity)
  const file = checkedWriter(filePath)
  const hash = createHash('sha256')
  let rowCount = 0
  let byteSize = 0
  let batches = 0
  const incompatibleCounts = new Map<string, { count: number; rule: string }>()
  let cursor: Record<string, unknown> | null = null

  try {
    for (;;) {
      const rows = await readEntityBatch(session, entity, cursor, batchSize)
      if (rows.length === 0) break
      batches += 1
      let chunk = ''
      for (const [index, row] of rows.entries()) {
        const issue = incompatibleValue(entity, row)
        if (issue) {
          const current = incompatibleCounts.get(issue.column)
          incompatibleCounts.set(issue.column, { count: (current?.count ?? 0) + 1, rule: issue.rule })
        }
        const canonical = canonicalRowLine(entity, row)
        const lineBytes = Buffer.byteLength(canonical, 'utf8')
        if (lineBytes > limits.rowBytes) {
          throw new MigrationRunError(
            'E_ROW_TOO_LARGE',
            `${entity} row ${rowCount + index + 1} is ${lineBytes} bytes, above the ${limits.rowBytes}-byte bundle row limit; validation would reject the bundle.`
          )
        }
        const line = `${canonical}\n`
        chunk += line
        hash.update(line)
        byteSize += Buffer.byteLength(line, 'utf8')
        if (byteSize > limits.entityFileBytes) {
          throw new MigrationRunError(
            'E_ENTITY_TOO_LARGE',
            `${entity} exceeds the ${limits.entityFileBytes}-byte bundle entity limit; validation would reject the bundle.`
          )
        }
      }
      rowCount += rows.length
      await file.write(chunk)
      cursor = rows[rows.length - 1]
      if (rows.length < batchSize) break
    }
    await file.finish()
  } catch (error) {
    file.destroy()
    throw error
  }

  return {
    entity, file: spec.file, rowCount, byteSize, sha256: hash.digest('hex'), batches,
    incompatibleValues: [...incompatibleCounts].map(([column, value]) => ({ column, ...value })),
  }
}

function incompatibleValue(
  entity: MigrationEntity,
  row: Record<string, unknown>
): { column: string; rule: string } | null {
  if (entity === 'leaves' && typeof row.reason === 'string' && Array.from(row.reason).length > 500) {
    return { column: 'reason', rule: 'char_length(reason) <= 500' }
  }
  if (entity === 'reminders' && typeof row.message === 'string' && Array.from(row.message).length > 500) {
    return { column: 'message', rule: 'char_length(message) <= 500' }
  }
  if (entity === 'timesheets' && typeof row.hours_worked === 'string') {
    const hours = Number(row.hours_worked)
    if (!(hours > 0 && hours <= 24)) {
      return { column: 'hours_worked', rule: 'hours_worked > 0 AND hours_worked <= 24' }
    }
  }
  return null
}

/** Keep an error listener installed even while the next database batch is read. */
function checkedWriter(filePath: string) {
  const file = createWriteStream(filePath, { flags: 'wx' })
  let failure: Error | null = null
  file.on('error', (error: Error) => { failure = error })
  const check = () => { if (failure) throw failure }
  return {
    async write(chunk: string) {
      check()
      await new Promise<void>((resolve, reject) => {
        file.write(chunk, (error) => error ? reject(error) : resolve())
      })
      check()
    },
    async finish() {
      check()
      const finished = once(file, 'finish')
      file.end()
      await finished
      check()
    },
    destroy() { file.destroy() },
  }
}

/** Stream committed mapping aliases in primary-key order under the row snapshot. */
async function streamProvenance(
  session: DatabaseSession,
  targetNamespace: string,
  filePath: string,
  batchSize: number,
  tableMissing: boolean,
  provenanceBytes: number
): Promise<ProvenanceStats> {
  const file = checkedWriter(filePath)
  const hash = createHash('sha256')
  let count = 0
  let byteSize = 0
  let cursor: { source_namespace: string; entity: string; source_id: string } | null = null
  const append = async (chunk: string) => {
    const nextSize = byteSize + Buffer.byteLength(chunk, 'utf8')
    if (nextSize > provenanceBytes) {
      throw new MigrationRunError('E_PROVENANCE_TOO_LARGE', 'Provenance exceeds the supported bundle size.')
    }
    await file.write(chunk)
    hash.update(chunk)
    byteSize = nextSize
  }

  try {
    await append('{"aliases":[')
    if (!tableMissing) {
      for (;;) {
        const after: string = cursor
          ? 'and (m.source_namespace, m.entity, m.source_id) > ($2, $3, $4)'
          : ''
        const params: unknown[] = cursor
          ? [targetNamespace, cursor.source_namespace, cursor.entity, cursor.source_id, batchSize]
          : [targetNamespace, batchSize]
        const rows: ProvenanceRow[] = await session.query<ProvenanceRow>(
          `select m.entity, m.source_namespace, m.source_id, m.destination_id,
                  to_char(m.recorded_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as recorded_at
             from public.migration_record_map m
             join public.migration_runs r on r.run_id = m.run_id
               and r.source_namespace = m.source_namespace
               and r.target_namespace = $1
            where m.destination_id is not null
              and r.state in ('data-committed', 'verified', 'publication-intent', 'writable')
              ${after}
            order by m.source_namespace, m.entity, m.source_id
            limit $${params.length}`,
          params
        )
        if (rows.length === 0) break
        let chunk = ''
        let chunkBytes = 0
        for (const row of rows) {
          if (!ENTITY_ORDER.includes(row.entity as MigrationEntity)) continue
          const alias = {
            entity: row.entity,
            sourceId: decodePersistedKey(row.destination_id),
            destinationId: decodePersistedKey(row.source_id),
            instanceNamespace: row.source_namespace,
            recordedAt: row.recorded_at,
          }
          const encoded = `${count > 0 ? ',' : ''}${canonicalStringify(alias)}`
          chunkBytes += Buffer.byteLength(encoded, 'utf8')
          if (byteSize + chunkBytes > provenanceBytes) {
            throw new MigrationRunError('E_PROVENANCE_TOO_LARGE', 'Provenance exceeds the supported bundle size.')
          }
          chunk += encoded
          count += 1
        }
        if (chunk) await append(chunk)
        cursor = rows[rows.length - 1]
        if (rows.length < batchSize) break
      }
    }
    await append(`],"format":${canonicalStringify(MIGRATION_FORMAT)},"formatVersion":${canonicalStringify(MIGRATION_FORMAT_VERSION)}}\n`)
    await file.finish()
  } catch (error) {
    file.destroy()
    throw error
  }
  return { count, byteSize, sha256: hash.digest('hex'), tableMissing }
}

/**
 * Report schema drift instead of silently rewriting source records: unmapped
 * deployed tables/columns, canonical columns the deployment lacks, and the
 * provider storage differences that are value-compatible.
 */
const MIGRATION_RECEIPT_TABLES = new Set([
  'migration_runs',
  'migration_record_map',
  'migration_identity_journal',
  'migration_record_dispositions',
  'migration_retry_history',
])

function buildDiagnostics(
  catalog: CatalogInspection,
  counts: Record<MigrationEntity, number>,
  entities: ExportEntityStats[]
): ExportDiagnostics {
  const unmappedTables = catalog.tables.filter(
    (table) =>
      !ENTITY_ORDER.includes(table as MigrationEntity) &&
      table !== 'schema_migrations' &&
      !MIGRATION_RECEIPT_TABLES.has(table)
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
    incompatibleValues: entities.flatMap((stats) => stats.incompatibleValues.map((issue) => ({ entity: stats.entity, ...issue }))),
  }
}

/** Read one entity completely (small tables, diagnostics, tests). */
export { readEntityRows }
