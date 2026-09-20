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
  IDENTITIES_FILE,
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
  provenanceRows?: Array<{ entity: string; source_namespace: string; source_id: string; destination_id: string; recorded_at: string }>
  /** Native identity inventory rows (id, email, has_password). */
  identityRows?: Array<{ id: string; email: string | null; has_password: boolean }>
  failOnBatch?: number
  onQuery?: (text: string, params?: unknown[], inSnapshot?: boolean) => void
}

/**
 * Minimal session that answers batch queries from an in-memory table map and
 * records every statement, so the exporter's pagination can be asserted
 * exactly. Only SELECTs are accepted, mirroring the real read-only session.
 */
function fakeSession(options: FakeSessionOptions = {}) {
  const calls: Array<{ text: string; params: unknown[] }> = []
  let batch = 0
  let inSnapshot = false
  const catalog: CatalogInspection = {
    tables: [...ENTITY_ORDER, 'schema_migrations', ...(options.provenanceRows ? ['migration_record_map'] : [])],
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
      inSnapshot = true
      try { return await fn() } finally { inSnapshot = false }
    },
    async query<T extends Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]> {
      if (!/^\s*select\b/i.test(text)) throw new Error('fake session only executes SELECT statements')
      calls.push({ text, params: params ?? [] })
      options.onQuery?.(text, params, inSnapshot)
      if (text.includes('txid_current_snapshot')) return [{ snapshot: '100:100:' }] as unknown as T[]
      if (text.includes("to_regclass('public.migration_record_map')")) {
        return [{ present: options.provenanceRows !== undefined }] as unknown as T[]
      }
      if (text.includes('has_password')) {
        return (options.identityRows ?? []) as unknown as T[]
      }
      if (text.includes('migration_record_map')) {
        const ordered = [...(options.provenanceRows ?? [])].sort((a, b) =>
          `${a.source_namespace}\0${a.entity}\0${a.source_id}`.localeCompare(`${b.source_namespace}\0${b.entity}\0${b.source_id}`)
        )
        const after = params?.length === 5 ? `${params[1]}\0${params[2]}\0${params[3]}` : null
        const filtered = after
          ? ordered.filter((row) => `${row.source_namespace}\0${row.entity}\0${row.source_id}` > after)
          : ordered
        return filtered.slice(0, Number(params?.[params.length - 1] ?? EXPORT_BATCH_SIZE)) as unknown as T[]
      }
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
    const identityRows = [
      { id: '00000000-0000-4000-8000-000000000001', email: 'alice@example.com', has_password: true },
      { id: '00000000-0000-4000-8000-000000000002', email: 'bob@example.com', has_password: false },
    ]
    const session = fakeSession({ rows: { projects: [projectRow(1), projectRow(2)] }, identityRows })
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

    // The source assurance facts are captured, digest-bound and re-read.
    expect(result.identityCount).toBe(2)
    expect(result.manifest.identities?.count).toBe(2)
    expect(validation.manifest?.identities?.sha256).toBe(sha256Hex(readFileSync(join(directory, IDENTITIES_FILE), 'utf8')))
    expect(validation.sourceIdentities).toEqual([
      {
        id: identityRows[0].id,
        email: 'alice@example.com',
        emailConfirmed: null,
        hasCredential: true,
        providerIdentities: null,
        mfaFactors: null,
      },
      {
        id: identityRows[1].id,
        email: 'bob@example.com',
        emailConfirmed: null,
        hasCredential: false,
        providerIdentities: null,
        mfaFactors: null,
      },
    ])

    // An empty entity file is still written and declared.
    expect(readdirSync(directory).sort()).toEqual(
      [
        ...ENTITY_ORDER.map((entity) => `${entity}.jsonl`),
        MANIFEST_FILE,
        'provenance.json',
        IDENTITIES_FILE,
        'retry-history.json',
      ].sort()
    )
  })

  it('pages committed provenance inside the same snapshot and binds its digest', async () => {
    const provenanceRows = Array.from({ length: 5 }, (_, index) => ({
      entity: 'projects',
      source_namespace: 'native:origin',
      source_id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      destination_id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      recorded_at: '2026-09-19T00:00:00.000000Z',
    }))
    let provenanceReads = 0
    const session = fakeSession({
      provenanceRows,
      onQuery(text, _params, inSnapshot) {
        if (!text.includes('from public.migration_record_map')) return
        expect(inSnapshot).toBe(true)
        expect(text).toContain('join public.migration_runs')
        expect(text).toContain("r.state in ('data-committed'")
        provenanceReads += 1
      },
    })
    const directory = bundleDir('provenance-paged')
    const result = await exportBundle(session as never, {
      directory,
      runId: 'run-provenance',
      bundleId: 'bundle-provenance',
      applicationVersion: '1.0.3',
      batchSize: 2,
    })
    expect(provenanceReads).toBe(3)
    expect(result.aliasCount).toBe(5)
    const contents = readFileSync(join(directory, 'provenance.json'), 'utf8')
    expect(result.manifest.provenance.sha256).toBe(sha256Hex(contents))
    expect(JSON.parse(contents).aliases).toHaveLength(5)
    expect((await validateBundleDirectory(directory)).ok).toBe(true)
  })

  it('leaves no manifest when provenance paging fails', async () => {
    const session = fakeSession({
      provenanceRows: Array.from({ length: 3 }, (_, index) => ({
        entity: 'projects',
        source_namespace: 'native:origin',
        source_id: String(index),
        destination_id: String(index),
        recorded_at: '2026-09-19T00:00:00.000000Z',
      })),
      onQuery(text, params) {
        if (text.includes('from public.migration_record_map') && params?.length === 5) {
          throw new Error('simulated provenance connection loss')
        }
      },
    })
    const directory = bundleDir('provenance-interrupted')
    await expect(exportBundle(session as never, {
      directory,
      runId: 'run-provenance-failure',
      bundleId: 'bundle-provenance-failure',
      applicationVersion: '1.0.3',
      batchSize: 2,
    })).rejects.toThrow(/Export of provenance was interrupted/)
    expect(existsSync(join(directory, MANIFEST_FILE))).toBe(false)
  })

  it('fails before the manifest when a row or an entity file exceeds the bundle limits', async () => {
    const rowSession = fakeSession({ rows: { projects: [{ ...projectRow(1), name: 'x'.repeat(512) }] } })
    const rowDirectory = bundleDir('row-limit')
    await expect(
      exportBundle(rowSession as never, {
        directory: rowDirectory,
        runId: 'run-row-limit',
        bundleId: 'bundle-row-limit',
        applicationVersion: '1.0.3',
        limits: { rowBytes: 256 },
      })
    ).rejects.toMatchObject({ code: 'E_ROW_TOO_LARGE' })
    expect(existsSync(join(rowDirectory, MANIFEST_FILE))).toBe(false)

    const entitySession = fakeSession({ rows: { projects: [projectRow(1), projectRow(2), projectRow(3)] } })
    const entityDirectory = bundleDir('entity-limit')
    await expect(
      exportBundle(entitySession as never, {
        directory: entityDirectory,
        runId: 'run-entity-limit',
        bundleId: 'bundle-entity-limit',
        applicationVersion: '1.0.3',
        limits: { entityFileBytes: 300 },
      })
    ).rejects.toMatchObject({ code: 'E_ENTITY_TOO_LARGE' })
    expect(existsSync(join(entityDirectory, MANIFEST_FILE))).toBe(false)
  })

  it('fails before the manifest when provenance exceeds the bundle limit', async () => {
    const provenanceRows = Array.from({ length: 3 }, (_, index) => ({
      entity: 'projects',
      source_namespace: 'native:origin',
      source_id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      destination_id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      recorded_at: '2026-09-19T00:00:00.000000Z',
    }))
    const session = fakeSession({ provenanceRows })
    const directory = bundleDir('provenance-limit')
    await expect(
      exportBundle(session as never, {
        directory,
        runId: 'run-provenance-limit',
        bundleId: 'bundle-provenance-limit',
        applicationVersion: '1.0.3',
        limits: { provenanceBytes: 200 },
      })
    ).rejects.toMatchObject({ code: 'E_PROVENANCE_TOO_LARGE' })
    expect(existsSync(join(directory, MANIFEST_FILE))).toBe(false)
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

  it('reports existing rows that shared destination checks would reject without rewriting them', async () => {
    const longReason = '😀'.repeat(501)
    const session = fakeSession({ rows: { leaves: [{
      id: '00000000-0000-4000-8000-000000000001',
      user_id: '00000000-0000-4000-8000-000000000002',
      leave_date: '2026-09-19',
      reason: longReason,
      created_at: '2026-09-19T00:00:00.000000Z',
    }] } })
    const directory = bundleDir('incompatible-values')
    const result = await exportBundle(session as never, {
      directory,
      runId: 'run-incompatible',
      bundleId: 'bundle-incompatible',
      applicationVersion: '1.0.3',
    })
    expect(result.diagnostics.incompatibleValues).toContainEqual({
      entity: 'leaves', column: 'reason', count: 1, rule: 'char_length(reason) <= 500',
    })
    expect(readFileSync(join(directory, 'leaves.jsonl'), 'utf8')).toContain(longReason)
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
