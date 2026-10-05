import { describe, expect, it, vi } from 'vitest'
import { ENTITY_ORDER, canonicalizeRow, entitySpec, type CanonicalRow, type MigrationEntity } from '@vsis/migration-tool/format'
import { applyResolvedPlan } from '@vsis/migration-tool/import'
import type { DeploymentSnapshot } from '@vsis/migration-tool/providers/read'
import type { WriteSession } from '@vsis/migration-tool/providers/session'
import { KIND_ACCEPTED_UDTS, REQUIRED_MIGRATIONS, type CatalogInspection } from '@vsis/migration-tool/schema'
import { domainRow, titleRow } from './helpers/migration-fixtures'
import { REFERENCE_NOW, REFERENCE_RUN, emptyRows, referenceCase, referenceId, resolveReference } from './helpers/reference-merge'

// This double executes generated row writes and enforces uniqueness after each
// statement, rather than pretending the expected rows were written at commit.
function destination(rows: Record<MigrationEntity, CanonicalRow[]>, failReceipt = false) {
  let data: Record<string, CanonicalRow[]> = {
    ...structuredClone(rows), migration_runs: [], migration_record_map: [], migration_record_dispositions: [],
  }
  let transactions = 0
  const catalog: CatalogInspection = {
    tables: [...ENTITY_ORDER], hasAuthSchema: false, hasNativeMigrationLedger: true, hasSupabaseMigrationLedger: false,
    columns: ENTITY_ORDER.flatMap((entity) => entitySpec(entity).columns.map((column) => ({
      table: entity, column: column.name, udtName: KIND_ACCEPTED_UDTS[column.kind][0], nullable: column.nullable,
    }))),
  }
  const identity = { provider: 'native' as const, namespace: 'native:test', runtimeFingerprint: 'reference-test' }
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes('migration_write_gate')) return [{ state: 'fenced', run_id: REFERENCE_RUN, fence_generation: referenceId(99), updated_by: 'test', updated_at: REFERENCE_NOW }]
    if (sql.includes('from public.migration_record_map m')) return []
    const select = /from public\.(\w+)/.exec(sql)
    if (/^select/i.test(sql) && select) return structuredClone(data[select[1]] ?? [])
    const insert = /^insert into public\.(\w+)\s*\(([^)]+)\)/i.exec(sql)
    if (insert) {
      const table = insert[1]
      if (table === 'migration_runs') {
        if (failReceipt) throw new Error('injected receipt failure')
        const keys = ['run_id', 'bundle_id', 'bundle_digest', 'plan_digest', 'resolution_digest', 'expected_result_digest', 'source_namespace', 'target_namespace', 'application_version', 'schema_fingerprint', 'counts', 'committed_at']
        data[table].push({ ...Object.fromEntries(keys.map((key, i) => [key, params[i]])), state: 'data-committed' } as CanonicalRow)
      } else {
        const columns = insert[2].split(',').map((key) => key.trim().replaceAll('"', ''))
        data[table] ??= []
        for (let i = 0; i < params.length; i += columns.length) {
          data[table].push(Object.fromEntries(columns.map((key, j) => [key, params[i + j]])) as CanonicalRow)
        }
      }
    }
    const update = /^update public\.(\w+) set (.+) where (.+)$/is.exec(sql)
    if (update) {
      const table = update[1]
      if (table === 'migration_runs') data[table][0].state = 'verified'
      else {
        const row = data[table].find((item) => item.id === params.at(-1))
        if (!row) throw new Error('update target missing')
        if (update[2] === '"telegram_no" = null') row.telegram_no = null
        else {
          for (const assignment of update[2].matchAll(/"(\w+)" = \$(\d+)/g)) {
            row[assignment[1]] = params[Number(assignment[2]) - 1] as CanonicalRow[string]
          }
        }
      }
    }
    for (const entity of ['projects', 'activity_types']) {
      const occupied = data[entity].map((row) => row.telegram_no).filter((value) => value != null)
      if (occupied.length !== new Set(occupied).size) throw new Error(`${entity}_telegram_no_key`)
    }
    return []
  })
  const session = {
    provider: 'native', displayTarget: 'synthetic test', identity: async () => identity,
    inspectCatalog: async () => catalog, migrationLedger: async () => [...REQUIRED_MIGRATIONS.native], query,
    transaction: async (fn: (tx: { query: typeof query }) => Promise<unknown>) => {
      transactions += 1
      const before = structuredClone(data)
      try { return await fn({ query }) } catch (error) { data = before; throw error }
    }, close: async () => {},
  } as unknown as WriteSession
  const target: DeploymentSnapshot = { ...identity, rows: structuredClone(rows), identities: [], receipts: [] }
  return { session, catalog, target, query, get data() { return data }, get transactions() { return transactions } }
}

describe('reviewed reference writes', () => {
  it.each(['projects', 'activity_types'] as const)('reuses changed %s slots while leaving mapped and retained rows untouched', async (entity) => {
    const scenario = referenceCase(entity, 'reuse')
    const rows = emptyRows()
    rows[entity] = scenario.baseline
    const db = destination(rows)
    const source = emptyRows()
    source[entity] = scenario.source
    const outcome = resolveReference(db.target, db.catalog, source, scenario.decisions)
    expect(outcome.issues).toEqual([])
    const resolved = outcome.resolvedPlan!
    expect(resolved.entries.find((entry) => entry.sourceId === referenceId(11))?.action).toBe('map')
    const result = await applyResolvedPlan({ runId: REFERENCE_RUN, resolvedPlan: resolved, session: db.session, auth: null })
    expect(result.issues).toEqual([])
    expect(result.status).toBe('committed')
    expect(db.data[entity]).toEqual(resolved.expectedResult[entity])
    const writes = db.query.mock.calls.filter(([sql]) => sql.startsWith(`update public.${entity}`))
    expect(writes).toHaveLength(2)
    expect(writes.every(([, params]) => params?.at(-1) === referenceId(1))).toBe(true)
    expect(db.query.mock.calls.findIndex(([sql]) => sql.includes('set "telegram_no" = null')))
      .toBeLessThan(db.query.mock.calls.findIndex(([sql]) => sql.startsWith(`insert into public.${entity}`)))
  })

  it.each(['projects', 'activity_types'] as const)('swaps %s slots under immediate uniqueness', async (entity) => {
    const scenario = referenceCase(entity, 'swap')
    const rows = emptyRows()
    rows[entity] = scenario.baseline
    const db = destination(rows)
    const source = emptyRows()
    source[entity] = scenario.source
    const outcome = resolveReference(db.target, db.catalog, source, scenario.decisions)
    expect(outcome.issues).toEqual([])
    const resolved = outcome.resolvedPlan!
    const result = await applyResolvedPlan({ runId: REFERENCE_RUN, resolvedPlan: resolved, session: db.session, auth: null })
    expect(result.issues).toEqual([])
    expect(result.status).toBe('committed')
    expect(db.data[entity]).toEqual(resolved.expectedResult[entity])
    expect(db.query.mock.calls.filter(([sql]) => sql.includes('set "telegram_no" = null'))).toHaveLength(2)
  })

  it.each(['projects', 'activity_types'] as const)('rolls back %s releases, writes and metadata on a later failure', async (entity) => {
    const scenario = referenceCase(entity, 'reuse')
    const rows = emptyRows()
    rows[entity] = scenario.baseline
    const db = destination(rows, true)
    const before = structuredClone(db.data)
    const source = emptyRows()
    source[entity] = scenario.source
    const resolved = resolveReference(db.target, db.catalog, source, scenario.decisions).resolvedPlan!
    const result = await applyResolvedPlan({ runId: REFERENCE_RUN, resolvedPlan: resolved, session: db.session, auth: null })
    expect(result.status).toBe('failed')
    expect(result.issues).toEqual([expect.objectContaining({ code: 'E_APPLY_FAILED', message: 'injected receipt failure' })])
    expect(db.query.mock.calls.some(([sql]) => sql.includes('set "telegram_no" = null'))).toBe(true)
    expect(db.data).toEqual(before)
  })

  it.each(['projects', 'activity_types'] as const)('rejects duplicate final %s slots before any transaction', async (entity) => {
    const scenario = referenceCase(entity, 'duplicate')
    const rows = emptyRows()
    rows[entity] = scenario.baseline
    const db = destination(rows)
    const source = emptyRows()
    source[entity] = scenario.source
    const outcome = resolveReference(db.target, db.catalog, source, scenario.decisions)
    expect(outcome.resolvedPlan).toBeNull()
    expect(outcome.issues.some((issue) => issue.code === 'E_UNIQUE_VIOLATION' && issue.message.includes('telegram_no'))).toBe(true)
    expect(db.transactions).toBe(0)
    expect(db.query).not.toHaveBeenCalled()
  })

  it('applies mapped security selections without rewriting unchanged security rows', async () => {
    const rows = emptyRows()
    rows.titles = [canonicalizeRow('titles', titleRow({ hierarchy_role: 'user' })), canonicalizeRow('titles', titleRow({ id: referenceId(5), name: 'Retained', hierarchy_role: 'user' }))]
    rows.whitelisted_domains = [canonicalizeRow('whitelisted_domains', domainRow())]
    const db = destination(rows)
    const source = structuredClone(rows)
    source.titles = [source.titles[0]]
    const decisions = ['titles', 'whitelisted_domains'].map((entity) => ({
      entity: entity as MigrationEntity, sourceId: String(source[entity as MigrationEntity][0].id), action: 'map' as const,
      destinationId: String(rows[entity as MigrationEntity][0].id),
    }))
    const outcome = resolveReference(db.target, db.catalog, source, decisions, [
      { entity: 'titles', sourceId: String(source.titles[0].id), field: 'hierarchy_role', value: 'manager', reason: 'reviewed test promotion' },
      { entity: 'whitelisted_domains', sourceId: String(source.whitelisted_domains[0].id), field: 'auto_activate', value: true, reason: 'reviewed test enrollment' },
    ])
    expect(outcome.issues).toEqual([])
    const resolved = outcome.resolvedPlan!
    const result = await applyResolvedPlan({ runId: REFERENCE_RUN, resolvedPlan: resolved, session: db.session, auth: null })
    expect(result.issues).toEqual([])
    expect(db.data.titles).toEqual(resolved.expectedResult.titles)
    expect(db.data.whitelisted_domains).toEqual(resolved.expectedResult.whitelisted_domains)
    expect(db.query.mock.calls.filter(([sql]) => sql.startsWith('update public.titles'))).toHaveLength(1)
    expect(db.query.mock.calls.some(([sql]) => sql.includes('set "telegram_no" = null'))).toBe(false)
  })
})
