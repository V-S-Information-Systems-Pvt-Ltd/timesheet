// tests/migration-export.test.ts
// C03 exporter contract without a live database: keyset pagination, bounded
// batches, byte/count/digest accuracy, diagnostics, and the guarantee that an
// interrupted export never leaves an importable bundle.
//
// The live volume/round-trip evidence lives in tests/migration-export.int.test.ts.

import { afterAll, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ENTITY_ORDER,
  MANIFEST_FILE,
  MigrationFormatError,
  canonicalStringify,
  canonicalizeRow,
  sha256Hex,
  type MigrationEntity,
} from '@/lib/migration/format'
import { EXPORT_BATCH_SIZE, exportBundle } from '@/lib/migration/export'
import { validateBundleDirectory } from '@/lib/migration/validation'
import { readEntityBatch } from '@/lib/migration/providers/read'
import type { CatalogInspection } from '@/lib/migration/schema'

const workspace = mkdtempSync(join(tmpdir(), 'vsis-export-'))
afterAll(() => rmSync(workspace, { recursive: true, force: true }))

let counter = 0
function bundleDir(name: string): string {
  counter += 1
  return join(workspace, `${name}-${counter}`)
}

interface FakeSessionOptions {
  rows?: Partial<Record<MigrationEntity, Array<Record<string, unknown>>>>
  failOnBatch?: number
  onQuery?: (text: string, params?: unknown[]) => void
}

/**
 * Minimal session that answers batch queries from an in-memory table map and
 * records every statement, so the exporter's pagination can be asserted
 * exactly. Only SELECTs are accepted, mirroring the real read-only session.
 */
function fakeSession(options: FakeSessionOptions = {}) {
  const calls: Array<{ text: string; params: unknown[] }> = []
  let batch = 0
  const catalog: CatalogInspection = {
    tables: [...ENTITY_ORDER, 'schema_migrations'],
    columns: [],
    hasAuthSchema: false,
    hasNativeMigrationLedger: true,
    hasSupabaseMigrationLedger: false,
  }
  return {
    calls,
    provider: 'native' as const,
    displayTarget: 'fake',
    async identity() {
      return {
        provider: 'native' as const,
        namespace: 'native:fake',
        runtimeFingerprint: 'rt-fake',
        database: 'fake',
        serverVersion: '17.6',
        postmasterStartedAt: '2026-09-19 00:00:00+00',
        systemIdentifier: '1',
        displayTarget: 'fake',
      }
    },
    async inspectCatalog() {
      return catalog
    },
    async migrationLedger() {
      return ['0001_initial_schema.sql']
    },
    async assertReadOnly() {},
    async countRows() {
      return 0
    },
    async withReadOnlyTransaction<T>(fn: () => Promise<T>): Promise<T> {
      return fn()
    },
    async query<T extends Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]> {
      if (!/^\s*select\b/i.test(text)) throw new Error('fake session only executes SELECT statements')
      calls.push({ text, params: params ?? [] })
      options.onQuery?.(text, params)
      if (text.includes('txid_current_snapshot')) return [{ snapshot: '100:100:' }] as unknown as T[]
      if (text.includes('migration_record_map')) return [] as unknown as T[]
      const match = /from public\.([a-z_]+)/.exec(text)
      if (!match) return [] as unknown as T[]
      const entity = match[1] as MigrationEntity
      batch += 1
      if (options.failOnBatch && batch === options.failOnBatch) {
        throw new Error('simulated connection loss')
      }
      const table = options.rows?.[entity] ?? []
      const limit = Number(params?.[params.length - 1] ?? EXPORT_BATCH_SIZE)
      const after = text.includes('where (')
        ? (params?.[0] as string | undefined)
        : undefined
      const ordered = [...table].sort((a, b) => String(a.id).localeCompare(String(b.id)))
      const filtered = after ? ordered.filter((row) => String(row.id) > after) : ordered
      return filtered.slice(0, limit).map((row) => ({ ...row })) as unknown as T[]
    },
    async close() {},
  }
}

function projectRow(index: number): Record<string, unknown> {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    name: `Project ${index}`,
    so_number: index % 3 === 0 ? null : `SO-${index}`,
    telegram_no: index % 5 === 0 ? null : index,
    created_at: '2026-09-01T08:00:00.000000Z',
  }
}

describe('C03 exporter streaming', () => {
  it('streams a table across batches with keyset pagination and exact digests', async () => {
    const rows = Array.from({ length: 25 }, (_, index) => projectRow(index + 1))
    const session = fakeSession({ rows: { projects: rows } })
    const directory = bundleDir('paged')
    const result = await exportBundle(session as never, {
      directory,
      runId: 'run-export-1',
      bundleId: 'bundle-export-1',
      applicationVersion: '1.0.3',
      batchSize: 10,
    })

    const projectStats = result.entities.find((stats) => stats.entity === 'projects')
    expect(projectStats?.rowCount).toBe(25)
    expect(projectStats?.batches).toBe(3)

    // Every batch after the first used a keyset cursor.
    const batches = session.calls.filter((call) => /from public\.projects/.test(call.text))
    expect(batches.length).toBeGreaterThanOrEqual(3)
    expect(batches[0].text).not.toContain('where (')
    for (const call of batches.slice(1)) expect(call.text).toContain('where (')

    // The file content matches the recorded byte/digest contract.
    const contents = readFileSync(join(directory, 'projects.jsonl'), 'utf8')
    const lines = contents.trimEnd().split('\n')
    expect(lines).toHaveLength(25)
    expect(projectStats?.sha256).toBe(sha256Hex(contents))
    expect(projectStats?.byteSize).toBe(Buffer.byteLength(contents, 'utf8'))
    for (const line of lines) expect(() => canonicalizeRow('projects', JSON.parse(line))).not.toThrow()
  })

  it('produces a bundle that passes offline validation, manifest last', async () => {
    const session = fakeSession({ rows: { projects: [projectRow(1), projectRow(2)] } })
    const directory = bundleDir('valid')
    const result = await exportBundle(session as never, {
      directory,
      runId: 'run-export-2',
      bundleId: 'bundle-export-2',
      applicationVersion: '1.0.3',
    })

    const validation = await validateBundleDirectory(directory)
    expect(validation.errors).toEqual([])
    expect(validation.ok).toBe(true)
    expect(validation.manifest?.snapshot.transactionId).toBe('100:100:')
    expect(result.manifest.snapshot.mode).toBe('repeatable-read')

    // An empty entity file is still written and declared.
    expect(readdirSync(directory).sort()).toEqual(
      [...ENTITY_ORDER.map((entity) => `${entity}.jsonl`), MANIFEST_FILE, 'provenance.json'].sort()
    )
  })

  it('leaves no importable bundle when an export is interrupted', async () => {
    const rows = Array.from({ length: 30 }, (_, index) => projectRow(index + 1))
    const session = fakeSession({ rows: { projects: rows }, failOnBatch: 2 })
    const directory = bundleDir('interrupted')
    await expect(
      exportBundle(session as never, {
        directory,
        runId: 'run-export-3',
        bundleId: 'bundle-export-3',
        applicationVersion: '1.0.3',
        batchSize: 10,
      })
    ).rejects.toThrow(/E_EXPORT_INTERRUPTED|incomplete/)

    expect(existsSync(join(directory, MANIFEST_FILE))).toBe(false)
    const validation = await validateBundleDirectory(directory)
    expect(validation.ok).toBe(false)
  })

  it('reports schema drift instead of rewriting source records', async () => {
    const session = fakeSession({ rows: { projects: [projectRow(1)] } })
    ;(session as unknown as { inspectCatalog: () => Promise<CatalogInspection> }).inspectCatalog = async () => ({
      tables: [...ENTITY_ORDER, 'unexpected_table'],
      columns: [
        // A provider-internal column the bundle never carries.
        { table: 'profiles', column: 'password_hash', udtName: 'text', nullable: true },
        // A genuinely unmapped column.
        { table: 'projects', column: 'legacy_note', udtName: 'text', nullable: true },
      ],
      hasAuthSchema: false,
      hasNativeMigrationLedger: true,
      hasSupabaseMigrationLedger: false,
    })
    const directory = bundleDir('diagnostics')
    const result = await exportBundle(session as never, {
      directory,
      runId: 'run-export-4',
      bundleId: 'bundle-export-4',
      applicationVersion: '1.0.3',
    })
    expect(result.diagnostics.unmappedTables).toContain('unexpected_table')
    expect(result.diagnostics.unmappedColumns).toContain('projects.legacy_note')
    expect(result.diagnostics.missingColumns).toContain('projects.name')
    expect(result.diagnostics.zeroRowEntities).toContain('timesheets')
  })

  it('refuses to overwrite an existing directory and rejects an invalid batch size', async () => {
    const session = fakeSession()
    const directory = bundleDir('existing')
    const request = {
      directory,
      runId: 'run-export-5',
      bundleId: 'bundle-export-5',
      applicationVersion: '1.0.3',
    }
    await exportBundle(session as never, request)
    let overwriteCode: string | null = null
    try {
      await exportBundle(session as never, request)
    } catch (error) {
      overwriteCode = (error as { code?: string }).code ?? null
    }
    expect(overwriteCode).toBe('E_BUNDLE_EXISTS')
    let batchCode: string | null = null
    try {
      await exportBundle(session as never, { ...request, directory: bundleDir('bad-batch'), batchSize: 0 })
    } catch (error) {
      batchCode = (error as { code?: string }).code ?? null
    }
    expect(batchCode).toBe('E_BATCH_SIZE')
  })

  it('keeps the batch reader canonical and value-exact', async () => {
    const session = fakeSession({
      rows: {
        projects: [
          {
            id: '00000000-0000-4000-8000-000000000001',
            name: 'Ünicode 😀 "quoted"\nnewline',
            so_number: '',
            telegram_no: null,
            created_at: '2026-09-01T08:00:00.123456Z',
          },
        ],
      },
    })
    const rows = await readEntityBatch(session as never, 'projects', null, 10)
    expect(rows).toHaveLength(1)
    expect(rows[0].so_number).toBe('')
    expect(rows[0].telegram_no).toBeNull()
    expect(canonicalStringify(rows[0])).toContain('Ünicode 😀')
    expect(() => canonicalizeRow('projects', { ...rows[0], so_number: undefined })).toThrow(MigrationFormatError)
  })
})
