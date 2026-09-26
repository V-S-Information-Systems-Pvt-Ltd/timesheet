// lib/migration/validation.ts
// Offline bundle validation. Nothing here connects to a database: it reads the
// bundle directory, rejects anything outside the allowlisted format, and
// verifies byte counts, digests, canonical rows, primary-key uniqueness and
// dependency order before any import is allowed to plan against it.

import { createHash } from 'node:crypto'
import { createReadStream, lstatSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  BUNDLE_FILES,
  BUNDLE_LIMITS,
  CANONICALIZATION_VERSION,
  ENTITY_ORDER,
  ENTITY_SPECS,
  IDENTITIES_FILE,
  MANIFEST_FILE,
  MIGRATION_FORMAT,
  MIGRATION_FORMAT_VERSION,
  PROVENANCE_FILE,
  RETRY_HISTORY_FILE,
  MigrationFormatError,
  bundleDigestOf,
  canonicalRowLine,
  canonicalizeRow,
  entitySpec,
  identitiesFileSchema,
  isMigrationEntity,
  manifestSchema,
  primaryKeyOf,
  provenanceSchema,
  retryHistoryFileSchema,
  sha256Hex,
  type BundleManifest,
  type IdentityFact,
  type MigrationEntity,
  type ProvenanceAlias,
  type RetryHistoryFact,
} from './format'

export interface ValidationIssue {
  code: string
  message: string
  path?: string
}

export interface EntityValidation {
  entity: MigrationEntity
  file: string
  rowCount: number
  byteSize: number
  sha256: string
  primaryKeyCount: number
}

export interface BundleValidationResult {
  ok: boolean
  directory: string
  manifest: BundleManifest | null
  bundleDigest: string | null
  entities: EntityValidation[]
  aliases: ProvenanceAlias[]
  /** Source account assurance facts; empty when the bundle predates capture. */
  sourceIdentities: IdentityFact[]
  sourceRetryHistory: RetryHistoryFact[]
  retryHistoryCaptured: boolean
  errors: ValidationIssue[]
  warnings: ValidationIssue[]
}

const MAX_ISSUES = 100

class IssueCollector {
  readonly errors: ValidationIssue[] = []
  readonly warnings: ValidationIssue[] = []

  error(code: string, message: string, path?: string): void {
    if (this.errors.length < MAX_ISSUES) this.errors.push(path ? { code, message, path } : { code, message })
  }

  warn(code: string, message: string, path?: string): void {
    if (this.warnings.length < MAX_ISSUES) this.warnings.push(path ? { code, message, path } : { code, message })
  }

  get overflowed(): boolean {
    return this.errors.length >= MAX_ISSUES
  }
}

function fail(result: BundleValidationResult, code: string, message: string, path?: string): BundleValidationResult {
  result.ok = false
  result.errors.push(path ? { code, message, path } : { code, message })
  return result
}

interface EntityFileCheck {
  rowCount: number
  byteSize: number
  sha256: string
  primaryKeyCount: number
}

async function inspectEntityFile(
  path: string,
  entity: MigrationEntity,
  collector: IssueCollector
): Promise<EntityFileCheck> {
  const hash = createHash('sha256')
  const seen = new Set<string>()
  let rowCount = 0
  let byteSize = 0
  let truncated = false

  const processLine = (line: Buffer): void => {
    const text = line.length > 0 && line[line.length - 1] === 0x0d
      ? line.subarray(0, line.length - 1).toString('utf8')
      : line.toString('utf8')
    if (text.length === 0) {
      collector.error('E_EMPTY_LINE', `${entity} file contains an empty line.`, path)
      return
    }
    if (line.length > BUNDLE_LIMITS.rowBytes) {
      collector.error('E_ROW_TOO_LARGE', `${entity} row exceeds the row byte limit.`, path)
      return
    }
    rowCount += 1
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      collector.error('E_JSON_INVALID', `${entity} row ${rowCount} is not valid JSON.`, path)
      return
    }
    try {
      const canonical = canonicalRowLine(entity, parsed)
      if (canonical !== text) {
        collector.error('E_NON_CANONICAL_ROW', `${entity} row ${rowCount} is not in canonical form.`, path)
      }
      const row = JSON.parse(canonical) as Record<string, string | number | boolean | null>
      const key = primaryKeyOf(entity, row)
      if (seen.has(key)) {
        collector.error(
          'E_DUPLICATE_ID',
          `${entity} row ${rowCount} repeats primary key ${key.split('\u0000').join('/')}.`,
          path
        )
      }
      seen.add(key)
    } catch (err) {
      if (err instanceof MigrationFormatError) {
        collector.error(err.code, `${entity} row ${rowCount}: ${err.message}`, path)
      } else {
        collector.error('E_ROW_SCHEMA', `${entity} row ${rowCount} failed validation.`, path)
      }
    }
  }

  const stream = createReadStream(path, { highWaterMark: 1024 * 1024 })
  let remainder: Buffer = Buffer.alloc(0)
  let skippingOversizedLine = false
  try {
    for await (const chunk of stream as AsyncIterable<Buffer>) {
      hash.update(chunk)
      byteSize += chunk.length
      let start = 0
      for (;;) {
        const newline = chunk.indexOf(0x0a, start)
        if (newline === -1) {
          if (start < chunk.length) {
            const nextSlice = chunk.subarray(start)
            if (skippingOversizedLine) {
              // Already reported E_ROW_TOO_LARGE, discard slice while scanning for newline
            } else if (remainder.length + nextSlice.length > BUNDLE_LIMITS.rowBytes) {
              collector.error('E_ROW_TOO_LARGE', `${entity} row exceeds the row byte limit.`, path)
              skippingOversizedLine = true
              remainder = Buffer.alloc(0)
            } else {
              remainder = remainder.length === 0 ? nextSlice : Buffer.concat([remainder, nextSlice])
            }
          }
          break
        }
        if (skippingOversizedLine) {
          skippingOversizedLine = false
          remainder = Buffer.alloc(0)
          start = newline + 1
          if (collector.overflowed) break
          continue
        }
        const slice = chunk.subarray(start, newline)
        if (remainder.length + slice.length > BUNDLE_LIMITS.rowBytes) {
          collector.error('E_ROW_TOO_LARGE', `${entity} row exceeds the row byte limit.`, path)
          remainder = Buffer.alloc(0)
          start = newline + 1
          if (collector.overflowed) break
          continue
        }
        const line = remainder.length === 0 ? slice : Buffer.concat([remainder, slice])
        remainder = Buffer.alloc(0)
        start = newline + 1
        processLine(line)
        if (collector.overflowed) break
      }
      if (collector.overflowed) break
    }
  } finally {
    stream.destroy()
  }

  if (skippingOversizedLine) {
    // Already reported E_ROW_TOO_LARGE
  } else if (remainder.length > 0 && !collector.overflowed) {
    truncated = true
    processLine(remainder)
  }
  if (truncated) {
    collector.error('E_TRUNCATED', `${entity} file does not end with a newline (truncated write).`, path)
  }

  return {
    rowCount,
    byteSize,
    sha256: hash.digest('hex'),
    primaryKeyCount: seen.size,
  }
}

function checkDependencyOrder(manifest: BundleManifest, collector: IssueCollector): void {
  const seen = new Set<string>()
  for (const file of manifest.entities) {
    if (!isMigrationEntity(file.entity)) continue
    for (const dependency of ENTITY_SPECS[file.entity].dependsOn) {
      if (!seen.has(dependency)) {
        collector.error(
          'E_ENTITY_ORDER',
          `${file.entity} is listed before its dependency ${dependency}.`,
          file.file
        )
      }
    }
    seen.add(file.entity)
  }
}

export async function validateBundleDirectory(
  directory: string,
  limits: { manifestBytes?: number; entityFileBytes?: number } = {}
): Promise<BundleValidationResult> {
  const result: BundleValidationResult = {
    ok: true,
    directory,
    manifest: null,
    bundleDigest: null,
    entities: [],
    aliases: [],
    sourceIdentities: [],
    sourceRetryHistory: [],
    retryHistoryCaptured: false,
    errors: [],
    warnings: [],
  }
  const collector = new IssueCollector()

  let directoryStat
  try {
    directoryStat = lstatSync(directory)
  } catch {
    return fail(result, 'E_BUNDLE_MISSING', `Bundle directory does not exist: ${directory}`)
  }
  if (directoryStat.isSymbolicLink()) {
    return fail(result, 'E_SYMLINK', 'Bundle path is a symlink; refusing to follow it.')
  }
  if (!directoryStat.isDirectory()) {
    return fail(result, 'E_BUNDLE_NOT_DIRECTORY', `Bundle path is not a directory: ${directory}`)
  }

  const entries = readdirSync(directory)
  for (const entry of entries) {
    const entryPath = join(directory, entry)
    const stat = lstatSync(entryPath)
    if (stat.isSymbolicLink()) {
      collector.error('E_SYMLINK', 'Symlinks are not allowed inside a bundle.', entryPath)
      continue
    }
    if (stat.isDirectory()) {
      collector.error('E_UNKNOWN_ENTRY', 'Directories are not allowed inside a bundle.', entryPath)
      continue
    }
    if (!BUNDLE_FILES.includes(entry)) {
      if (entry.endsWith('.jsonl')) {
        collector.error('E_UNKNOWN_ENTITY', `Unknown entity file: ${entry}`, entryPath)
      } else {
        collector.error('E_UNKNOWN_FILE', `Unknown bundle file: ${entry}`, entryPath)
      }
    }
  }

  const manifestPath = join(directory, MANIFEST_FILE)
  let rawManifest: string
  try {
    const stat = statSync(manifestPath)
    if (stat.size > (limits.manifestBytes ?? BUNDLE_LIMITS.manifestBytes)) {
      return fail(result, 'E_FILE_TOO_LARGE', 'manifest.json exceeds the size limit.', manifestPath)
    }
    rawManifest = readFileSync(manifestPath, 'utf8')
  } catch {
    return fail(result, 'E_MANIFEST_MISSING', 'manifest.json is missing from the bundle.')
  }

  let parsedManifest: unknown
  try {
    parsedManifest = JSON.parse(rawManifest)
  } catch {
    return fail(result, 'E_MANIFEST_PARSE', 'manifest.json is not valid JSON.', manifestPath)
  }

  if (parsedManifest === null || typeof parsedManifest !== 'object' || Array.isArray(parsedManifest)) {
    return fail(result, 'E_MANIFEST_SCHEMA', 'manifest.json must be a JSON object.', manifestPath)
  }

  const discriminator = (parsedManifest as { format?: unknown }).format
  if (discriminator !== MIGRATION_FORMAT) {
    return fail(
      result,
      'E_FORMAT_DISCRIMINATOR',
      `Unsupported bundle format discriminator: ${String(discriminator)}`
    )
  }
  const formatVersion = (parsedManifest as { formatVersion?: unknown }).formatVersion
  if (formatVersion !== MIGRATION_FORMAT_VERSION) {
    return fail(result, 'E_FORMAT_VERSION', `Unsupported formatVersion: ${String(formatVersion)}`)
  }
  const canonicalizationVersion = (parsedManifest as { canonicalizationVersion?: unknown })
    .canonicalizationVersion
  if (canonicalizationVersion !== CANONICALIZATION_VERSION) {
    return fail(
      result,
      'E_CANONICALIZATION_VERSION',
      `Unsupported canonicalizationVersion: ${String(canonicalizationVersion)}`
    )
  }

  const manifestParse = manifestSchema.safeParse(parsedManifest)
  if (!manifestParse.success) {
    for (const issue of manifestParse.error.issues.slice(0, MAX_ISSUES)) {
      collector.error(
        'E_MANIFEST_SCHEMA',
        `manifest${issue.path.length ? `.${issue.path.join('.')}` : ''}: ${issue.message}`,
        manifestPath
      )
    }
    result.errors = collector.errors
    result.ok = false
    return result
  }
  const manifest = manifestParse.data
  result.manifest = manifest
  result.bundleDigest = bundleDigestOf(manifest)

  // The identity inventory is optional, but the file itself is only ever
  // legitimate when the manifest declares and digest-binds it.
  if (entries.includes(IDENTITIES_FILE) && !manifest.identities) {
    collector.error(
      'E_UNKNOWN_FILE',
      'identities.json is present but the manifest does not declare it.',
      join(directory, IDENTITIES_FILE)
    )
  }
  if (entries.includes(RETRY_HISTORY_FILE) && !manifest.retryHistory) {
    collector.error(
      'E_UNKNOWN_FILE',
      'retry-history.json is present but the manifest does not declare it.',
      join(directory, RETRY_HISTORY_FILE)
    )
  }

  // Every declared entity must appear exactly once, in dependency order.
  const declared: string[] = []
  for (const file of manifest.entities) {
    if (!isMigrationEntity(file.entity)) {
      collector.error('E_UNKNOWN_ENTITY', `Manifest declares unknown entity "${file.entity}".`, file.file)
      continue
    }
    if (declared.includes(file.entity)) {
      collector.error('E_ENTITY_DUPLICATE', `Manifest declares entity "${file.entity}" twice.`, file.file)
      continue
    }
    declared.push(file.entity)
    const spec = entitySpec(file.entity)
    if (file.file !== spec.file) {
      collector.error(
        'E_ENTITY_FILE_NAME',
        `Entity ${file.entity} must use file ${spec.file}, found ${file.file}.`,
        file.file
      )
    }
    if (file.primaryKey.join(',') !== spec.primaryKey.join(',')) {
      collector.error('E_ENTITY_PRIMARY_KEY', `Entity ${file.entity} primary key mismatch.`, file.file)
    }
    if (file.columns.join(',') !== spec.columns.map((c) => c.name).join(',')) {
      collector.error('E_ENTITY_COLUMNS', `Entity ${file.entity} column list mismatch.`, file.file)
    }
  }
  const missing = ENTITY_ORDER.filter((entity) => !declared.includes(entity))
  if (missing.length > 0) {
    collector.error('E_ENTITY_MISSING', `Manifest is missing entities: ${missing.join(', ')}.`)
  }
  checkDependencyOrder(manifest, collector)

  for (const file of manifest.entities) {
    if (!isMigrationEntity(file.entity)) continue
    const filePath = join(directory, file.file)
    let stat
    try {
      stat = statSync(filePath)
    } catch {
      collector.error('E_ENTITY_FILE_MISSING', `Missing data file for ${file.entity}.`, filePath)
      continue
    }
    if (stat.size > (limits.entityFileBytes ?? BUNDLE_LIMITS.entityFileBytes)) {
      collector.error('E_FILE_TOO_LARGE', `${file.file} exceeds the size limit.`, filePath)
      continue
    }
    const check = await inspectEntityFile(filePath, file.entity, collector)
    // When the issue collector overflowed mid-file, the scan stopped early and
    // the partial counts/sizes below would only add misleading secondary
    // failures on top of the real cause.
    if (!collector.overflowed) {
      if (check.rowCount !== file.rowCount) {
        collector.error(
          'E_ROW_COUNT_MISMATCH',
          `${file.file} has ${check.rowCount} rows but the manifest declares ${file.rowCount}.`,
          filePath
        )
      }
      if (check.byteSize !== file.byteSize) {
        collector.error(
          'E_SIZE_MISMATCH',
          `${file.file} is ${check.byteSize} bytes but the manifest declares ${file.byteSize}.`,
          filePath
        )
      }
      if (check.sha256 !== file.sha256) {
        collector.error('E_HASH_MISMATCH', `${file.file} digest does not match the manifest.`, filePath)
      }
    }
    result.entities.push({
      entity: file.entity,
      file: file.file,
      rowCount: check.rowCount,
      byteSize: check.byteSize,
      sha256: check.sha256,
      primaryKeyCount: check.primaryKeyCount,
    })
  }

  const provenancePath = join(directory, PROVENANCE_FILE)
  try {
    const stat = statSync(provenancePath)
    if (stat.size > BUNDLE_LIMITS.provenanceBytes) {
      collector.error('E_FILE_TOO_LARGE', 'provenance.json exceeds the size limit.', provenancePath)
    } else {
      const raw = readFileSync(provenancePath, 'utf8')
      const parsed = JSON.parse(raw) as unknown
      const provenanceParse = provenanceSchema.safeParse(parsed)
      if (!provenanceParse.success) {
        for (const issue of provenanceParse.error.issues.slice(0, MAX_ISSUES)) {
          collector.error('E_PROVENANCE_SCHEMA', `provenance: ${issue.message}`, provenancePath)
        }
      } else {
        if (sha256Hex(raw) !== manifest.provenance.sha256) {
          collector.error('E_HASH_MISMATCH', 'provenance.json digest does not match the manifest.', provenancePath)
        }
        if (Buffer.byteLength(raw, 'utf8') !== manifest.provenance.byteSize) {
          collector.error('E_SIZE_MISMATCH', 'provenance.json byte size does not match the manifest.', provenancePath)
        }
        if (provenanceParse.data.aliases.length !== manifest.provenance.count) {
          collector.error('E_ROW_COUNT_MISMATCH', 'provenance.json alias count does not match the manifest.', provenancePath)
        }
        for (const alias of provenanceParse.data.aliases) {
          if (!isMigrationEntity(alias.entity)) {
            collector.error('E_PROVENANCE_SCHEMA', `provenance alias has unknown entity "${alias.entity}".`, provenancePath)
            continue
          }
          result.aliases.push(alias)
        }
      }
    }
  } catch {
    collector.error('E_PROVENANCE_MISSING', 'provenance.json is missing from the bundle.', provenancePath)
  }

  if (manifest.identities) {
    const identitiesPath = join(directory, IDENTITIES_FILE)
    let raw: string | null = null
    try {
      const stat = statSync(identitiesPath)
      if (stat.size > BUNDLE_LIMITS.identitiesBytes) {
        collector.error('E_FILE_TOO_LARGE', 'identities.json exceeds the size limit.', identitiesPath)
      } else {
        raw = readFileSync(identitiesPath, 'utf8')
      }
    } catch {
      collector.error('E_IDENTITIES_MISSING', 'identities.json is missing from the bundle.', identitiesPath)
    }
    if (raw !== null) {
      let parsed: unknown
      try {
        parsed = JSON.parse(raw) as unknown
      } catch {
        collector.error('E_IDENTITIES_PARSE', 'identities.json is not valid JSON.', identitiesPath)
        parsed = undefined
      }
      if (parsed !== undefined) {
        const identitiesParse = identitiesFileSchema.safeParse(parsed)
        if (!identitiesParse.success) {
          for (const issue of identitiesParse.error.issues.slice(0, MAX_ISSUES)) {
            collector.error('E_IDENTITIES_SCHEMA', `identities: ${issue.message}`, identitiesPath)
          }
        } else {
          if (sha256Hex(raw) !== manifest.identities.sha256) {
            collector.error('E_HASH_MISMATCH', 'identities.json digest does not match the manifest.', identitiesPath)
          }
          if (Buffer.byteLength(raw, 'utf8') !== manifest.identities.byteSize) {
            collector.error('E_SIZE_MISMATCH', 'identities.json byte size does not match the manifest.', identitiesPath)
          }
          if (identitiesParse.data.identities.length !== manifest.identities.count) {
            collector.error(
              'E_ROW_COUNT_MISMATCH',
              'identities.json account count does not match the manifest.',
              identitiesPath
            )
          }
          result.sourceIdentities.push(...identitiesParse.data.identities)
        }
      }
    }
  }

  if (manifest.retryHistory) {
    result.retryHistoryCaptured = true
    const retryPath = join(directory, RETRY_HISTORY_FILE)
    let raw: string | null = null
    try {
      const stat = statSync(retryPath)
      if (stat.size > BUNDLE_LIMITS.retryHistoryBytes) {
        collector.error('E_FILE_TOO_LARGE', 'retry-history.json exceeds the size limit.', retryPath)
      } else {
        raw = readFileSync(retryPath, 'utf8')
      }
    } catch {
      collector.error('E_RETRY_HISTORY_MISSING', 'retry-history.json is missing from the bundle.', retryPath)
    }
    if (raw !== null) {
      let parsed: unknown
      try {
        parsed = JSON.parse(raw) as unknown
      } catch {
        collector.error('E_RETRY_HISTORY_PARSE', 'retry-history.json is not valid JSON.', retryPath)
        parsed = undefined
      }
      if (parsed !== undefined) {
        const historyParse = retryHistoryFileSchema.safeParse(parsed)
        if (!historyParse.success) {
          for (const item of historyParse.error.issues.slice(0, MAX_ISSUES)) {
            collector.error('E_RETRY_HISTORY_SCHEMA', `retry history: ${item.message}`, retryPath)
          }
        } else {
          for (const [index, record] of historyParse.data.records.entries()) {
            if (record.sourceNamespace !== manifest.source.namespace) {
              collector.error(
                'E_RETRY_HISTORY_NAMESPACE',
                `retry history record ${index + 1} belongs to ${record.sourceNamespace}, not the manifest source namespace.`,
                retryPath
              )
            }
          }
          if (sha256Hex(raw) !== manifest.retryHistory.sha256) {
            collector.error('E_HASH_MISMATCH', 'retry-history.json digest does not match the manifest.', retryPath)
          }
          if (Buffer.byteLength(raw, 'utf8') !== manifest.retryHistory.byteSize) {
            collector.error('E_SIZE_MISMATCH', 'retry-history.json byte size does not match the manifest.', retryPath)
          }
          if (historyParse.data.records.length !== manifest.retryHistory.count) {
            collector.error('E_ROW_COUNT_MISMATCH', 'retry-history.json count does not match the manifest.', retryPath)
          }
          result.sourceRetryHistory.push(...historyParse.data.records)
        }
      }
    }
  }

  result.errors = collector.errors
  result.warnings = collector.warnings
  result.ok = collector.errors.length === 0
  return result
}

/**
 * Read the canonical rows of a validated bundle. Validation has already proven
 * digests and row shape; this re-parses defensively so planning never trusts a
 * file it did not decode itself.
 */
export async function loadBundleRows(
  directory: string,
  manifest: BundleManifest,
  options: { expectedBundleDigest?: string | null } = {}
): Promise<Record<MigrationEntity, import('./format').CanonicalRow[]>> {
  if (options.expectedBundleDigest) {
    const manifestPath = join(directory, MANIFEST_FILE)
    let parsed: unknown
    try {
      parsed = JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown
    } catch {
      throw new MigrationFormatError('E_BUNDLE_CHANGED', 'manifest.json could not be reread after validation.', manifestPath)
    }
    const parsedManifest = manifestSchema.safeParse(parsed)
    if (!parsedManifest.success || bundleDigestOf(parsedManifest.data) !== options.expectedBundleDigest) {
      throw new MigrationFormatError(
        'E_BUNDLE_CHANGED',
        'The bundle manifest changed after validation; refusing to plan against a stale digest.',
        manifestPath
      )
    }
  }

  const rows = {} as Record<MigrationEntity, import('./format').CanonicalRow[]>
  for (const entity of ENTITY_ORDER) {
    rows[entity] = []
    const file = manifest.entities.find((entry) => entry.entity === entity)
    if (!file) continue

    const filePath = join(directory, file.file)
    const hash = createHash('sha256')
    let byteSize = 0
    let rowCount = 0
    let remainder: Buffer = Buffer.alloc(0)
    const stream = createReadStream(filePath, { highWaterMark: 1024 * 1024 })

    const processLine = (line: Buffer): void => {
      const textBuffer = line.length > 0 && line[line.length - 1] === 0x0d
        ? line.subarray(0, line.length - 1)
        : line
      if (textBuffer.length === 0) {
        throw new MigrationFormatError('E_EMPTY_LINE', `${entity} file contains an empty line.`, filePath)
      }
      if (textBuffer.length > BUNDLE_LIMITS.rowBytes) {
        throw new MigrationFormatError('E_ROW_TOO_LARGE', `${entity} row exceeds the row byte limit.`, filePath)
      }
      rowCount += 1
      const text = textBuffer.toString('utf8')
      let parsedRow: unknown
      try {
        parsedRow = JSON.parse(text) as unknown
      } catch {
        throw new MigrationFormatError('E_JSON_INVALID', `${entity} row ${rowCount} is not valid JSON.`, filePath)
      }
      const row = canonicalizeRow(entity, parsedRow)
      if (canonicalRowLine(entity, row) !== text) {
        throw new MigrationFormatError('E_NON_CANONICAL_ROW', `${entity} row ${rowCount} is not in canonical form.`, filePath)
      }
      rows[entity].push(row)
    }

    try {
      for await (const chunk of stream as AsyncIterable<Buffer>) {
        hash.update(chunk)
        byteSize += chunk.length
        let start = 0
        for (;;) {
          const newline = chunk.indexOf(0x0a, start)
          if (newline === -1) {
            const slice = chunk.subarray(start)
            if (slice.length > 0) {
              if (remainder.length + slice.length > BUNDLE_LIMITS.rowBytes) {
                throw new MigrationFormatError('E_ROW_TOO_LARGE', `${entity} row exceeds the row byte limit.`, filePath)
              }
              remainder = remainder.length === 0 ? slice : Buffer.concat([remainder, slice])
            }
            break
          }
          const slice = chunk.subarray(start, newline)
          if (remainder.length + slice.length > BUNDLE_LIMITS.rowBytes) {
            throw new MigrationFormatError('E_ROW_TOO_LARGE', `${entity} row exceeds the row byte limit.`, filePath)
          }
          const line = remainder.length === 0 ? slice : Buffer.concat([remainder, slice])
          remainder = Buffer.alloc(0)
          processLine(line)
          start = newline + 1
        }
      }
    } finally {
      stream.destroy()
    }

    if (remainder.length > 0) {
      throw new MigrationFormatError('E_TRUNCATED', `${entity} file does not end with a newline.`, filePath)
    }
    const digest = hash.digest('hex')
    if (rowCount !== file.rowCount) {
      throw new MigrationFormatError(
        'E_ROW_COUNT_MISMATCH',
        `${file.file} has ${rowCount} rows but the manifest declares ${file.rowCount}.`,
        filePath
      )
    }
    if (byteSize !== file.byteSize) {
      throw new MigrationFormatError(
        'E_SIZE_MISMATCH',
        `${file.file} is ${byteSize} bytes but the manifest declares ${file.byteSize}.`,
        filePath
      )
    }
    if (digest !== file.sha256) {
      throw new MigrationFormatError('E_HASH_MISMATCH', `${file.file} digest changed after validation.`, filePath)
    }
  }
  return rows
}
