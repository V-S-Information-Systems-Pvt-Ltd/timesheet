// tests/migration-c05-recovery.test.ts
// C05 tasks 5 and 7: the merge oracle is the approved expected result, a
// completed run is a no-op that cannot overwrite later legitimate edits, and a
// reused run id or a swapped bundle cannot ride on an old review.

import { describe, expect, it, vi } from 'vitest'
import { ENTITY_ORDER, entitySpec, type CanonicalRow, type MigrationEntity } from '@/lib/migration/format'
import { applyResolvedPlan } from '@/lib/migration/import'
import { buildPreview } from '@/lib/migration/merge-plan'
import { RESOLUTIONS_FORMAT, RESOLUTIONS_FORMAT_VERSION, resolvePlan, verifyResolvedPlan } from '@/lib/migration/resolutions'
import { KIND_ACCEPTED_UDTS, computeSchemaFingerprint, type CatalogInspection } from '@/lib/migration/schema'
import type { WriteSession } from '@/lib/migration/providers/session'
import { makeManifest, profileRow } from './helpers/migration-fixtures'

const NOW = '2026-09-19T10:00:00.000000Z'
const RUN_ID = 'c05-run-0001'
const SOURCE_PROFILE = '11111111-1111-4111-8111-111111111111'
const DESTINATION_MAPPING = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

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
  const query = vi.fn(async (sql: string) => {
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
    query,
    transaction: async () => {
      throw new Error('response lost after the commit')
    },
  } as unknown as WriteSession
  return applyResolvedPlan({ runId: RUN_ID, resolvedPlan: resolved, session, auth: null })
}

/** Session that answers the receipt query and refuses to mutate anything. */
function receiptSession(
  value: ReturnType<typeof fixtures>,
  receipt: { state: string; planDigest?: string; bundleDigest?: string } | null
) {
  const { resolved, catalog } = value
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
      query: async () => [],
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
    // The gate lock is the first data statement in the transaction (after its
    // savepoint), so the check and every subsequent write are serialized
    // against other applies and operator transitions.
    expect(statements[0]).toBe('savepoint vsis_write_gate_probe')
    expect(statements[1]).toContain('from public.migration_write_gate where id for update')
  })

  it('proceeds when the destination has no gate table, without poisoning the transaction', async () => {
    const value = fixtures()
    const statements: string[] = []
    const session = {
      provider: 'native',
      displayTarget: 'test',
      identity: async () => ({ provider: 'native', namespace: 'native:target', runtimeFingerprint: 'runtime' }),
      inspectCatalog: async () => value.catalog,
      query: async () => [],
      transaction: async (fn: (tx: { query: (sql: string) => Promise<unknown[]> }) => Promise<unknown>) => {
        await fn({
          query: async (sql: string) => {
            statements.push(sql)
            // An older deployment has no gate table: the probe must recover to
            // its savepoint instead of aborting the apply transaction (25P02).
            if (sql.includes('migration_write_gate')) {
              throw Object.assign(new Error('relation "public.migration_write_gate" does not exist'), {
                code: '42P01',
              })
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

    expect(statements).toContain('rollback to savepoint vsis_write_gate_probe')
    // The apply continued past the probe; whatever it decided afterwards is not
    // a 25P02 aborted-transaction failure.
    expect(result.issues.map((issue) => issue.message).join(' ')).not.toContain('25P02')
    expect(result.issues.map((issue) => issue.message).join(' ')).not.toContain('current transaction is aborted')
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
    const outcome = await recoverWithMappings({ mappingRunId: 'a-later-run', destinationId: DESTINATION_MAPPING })
    // The property under test is mapping ownership: a row relabelled to a later
    // run still satisfies this run's verification. (Other post-commit surfaces
    // are empty in this fixture, so the run may still report their issues.)
    const codes = outcome.issues.map((issue) => issue.code)
    expect(codes).not.toContain('E_MAPPING_MISSING')
    expect(codes).not.toContain('E_MAPPING_MISMATCH')
  })

  it('rejects a mapping whose destination id no longer matches the reviewed one', async () => {
    const outcome = await recoverWithMappings({
      mappingRunId: 'a-later-run',
      destinationId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    })
    expect(outcome.status).toBe('failed')
    expect(outcome.issues.map((issue) => issue.code)).toContain('E_MAPPING_MISMATCH')
  })
})
