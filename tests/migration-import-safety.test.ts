import { describe, expect, it, vi } from 'vitest'
import { ENTITY_ORDER, entitySpec, type CanonicalRow, type MigrationEntity } from '@/lib/migration/format'
import { applyResolvedPlan } from '@/lib/migration/import'
import { buildPreview } from '@/lib/migration/merge-plan'
import { RESOLUTIONS_FORMAT, RESOLUTIONS_FORMAT_VERSION, resolvePlan } from '@/lib/migration/resolutions'
import { KIND_ACCEPTED_UDTS, computeSchemaFingerprint, type CatalogInspection } from '@/lib/migration/schema'
import type { WriteSession } from '@/lib/migration/providers/session'
import { makeManifest, profileRow } from './helpers/migration-fixtures'
import { canonicalizeRow } from '@/lib/migration/format'

const NOW = '2026-09-19T10:00:00.000000Z'

function fixture() {
  const rows = {} as Record<MigrationEntity, CanonicalRow[]>
  for (const entity of ENTITY_ORDER) rows[entity] = []
  const catalog: CatalogInspection = {
    tables: [...ENTITY_ORDER],
    columns: ENTITY_ORDER.flatMap((entity) => entitySpec(entity).columns.map((column) => ({
      table: entity,
      column: column.name,
      udtName: (entity === 'titles' || entity === 'whitelisted_domains') && column.name === 'id'
        ? 'text'
        : KIND_ACCEPTED_UDTS[column.kind][0],
      nullable: column.nullable,
    }))),
    hasAuthSchema: false,
    hasNativeMigrationLedger: true,
    hasSupabaseMigrationLedger: false,
  }
  const target = {
    provider: 'native' as const,
    namespace: 'native:target',
    runtimeFingerprint: 'runtime',
    rows,
    identities: [],
    receipts: [],
  }
  const plan = buildPreview({
    manifest: makeManifest(),
    provenance: [],
    sourceRows: rows,
    target,
    targetApplicationVersion: '1.0.3',
    targetSchemaFingerprint: computeSchemaFingerprint(catalog, 'native'),
  }, { runId: 'planning-run', createdAt: NOW })
  const outcome = resolvePlan(plan, {
    format: RESOLUTIONS_FORMAT,
    formatVersion: RESOLUTIONS_FORMAT_VERSION,
    planDigest: plan.planDigest,
    operator: { name: 'Operator', at: NOW },
    decisions: [],
  })
  if (!outcome.resolvedPlan) throw new Error('Empty plan must resolve')
  return { catalog, target, resolved: outcome.resolvedPlan }
}

type ReceiptRow = {
  source_namespace: string
  target_namespace: string
  entity: MigrationEntity
  source_id: string
  destination_id: string
  run_id: string
  state: 'verified'
}

function fakeSession(
  fixtureValue: ReturnType<typeof fixture>,
  secondReceipt: 'present' | 'error',
  options: {
    receiptRows?: ReceiptRow[]
    receiptRowsAfterFirstSnapshot?: ReceiptRow[]
    initialReceiptState?: string
  } = {}
) {
  const { resolved, catalog } = fixtureValue
  let receiptReads = 0
  let snapshotReceiptReads = 0
  let transactionCalls = 0
  let cleanupQueries = 0
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    if (sql.includes('from public.migration_runs where run_id')) {
      receiptReads += 1
      if (receiptReads === 1 && !options.initialReceiptState) return []
      if (secondReceipt === 'error') throw new Error('connection lost')
      return [{
        run_id: 'apply-run',
        bundle_digest: resolved.plan.bundleDigest,
        plan_digest: resolved.plan.planDigest,
        resolution_digest: resolved.resolutionDigest,
        expected_result_digest: resolved.expectedResultDigest,
        source_namespace: resolved.plan.sourceInstance.namespace,
        target_namespace: resolved.plan.target.namespace,
        state: receiptReads === 1 ? options.initialReceiptState : 'data-committed',
        counts: {},
      }]
    }
    if (sql.includes('from public.migration_record_map m')) {
      snapshotReceiptReads += 1
      const available = snapshotReceiptReads > 1 && options.receiptRowsAfterFirstSnapshot
        ? options.receiptRowsAfterFirstSnapshot
        : options.receiptRows ?? []
      return sql.includes('m.source_namespace = $1')
        ? available.filter((row) => row.source_namespace === params?.[0])
        : available
    }
    if (sql.includes('migration_identity_journal')) cleanupQueries += 1
    return []
  })
  const session = {
    provider: 'native',
    displayTarget: 'test',
    identity: async () => ({ provider: 'native', namespace: 'native:target', runtimeFingerprint: 'runtime' }),
    inspectCatalog: async () => catalog,
    query,
    transaction: async (fn: (tx: { query: () => Promise<unknown[]> }) => Promise<unknown>) => {
      transactionCalls += 1
      await fn({ query: async () => [] })
      throw new Error('commit response lost')
    },
  } as unknown as WriteSession
  return {
    session,
    get cleanupQueries() { return cleanupQueries },
    get transactionCalls() { return transactionCalls },
  }
}

describe('migration apply commit uncertainty', () => {
  it('uses a matching durable receipt after a lost commit response and keeps identities', async () => {
    const data = fixture()
    const db = fakeSession(data, 'present')
    const result = await applyResolvedPlan({ runId: 'apply-run', resolvedPlan: data.resolved, session: db.session, auth: null })
    expect(result.status).toBe('committed')
    expect(result.receipt?.runId).toBe('apply-run')
    expect(db.cleanupQueries).toBe(0)
  })

  it('refuses identity cleanup when the durable commit outcome cannot be read', async () => {
    const data = fixture()
    const db = fakeSession(data, 'error')
    const result = await applyResolvedPlan({ runId: 'apply-run', resolvedPlan: data.resolved, session: db.session, auth: null })
    expect(result.status).toBe('failed')
    expect(result.issues.map((item) => item.code)).toContain('E_COMMIT_UNCERTAIN')
    expect(db.cleanupQueries).toBe(0)
  })

  it('ignores unrelated source receipts when checking a reviewed destination snapshot', async () => {
    const data = fixture()
    const db = fakeSession(data, 'present', { receiptRows: [{
      source_namespace: 'native:another-source',
      target_namespace: data.target.namespace,
      entity: 'projects',
      source_id: '11111111-1111-4111-8111-111111111111',
      destination_id: '22222222-2222-4222-8222-222222222222',
      run_id: 'another-run',
      state: 'verified',
    }] })

    const result = await applyResolvedPlan({ runId: 'apply-run', resolvedPlan: data.resolved, session: db.session, auth: null })
    expect(result.status).toBe('committed')
    expect(db.transactionCalls).toBe(1)
  })

  it('rejects a new same-source receipt before app-data mutation', async () => {
    const data = fixture()
    const db = fakeSession(data, 'present', { receiptRowsAfterFirstSnapshot: [{
      source_namespace: data.resolved.plan.sourceInstance.namespace,
      target_namespace: data.target.namespace,
      entity: 'projects',
      source_id: '11111111-1111-4111-8111-111111111111',
      destination_id: '22222222-2222-4222-8222-222222222222',
      run_id: 'new-run',
      state: 'verified',
    }] })

    const result = await applyResolvedPlan({ runId: 'apply-run', resolvedPlan: data.resolved, session: db.session, auth: null })
    expect(result.status).toBe('failed')
    expect(result.issues.map((item) => item.code)).toContain('E_DESTINATION_DRIFT')
    expect(db.transactionCalls).toBe(0)
  })

  it('does not treat a failed receipt with matching digests as a completed no-op', async () => {
    const data = fixture()
    const db = fakeSession(data, 'present', { initialReceiptState: 'failed' })

    const result = await applyResolvedPlan({ runId: 'apply-run', resolvedPlan: data.resolved, session: db.session, auth: null })
    expect(result.status).toBe('failed')
    expect(result.issues.map((item) => item.code)).toContain('E_RECEIPT_STATE')
    expect(db.transactionCalls).toBe(0)
  })
})

describe('migration apply pre-mutation gates', () => {
  it('refuses a plan reviewed for a different destination namespace', async () => {
    const data = fixture()
    const db = fakeSession(data, 'present')
    ;(db.session as { identity: () => Promise<{ namespace: string }> }).identity = async () => ({
      provider: 'native',
      namespace: 'native:somewhere-else',
      runtimeFingerprint: 'runtime',
    })
    const result = await applyResolvedPlan({ runId: 'apply-run', resolvedPlan: data.resolved, session: db.session, auth: null })
    expect(result.status).toBe('failed')
    expect(result.issues.map((item) => item.code)).toContain('E_TARGET_MISMATCH')
    expect(db.transactionCalls).toBe(0)
  })

  it('rejects a stale plan before any identity provisioning or transaction', async () => {
    const data = fixture()
    const db = fakeSession(data, 'present')
    // The destination gained a profile row after the plan was reviewed: the
    // baseline snapshot no longer matches, which must abort before any Auth
    // call or transaction.
    const inner = db.session.query.bind(db.session)
    ;(db.session as { query: unknown }).query = async (sql: string, params?: unknown[]) => {
      if (/from public\.profiles\b/.test(sql) && !sql.includes('password_hash')) {
        return [
          canonicalizeRow(
            'profiles',
            profileRow({ id: '99999999-9999-4999-8999-999999999999', email: 'drift@example.com' })
          ),
        ]
      }
      return inner(sql, params) as never
    }
    const createUser = vi.fn()
    const auth = { createUser, deleteUser: vi.fn() } as unknown as Parameters<typeof applyResolvedPlan>[0]['auth']
    const result = await applyResolvedPlan({ runId: 'apply-run', resolvedPlan: data.resolved, session: db.session, auth })
    expect(result.status).toBe('failed')
    expect(result.issues.map((item) => item.code)).toContain('E_STALE_PLAN')
    expect(createUser).not.toHaveBeenCalled()
    expect(db.transactionCalls).toBe(0)
  })

  it('enforces the application release bound into the reviewed plan', async () => {
    const data = fixture()
    const db = fakeSession(data, 'present')
    const mismatched = await applyResolvedPlan({
      runId: 'apply-run',
      resolvedPlan: data.resolved,
      session: db.session,
      auth: null,
      expectedApplicationVersion: '9.9.9',
    })
    expect(mismatched.status).toBe('failed')
    expect(mismatched.issues.map((item) => item.code)).toContain('E_RELEASE_MISMATCH')
    expect(db.transactionCalls).toBe(0)

    const matching = await applyResolvedPlan({
      runId: 'apply-run',
      resolvedPlan: data.resolved,
      session: db.session,
      auth: null,
      expectedApplicationVersion: '1.0.3',
    })
    expect(matching.status).toBe('committed')
  })
})
