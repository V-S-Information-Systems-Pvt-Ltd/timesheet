// tests/migration-c05-recovery.test.ts
// C05 tasks 5 and 7: the merge oracle is the approved expected result, a
// completed run is a no-op that cannot overwrite later legitimate edits, and a
// reused run id or a swapped bundle cannot ride on an old review.

import { describe, expect, it, vi } from 'vitest'
import { ENTITY_ORDER, entitySpec, type CanonicalRow, type MigrationEntity } from '@/lib/migration/format'
import { applyResolvedPlan } from '@/lib/migration/import'
import { buildPreview } from '@/lib/migration/merge-plan'
import { RESOLUTIONS_FORMAT, RESOLUTIONS_FORMAT_VERSION, resolvePlan, verifyResolvedPlan } from '@/lib/migration/resolutions'
import { KIND_ACCEPTED_UDTS, computeSchemaFingerprint, REQUIRED_MIGRATIONS, type CatalogInspection } from '@/lib/migration/schema'
import type { WriteSession } from '@/lib/migration/providers/session'
import { makeManifest, profileRow } from './helpers/migration-fixtures'

const NOW = '2026-09-19T10:00:00.000000Z'
const RUN_ID = 'c05-run-0001'
const SOURCE_PROFILE = '11111111-1111-4111-8111-111111111111'
const DESTINATION_MAPPING = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const FENCED_GATE_ROW = {
  state: 'fenced',
  run_id: RUN_ID,
  reason: 'migration test',
  updated_at: NOW,
  updated_by: 'operator@example.com',
}

/** Entity matrix catalogue, shared by the helpers. */
function buildCatalog(): CatalogInspection {
  return {
    tables: [...ENTITY_ORDER],
    columns: ENTITY_ORDER.flatMap((entity) =>
      entitySpec(entity).columns.map((column) => ({
        table: entity,
        column: column.name,
        udtName:
          (entity === 'titles' || entity === 'whitelisted_domains') && column.name === 'id'
            ? 'text'
            : KIND_ACCEPTED_UDTS[column.kind][0],
        nullable: column.nullable,
      }))
    ),
    hasAuthSchema: false,
    hasNativeMigrationLedger: true,
    hasSupabaseMigrationLedger: false,
  }
}

function fixtures() {
  const rows = {} as Record<MigrationEntity, CanonicalRow[]>
  for (const entity of ENTITY_ORDER) rows[entity] = []
  const catalog: CatalogInspection = {
    tables: [...ENTITY_ORDER],
    columns: ENTITY_ORDER.flatMap((entity) =>
      entitySpec(entity).columns.map((column) => ({
        table: entity,
        column: column.name,
        udtName:
          (entity === 'titles' || entity === 'whitelisted_domains') && column.name === 'id'
            ? 'text'
            : KIND_ACCEPTED_UDTS[column.kind][0],
        nullable: column.nullable,
      }))
    ),
    hasAuthSchema: false,
    hasNativeMigrationLedger: true,
    hasSupabaseMigrationLedger: false,
  }
  const plan = buildPreview(
    {
      manifest: makeManifest(),
      provenance: [],
      sourceRows: rows,
      target: { provider: 'native', namespace: 'native:target', runtimeFingerprint: 'runtime', rows, identities: [], receipts: [] },
      targetApplicationVersion: '1.0.3',
      targetSchemaFingerprint: computeSchemaFingerprint(buildCatalog(), 'native'),
    },
    { runId: 'planning-run', createdAt: NOW }
  )
  const outcome = resolvePlan(plan, {
    format: RESOLUTIONS_FORMAT,
    formatVersion: RESOLUTIONS_FORMAT_VERSION,
    planDigest: plan.planDigest,
    operator: { name: 'Operator', at: NOW },
    decisions: [],
  })
  if (!outcome.resolvedPlan) throw new Error('the empty plan must resolve')
  return { catalog, resolved: outcome.resolvedPlan }
}

/** A resolved plan that contains one reviewed mapping, for the ownership cases. */
function mappedFixture() {
  const rows = {} as Record<MigrationEntity, CanonicalRow[]>
  for (const entity of ENTITY_ORDER) rows[entity] = []
  rows.profiles = [{ ...profileRow({ id: SOURCE_PROFILE }) } as unknown as CanonicalRow]
  const targetRows = {} as Record<MigrationEntity, CanonicalRow[]>
  for (const entity of ENTITY_ORDER) targetRows[entity] = []
  targetRows.profiles = [{ ...profileRow({ id: DESTINATION_MAPPING }) } as unknown as CanonicalRow]
  const plan = buildPreview(
    {
      manifest: makeManifest(),
      provenance: [],
      sourceRows: rows,
      target: {
        provider: 'native',
        namespace: 'native:target',
        runtimeFingerprint: 'runtime',
        rows: targetRows,
        identities: [],
        receipts: [],
      },
      targetApplicationVersion: '1.0.3',
      targetSchemaFingerprint: computeSchemaFingerprint(buildCatalog(), 'native'),
    },
    { runId: 'planning-run', createdAt: NOW }
  )
  const outcome = resolvePlan(plan, {
    format: RESOLUTIONS_FORMAT,
    formatVersion: RESOLUTIONS_FORMAT_VERSION,
    planDigest: plan.planDigest,
    operator: { name: 'Operator', at: NOW },
    decisions: [
      {
        entity: 'profiles',
        sourceId: SOURCE_PROFILE,
        action: 'map',
        destinationId: DESTINATION_MAPPING,
        reason: 'same person',
      },
    ] as never,
  })
  if (!outcome.resolvedPlan) throw new Error(`mapped fixture must resolve: ${outcome.issues.map((i) => i.message).join(' | ')}`)
  return outcome.resolvedPlan
}

/**
 * Drive apply's durable-receipt recovery path: the transaction commits for real
 * in production, so the fake one throws after the receipt would have been
 * written, and the map row is owned by whichever run the case names.
 */
async function recoverWithMappings(options: { mappingRunId: string; destinationId: string }) {
  const resolved = mappedFixture()
  const mappingQueries: Array<{ sql: string; params: unknown[] | undefined }> = []
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    if (sql.includes('migration_write_gate')) return [FENCED_GATE_ROW]
    if (sql.includes('from public.migration_runs where run_id')) {
      return [
        {
          run_id: RUN_ID,
          bundle_digest: resolved.plan.bundleDigest,
          plan_digest: resolved.plan.planDigest,
          resolution_digest: resolved.resolutionDigest,
          expected_result_digest: resolved.expectedResultDigest,
          source_namespace: resolved.plan.sourceInstance.namespace,
          target_namespace: resolved.plan.target.namespace,
          state: 'data-committed',
          counts: {},
        },
      ]
    }
    if (sql.includes('from public.migration_record_map')) {
      if (/select\s+entity,\s*source_id,\s*destination_id\s+from\s+public\.migration_record_map/i.test(sql)) {
        mappingQueries.push({ sql, params })
      }
      return [
        {
          entity: 'profiles',
          source_id: SOURCE_PROFILE,
          destination_id: options.destinationId,
          run_id: options.mappingRunId,
        },
      ]
    }
    return []
  })
  const session = {
    provider: 'native',
    displayTarget: 'test',
    identity: async () => ({ provider: 'native', namespace: 'native:target', runtimeFingerprint: 'runtime' }),
    inspectCatalog: async () => buildCatalog(),
    migrationLedger: async () => [...REQUIRED_MIGRATIONS.native],
    query,
    transaction: async () => {
      throw new Error('response lost after the commit')
    },
  } as unknown as WriteSession
  const outcome = await applyResolvedPlan({ runId: RUN_ID, resolvedPlan: resolved, session, auth: null })
  return { outcome, mappingQueries, sourceNamespace: resolved.plan.sourceInstance.namespace }
}

/** Session that answers the receipt query and refuses to mutate anything. */
function receiptSession(
  value: ReturnType<typeof fixtures>,
  receipt: { state: string; planDigest?: string; bundleDigest?: string } | null
) {
  const { resolved } = value
  let transactions = 0
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('from public.migration_runs where run_id')) {
      if (!receipt) return []
      return [
        {
          run_id: RUN_ID,
          bundle_digest: receipt.bundleDigest ?? resolved.plan.bundleDigest,
          plan_digest: receipt.planDigest ?? resolved.plan.planDigest,
          resolution_digest: resolved.resolutionDigest,
          expected_result_digest: resolved.expectedResultDigest,
          source_namespace: resolved.plan.sourceInstance.namespace,
          target_namespace: resolved.plan.target.namespace,
          state: receipt.state,
          counts: {},
        },
      ]
    }
    return []
  })
  const session = {
    provider: 'native',
    displayTarget: 'test',
    identity: async () => ({ provider: 'native', namespace: 'native:target', runtimeFingerprint: 'runtime' }),
    inspectCatalog: async () => buildCatalog(),
    migrationLedger: async () => [...REQUIRED_MIGRATIONS.native],
    query,
    transaction: async () => {
      transactions += 1
      throw new Error('a no-op or a rejected run must never open a transaction')
    },
  } as unknown as WriteSession
  return { session, get transactions() { return transactions } }
}

describe('C05 recovery gates', () => {
  it('rejects a different bundle riding on an old review', () => {
    const { resolved } = fixtures()
    // Swapping the reviewed bundle digest invalidates the plan digest that binds it.
    const swapped = { ...resolved, plan: { ...resolved.plan, bundleDigest: 'f'.repeat(64) } }
    expect(verifyResolvedPlan(swapped).map((issue) => issue.code)).toContain('E_PLAN_TAMPERED')
  })

  it('rejects a forged decision instead of applying it', () => {
    const { resolved } = fixtures()
    const forged = {
      ...resolved,
      decisions: {
        records: [{ entity: 'profiles', sourceId: '11111111-1111-4111-8111-111111111111', action: 'destroy' }],
        security: [],
        settings: null,
      },
    }
    expect(verifyResolvedPlan(forged).map((issue) => issue.code)).toContain('E_DECISIONS_SCHEMA')
  })

  it('treats a repeat of the completed run as a no-op without touching the destination', async () => {
    const value = fixtures()
    const session = receiptSession(value, { state: 'verified' })
    const result = await applyResolvedPlan({
      runId: RUN_ID,
      resolvedPlan: value.resolved,
      session: session.session,
      auth: null,
    })
    expect(result.status).toBe('no-op')
    expect(result.issues).toEqual([])
    // Later legitimate edits are never reconciled against, so they cannot be
    // reported as corruption and cannot be overwritten by a repeat run.
    expect(session.transactions).toBe(0)
  })

  it('rejects a reused run id whose durable receipt has different digests', async () => {
    const value = fixtures()
    const session = receiptSession(value, { state: 'data-committed', planDigest: 'a'.repeat(64) })
    const result = await applyResolvedPlan({
      runId: RUN_ID,
      resolvedPlan: value.resolved,
      session: session.session,
      auth: null,
    })
    expect(result.status).toBe('failed')
    expect(result.issues.map((issue) => issue.code)).toContain('E_RUN_ID_REUSED')
    expect(session.transactions).toBe(0)
  })

  it('refuses to apply while the destination gate is open, and locks before writing', async () => {
    const value = fixtures()
    const statements: string[] = []
    const session = {
      provider: 'native',
      displayTarget: 'test',
      identity: async () => ({ provider: 'native', namespace: 'native:target', runtimeFingerprint: 'runtime' }),
      inspectCatalog: async () => value.catalog,
      migrationLedger: async () => [...REQUIRED_MIGRATIONS.native],
      query: async (sql: string) => {
        // The apply precheck now refuses the open row before it starts a
        // transaction; the lock remains the race-closing second check only.
        if (sql.includes('migration_write_gate')) {
          return [{ ...FENCED_GATE_ROW, state: 'open', run_id: null, reason: 'probe' }]
        }
        return []
      },
      transaction: async (fn: (tx: { query: (sql: string) => Promise<unknown[]> }) => Promise<unknown>) => {
        await fn({
          query: async (sql: string) => {
            statements.push(sql)
            // The destination was never fenced: the operator skipped the window.
            if (sql.includes('migration_write_gate')) {
              return [
                {
                  state: 'open',
                  run_id: null,
                  reason: 'probe',
                  updated_at: '2026-09-19T10:00:00.000000Z',
                  updated_by: 'operator@example.com',
                },
              ]
            }
            return []
          },
        })
      },
    } as unknown as WriteSession

    const result = await applyResolvedPlan({
      runId: RUN_ID,
      resolvedPlan: value.resolved,
      session,
      auth: null,
    })
    expect(result.status).toBe('failed')
    expect(result.issues.map((issue) => issue.message).join(' ')).toContain(
      'cannot apply while destination writers are admitted'
    )
    // The unsafe destination is refused before any transaction or write.
    expect(statements).toEqual([])
  })

  it('refuses a destination with no gate table before any transaction or provisioning', async () => {
    const value = fixtures()
    const transactionCalls: string[] = []
    const session = {
      provider: 'native',
      displayTarget: 'test',
      identity: async () => ({ provider: 'native', namespace: 'native:target', runtimeFingerprint: 'runtime' }),
      inspectCatalog: async () => value.catalog,
      migrationLedger: async () => [...REQUIRED_MIGRATIONS.native],
      query: async (sql: string) => {
        // An older deployment has no gate table: the pre-transaction check
        // must refuse it as an unfenced target (the plan's import model).
        if (sql.includes('migration_write_gate')) {
          throw Object.assign(new Error('relation "public.migration_write_gate" does not exist'), {
            code: '42P01',
          })
        }
        return []
      },
      transaction: async () => {
        transactionCalls.push('transaction opened')
        throw new Error('a refused run must never open the apply transaction')
      },
    } as unknown as WriteSession

    const result = await applyResolvedPlan({
      runId: RUN_ID,
      resolvedPlan: value.resolved,
      session,
      auth: null,
    })

    expect(result.status).toBe('failed')
    expect(result.issues.map((issue) => issue.code)).toContain('E_GATE_MISSING')
    // The refusal happened before the apply transaction: nothing was written,
    // and the savepoint recovery keeps the (never-opened) transaction clean of
    // a 25P02 aborted-transaction failure.
    expect(transactionCalls).toEqual([])
    expect(result.issues.map((issue) => issue.message).join(' ')).not.toContain('25P02')
    expect(result.issues.map((issue) => issue.message).join(' ')).not.toContain('current transaction is aborted')
  })

  it('refuses a destination with a missing gate row before any transaction or provisioning', async () => {
    const value = fixtures()
    let transactionCalls = 0
    const session = {
      provider: 'native',
      displayTarget: 'test',
      identity: async () => ({ provider: 'native', namespace: 'native:target', runtimeFingerprint: 'runtime' }),
      inspectCatalog: async () => value.catalog,
      migrationLedger: async () => [...REQUIRED_MIGRATIONS.native],
      query: async () => [],
      transaction: async () => {
        transactionCalls += 1
        throw new Error('a refused apply must never open the apply transaction')
      },
    } as unknown as WriteSession

    const result = await applyResolvedPlan({ runId: RUN_ID, resolvedPlan: value.resolved, session, auth: null })
    expect(result.status).toBe('failed')
    expect(result.issues.map((issue) => issue.code)).toContain('E_GATE_MISSING')
    expect(transactionCalls).toBe(0)
  })

  it('does not treat an unfinished receipt as a completed run', async () => {
    const value = fixtures()
    const session = receiptSession(value, { state: 'auth-provisioned' })
    const result = await applyResolvedPlan({
      runId: RUN_ID,
      resolvedPlan: value.resolved,
      session: session.session,
      auth: null,
    })
    expect(result.status).toBe('failed')
    expect(result.issues.map((issue) => issue.code)).toContain('E_RECEIPT_STATE')
    expect(session.transactions).toBe(0)
  })

  it('accepts a mapping owned by a later run when the reviewed destination id is unchanged', async () => {
    const { outcome, mappingQueries, sourceNamespace } = await recoverWithMappings({
      mappingRunId: 'a-later-run',
      destinationId: DESTINATION_MAPPING,
    })
    // The property under test is mapping ownership: a row relabelled to a later
    // run still satisfies this run's verification. (Other post-commit surfaces
    // are empty in this fixture, so the run may still report their issues.)
    const codes = outcome.issues.map((issue) => issue.code)
    expect(codes).not.toContain('E_MAPPING_MISSING')
    expect(codes).not.toContain('E_MAPPING_MISMATCH')
    expect(mappingQueries).toHaveLength(1)
    expect(mappingQueries[0]?.sql).toMatch(/where\s+source_namespace\s*=\s*\$1/i)
    expect(mappingQueries[0]?.sql).not.toMatch(/where[\s\S]*run_id\s*=/i)
    expect(mappingQueries[0]?.params).toEqual([sourceNamespace])
  })

  it('rejects a mapping whose destination id no longer matches the reviewed one', async () => {
    const { outcome } = await recoverWithMappings({
      mappingRunId: 'a-later-run',
      destinationId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    })
    expect(outcome.status).toBe('failed')
    expect(outcome.issues.map((issue) => issue.code)).toContain('E_MAPPING_MISMATCH')
  })
})
