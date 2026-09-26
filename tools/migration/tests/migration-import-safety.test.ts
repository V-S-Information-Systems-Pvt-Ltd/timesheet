import { describe, expect, it, vi } from 'vitest'
import { ENTITY_ORDER, entitySpec, type CanonicalRow, type MigrationEntity } from '@vsis/migration-tool/format'
import { applyResolvedPlan } from '@vsis/migration-tool/import'
import { buildPreview } from '@vsis/migration-tool/merge-plan'
import { RESOLUTIONS_FORMAT, RESOLUTIONS_FORMAT_VERSION, resolvePlan } from '@vsis/migration-tool/resolutions'
import { KIND_ACCEPTED_UDTS, computeSchemaFingerprint, REQUIRED_MIGRATIONS, type CatalogInspection } from '@vsis/migration-tool/schema'
import type { WriteSession } from '@vsis/migration-tool/providers/session'
import { makeManifest, profileRow } from './helpers/migration-fixtures'
import { canonicalizeRow } from '@vsis/migration-tool/format'

const NOW = '2026-09-19T10:00:00.000000Z'
const FENCED_GATE_ROW = {
  state: 'fenced',
  run_id: 'apply-run',
  reason: 'migration test',
  updated_at: NOW,
  updated_by: 'operator@example.com',
}

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
  let receiptState = options.initialReceiptState ?? 'data-committed'
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    if (sql.includes('migration_write_gate')) return [FENCED_GATE_ROW]
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
        state: receiptReads === 1 ? options.initialReceiptState : receiptState,
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
    migrationLedger: async () => [...REQUIRED_MIGRATIONS.native],
    query,
    transaction: async (fn: (tx: { query: (sql: string) => Promise<unknown[]> }) => Promise<unknown>) => {
      transactionCalls += 1
      await fn({
        query: async (sql: string) => {
          if (sql.includes('migration_write_gate')) return [FENCED_GATE_ROW]
          if (sql.includes('from public.migration_runs where run_id')) return [{ state: receiptState }]
          if (sql.includes("set state = 'verified'")) receiptState = 'verified'
          return []
        },
      })
      if (transactionCalls === 1) throw new Error('commit response lost')
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
    // The first transaction commits the merge; the second durably records that
    // post-commit reconciliation passed.
    expect(db.transactionCalls).toBe(2)
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

describe('migration apply partial identity provisioning', () => {
  const PROFILE_A = 'a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1'
  const PROFILE_B = 'b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2'

  function supabaseCatalog(): CatalogInspection {
    return {
      tables: [...ENTITY_ORDER],
      columns: ENTITY_ORDER.flatMap((entity) =>
        entitySpec(entity).columns.map((column) => ({
          table: entity,
          column: column.name,
          udtName: KIND_ACCEPTED_UDTS[column.kind][0],
          nullable: column.nullable,
        }))
      ),
      hasAuthSchema: true,
      hasNativeMigrationLedger: false,
      hasSupabaseMigrationLedger: true,
    }
  }

  function provisioningFixture() {
    const rows = {} as Record<MigrationEntity, CanonicalRow[]>
    for (const entity of ENTITY_ORDER) rows[entity] = []
    const sourceRows = {
      ...rows,
      profiles: [
        canonicalizeRow('profiles', profileRow({ id: PROFILE_A, email: 'a@example.com' })),
        canonicalizeRow('profiles', profileRow({ id: PROFILE_B, email: 'b@example.com' })),
      ],
    }
    const catalog = supabaseCatalog()
    const plan = buildPreview(
      {
        manifest: makeManifest(),
        provenance: [],
        sourceRows,
        sourceIdentities: [PROFILE_A, PROFILE_B].map((id, index) => ({
          id,
          email: index === 0 ? 'a@example.com' : 'b@example.com',
          emailConfirmed: false,
          hasCredential: null,
          providerIdentities: ['email'],
          mfaFactors: 0,
        })),
        target: {
          provider: 'supabase' as const,
          namespace: 'supabase:target',
          runtimeFingerprint: 'runtime',
          rows,
          identities: [],
          receipts: [],
        },
        targetApplicationVersion: '1.0.3',
        targetSchemaFingerprint: computeSchemaFingerprint(catalog, 'supabase'),
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
    if (!outcome.resolvedPlan) throw new Error('Empty plan must resolve')
    return { catalog, resolved: outcome.resolvedPlan }
  }

  function provisioningSession(
    catalog: CatalogInspection,
    options: { failSecond?: boolean; driftAfterFirstSnapshot?: boolean; missingGateTable?: boolean } = {}
  ) {
    const failSecond = options.failSecond ?? true
    const journal: Array<{ run_id: string; destination_id: string; action: string }> = []
    const authUsers = new Map<string, { email: string; runId: string }>()
    const appliedSql: string[] = []
    let profileReads = 0
    const createUser = vi.fn(async (request: { id: string; email: string; runId: string }) => {
      // The second reviewed account fails after the first was journaled.
      if (failSecond && request.id === PROFILE_B) throw new Error('provider rejected the second account')
      authUsers.set(request.id, { email: request.email, runId: request.runId })
      return { id: request.id, email: request.email }
    })
    const deleteUser = vi.fn(async (id: string) => {
      authUsers.delete(id)
    })
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (options.missingGateTable && sql.includes('migration_write_gate')) {
        throw Object.assign(new Error('relation "public.migration_write_gate" does not exist'), {
          code: '42P01',
        })
      }
      if (sql.includes('migration_write_gate')) return [FENCED_GATE_ROW]
      if (sql.includes("to_regclass('auth.mfa_factors')")) return [{ present: false }]
      if (sql.includes('from auth.users where id')) {
        const user = authUsers.get(String(params?.[0]))
        return user ? [{ id: params?.[0], email: user.email, migration_run_id: user.runId }] : []
      }
      if (sql.includes('from auth.users')) return []
      if (sql.includes('from public.migration_runs where run_id')) return []
      if (sql.includes('from public.migration_identity_journal')) {
        return journal
          .filter((row) => row.run_id === params?.[0])
          .map((row) => ({ destination_id: row.destination_id, action: row.action }))
      }
      if (sql.includes('from public.migration_record_map m')) return []
      if (sql.includes('from public.profiles')) {
        profileReads += 1
        // After provisioning, an unrelated writer adds a profile row: the
        // journaled provisioning effects do not explain it, so the run must
        // stop (and remove the accounts it created).
        if (options.driftAfterFirstSnapshot && profileReads > 1) {
          return [
            canonicalizeRow(
              'profiles',
              profileRow({ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', email: 'drift@example.com' })
            ),
          ]
        }
      }
      return []
    })
    const session = {
      provider: 'supabase',
      displayTarget: 'test',
      identity: async () => ({
        provider: 'supabase',
        namespace: 'supabase:target',
        runtimeFingerprint: 'runtime',
      }),
      inspectCatalog: async () => catalog,
      migrationLedger: async () => [...REQUIRED_MIGRATIONS.supabase],
      query,
      transaction: async (fn: (tx: { query: (sql: string, params?: unknown[]) => Promise<unknown[]> }) => Promise<unknown>) =>
        fn({
          query: async (sql: string, params?: unknown[]) => {
            appliedSql.push(sql)
            if (sql.includes('migration_write_gate')) return [FENCED_GATE_ROW]
            if (sql.includes('insert into public.migration_identity_journal')) {
              journal.push({
                run_id: String(params?.[0]),
                destination_id: String(params?.[1]),
                action: String(params?.[2]),
              })
            }
            if (sql.includes('delete from public.migration_identity_journal')) {
              const index = journal.findIndex(
                (row) => row.run_id === params?.[0] && row.destination_id === params?.[1]
              )
              if (index >= 0) journal.splice(index, 1)
            }
            return []
          },
        }),
    } as unknown as WriteSession
    return { session, journal, createUser, deleteUser, appliedSql }
  }

  it('refuses a gate-less destination before provisioning any identity or writing any row', async () => {
    const data = provisioningFixture()
    const db = provisioningSession(data.catalog, { missingGateTable: true })
    const auth = {
      createUser: db.createUser,
      deleteUser: db.deleteUser,
    } as unknown as Parameters<typeof applyResolvedPlan>[0]['auth']

    const result = await applyResolvedPlan({
      runId: 'apply-run',
      resolvedPlan: data.resolved,
      session: db.session,
      auth,
    })

    expect(result.status).toBe('failed')
    expect(result.issues.map((item) => item.code)).toContain('E_GATE_MISSING')
    // The unfenced-target refusal runs before provisioning: the Auth admin
    // port is never touched and the apply transaction never opens.
    expect(db.createUser).not.toHaveBeenCalled()
    expect(db.deleteUser).not.toHaveBeenCalled()
    expect(db.appliedSql).toEqual([])
  })

  it('reports journaled outcomes and removes run-created accounts when a later account fails', async () => {
    const data = provisioningFixture()
    const db = provisioningSession(data.catalog)
    const auth = {
      createUser: db.createUser,
      deleteUser: db.deleteUser,
    } as unknown as Parameters<typeof applyResolvedPlan>[0]['auth']

    const result = await applyResolvedPlan({
      runId: 'apply-run',
      resolvedPlan: data.resolved,
      session: db.session,
      auth,
    })

    expect(result.status).toBe('failed')
    expect(result.issues.map((item) => item.code)).toContain('E_IDENTITY_PROVISION')
    // The partial outcomes are reported instead of an empty failure result.
    expect(result.identityProvisions).toEqual([
      {
        id: PROFILE_A,
        email: 'a@example.com',
        action: 'created',
        detail: 'journaled before the provisioning pass failed',
      },
    ])
    expect(result.identityDispositions?.provisioned).toEqual([PROFILE_A])
    expect(result.identityDispositions?.cleanedUp).toEqual([PROFILE_A])
    // The run-created account was removed and its journal row cleared.
    expect(db.deleteUser).toHaveBeenCalledWith(PROFILE_A)
    expect(db.journal).toEqual([])
    // The app-data transaction never ran.
    expect(db.appliedSql.some((sql) => sql.includes('into public.profiles'))).toBe(false)
  })

  it('removes run-created accounts when the destination drifts after provisioning', async () => {
    const data = provisioningFixture()
    const db = provisioningSession(data.catalog, { failSecond: false, driftAfterFirstSnapshot: true })
    const auth = {
      createUser: db.createUser,
      deleteUser: db.deleteUser,
    } as unknown as Parameters<typeof applyResolvedPlan>[0]['auth']

    const result = await applyResolvedPlan({
      runId: 'apply-run',
      resolvedPlan: data.resolved,
      session: db.session,
      auth,
    })

    expect(result.status).toBe('failed')
    expect(result.issues.map((item) => item.code)).toContain('E_DESTINATION_DRIFT')
    expect(result.identityProvisions.map((provision) => provision.id).sort()).toEqual([PROFILE_A, PROFILE_B])
    expect(result.identityDispositions?.cleanedUp).toEqual([PROFILE_A, PROFILE_B])
    expect(db.deleteUser).toHaveBeenCalledWith(PROFILE_A)
    expect(db.deleteUser).toHaveBeenCalledWith(PROFILE_B)
    expect(db.journal).toEqual([])
    expect(db.appliedSql.some((sql) => sql.includes('into public.profiles'))).toBe(false)
  })
})

describe('migration apply completed-run verification', () => {
  const PROFILE_SOURCE_ID = '10101010-1010-4101-8101-101010101010'

  function noopFixture() {
    const catalog: CatalogInspection = {
      tables: [...ENTITY_ORDER],
      columns: ENTITY_ORDER.flatMap((entity) =>
        entitySpec(entity).columns.map((column) => ({
          table: entity,
          column: column.name,
          udtName: KIND_ACCEPTED_UDTS[column.kind][0],
          nullable: column.nullable,
        }))
      ),
      hasAuthSchema: false,
      hasNativeMigrationLedger: true,
      hasSupabaseMigrationLedger: false,
    }
    const rows = {} as Record<MigrationEntity, CanonicalRow[]>
    for (const entity of ENTITY_ORDER) rows[entity] = []
    const sourceRows = {
      ...rows,
      profiles: [canonicalizeRow('profiles', profileRow({ id: PROFILE_SOURCE_ID, email: 'a@example.com' }))],
    }
    const plan = buildPreview(
      {
        manifest: makeManifest(),
        provenance: [],
        sourceRows,
        sourceIdentities: [
          {
            id: PROFILE_SOURCE_ID,
            email: 'a@example.com',
            emailConfirmed: false,
            hasCredential: true,
            providerIdentities: null,
            mfaFactors: null,
          },
        ],
        target: {
          provider: 'native' as const,
          namespace: 'native:target',
          runtimeFingerprint: 'runtime',
          rows,
          identities: [],
          receipts: [],
        },
        targetApplicationVersion: '1.0.3',
        targetSchemaFingerprint: computeSchemaFingerprint(catalog, 'native'),
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
    if (!outcome.resolvedPlan) throw new Error('Plan must resolve')
    return { catalog, resolved: outcome.resolvedPlan }
  }

  function noopSession(
    data: ReturnType<typeof noopFixture>,
    mappingRows: Array<{ entity: string; source_id: string; destination_id: string }>,
    options: {
      runtimeFingerprint?: string
      receiptState?: string
      /** Simulates a legitimate later edit to a previously imported row. */
      driftProfileEmail?: string
      /** Simulates a destination read failure; it must fail, never warn. */
      failEntityReads?: boolean
      /** Used to prove completed replay does not consult the mutation fence. */
      failIfGateRead?: boolean
      /** Gate returned if a data-committed promotion needs to mutate. */
      gateState?: 'fenced' | 'open'
    } = {}
  ) {
    const receipt = {
      run_id: 'apply-run',
      bundle_digest: data.resolved.plan.bundleDigest,
      plan_digest: data.resolved.plan.planDigest,
      resolution_digest: data.resolved.resolutionDigest,
      expected_result_digest: data.resolved.expectedResultDigest,
      source_namespace: data.resolved.plan.sourceInstance.namespace,
      target_namespace: data.resolved.plan.target.namespace,
      state: options.receiptState ?? 'verified',
      counts: {},
    }
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('migration_write_gate')) {
        if (options.failIfGateRead) throw new Error('completed receipt replay must not read the mutation gate')
        return [{ ...FENCED_GATE_ROW, state: options.gateState ?? 'fenced' }]
      }
      if (sql.includes('from public.migration_runs where run_id')) return [receipt]
      if (sql.includes('from public.migration_record_map where source_namespace')) return mappingRows
      if (sql.includes('from public.migration_record_dispositions')) {
        return data.resolved.entries
          .filter((entry) => entry.sourceId !== null)
          .map((entry) => ({
            entity: entry.entity,
            source_id: entry.sourceId,
            action: entry.action,
            destination_id: data.resolved.idMap[entry.entity]?.[entry.sourceId as string] ?? entry.destinationId,
            reason: data.resolved.exclusions.find(
              (item) => item.entity === entry.entity && item.sourceId === entry.sourceId
            )?.reason ?? null,
          }))
      }
      if (sql.includes('from public.migration_record_map m')) return []
      if (sql.includes('has_password')) return []
      const match = /from public\.([a-z_]+)/.exec(sql)
      if (match) {
        if (options.failEntityReads && (ENTITY_ORDER as string[]).includes(match[1])) {
          throw new Error('connection lost mid-verify')
        }
        const rowsFor = (data.resolved.expectedResult[match[1] as MigrationEntity] ?? []) as CanonicalRow[]
        if (match[1] === 'profiles' && options.driftProfileEmail && rowsFor.length > 0) {
          return rowsFor.map((row) => ({ ...row, email: options.driftProfileEmail }))
        }
        return rowsFor
      }
      return []
    })
    return {
      provider: 'native',
      displayTarget: 'test',
      identity: async () => ({
        provider: 'native',
        namespace: 'native:target',
        runtimeFingerprint: options.runtimeFingerprint ?? 'runtime',
      }),
      inspectCatalog: async () => data.catalog,
      migrationLedger: async () => [...REQUIRED_MIGRATIONS.native],
      query,
      transaction: async () => {
        throw new Error('a resumed completed run must not write')
      },
    } as unknown as WriteSession
  }

  const expectedMapping = [
    { entity: 'profiles', source_id: PROFILE_SOURCE_ID, destination_id: PROFILE_SOURCE_ID },
  ]

  it('treats a matching receipt as a no-op only while rows and mappings still match', async () => {
    const data = noopFixture()
    const result = await applyResolvedPlan({
      runId: 'apply-run',
      resolvedPlan: data.resolved,
      session: noopSession(data, expectedMapping),
      auth: null,
    })
    expect(result.status).toBe('no-op')
    expect(result.issues).toEqual([])
  })

  it('replays a verified receipt read-only even when the application gate is now open', async () => {
    const data = noopFixture()
    const result = await applyResolvedPlan({
      runId: 'apply-run',
      resolvedPlan: data.resolved,
      // Any gate read would throw. A verified run validates durable evidence
      // and drift only; it must not be blocked by a later writer admission.
      session: noopSession(data, expectedMapping, { gateState: 'open', failIfGateRead: true }),
      auth: null,
    })
    expect(result.status).toBe('no-op')
    expect(result.issues).toEqual([])
  })

  it('refuses an open gate before promoting a data-committed receipt', async () => {
    const data = noopFixture()
    const result = await applyResolvedPlan({
      runId: 'apply-run',
      resolvedPlan: data.resolved,
      session: noopSession(data, expectedMapping, {
        receiptState: 'data-committed',
        gateState: 'open',
      }),
      auth: null,
    })
    expect(result.status).toBe('failed')
    expect(result.issues.map((issue) => issue.code)).toContain('E_WRITERS_NOT_FENCED')
  })

  it('returns a later row edit as drift on a verified receipt, without failing or writing', async () => {
    const data = noopFixture()
    const result = await applyResolvedPlan({
      runId: 'apply-run',
      resolvedPlan: data.resolved,
      session: noopSession(data, expectedMapping, { driftProfileEmail: 'edited-later@example.com' }),
      auth: null,
    })
    expect(result.status).toBe('no-op')
    expect(result.issues).toEqual([])
    // The later edit is reported, never overwritten and never called corruption.
    expect(result.rowDriftIssues?.length).toBeGreaterThan(0)
  })

  it('still fails a data-committed receipt whose rows drifted, instead of promoting it silently', async () => {
    const data = noopFixture()
    const result = await applyResolvedPlan({
      runId: 'apply-run',
      resolvedPlan: data.resolved,
      session: noopSession(data, expectedMapping, {
        receiptState: 'data-committed',
        driftProfileEmail: 'edited-later@example.com',
      }),
      auth: null,
    })
    // Promotion to `verified` keeps the full reconciliation bar: a drifted
    // data-committed receipt is a failure, not a drifting no-op.
    expect(result.status).toBe('failed')
    expect(result.issues.length).toBeGreaterThan(0)
  })

  it('fails the no-op path when the destination cannot be read, instead of warning', async () => {
    const data = noopFixture()
    const result = await applyResolvedPlan({
      runId: 'apply-run',
      resolvedPlan: data.resolved,
      session: noopSession(data, expectedMapping, { failEntityReads: true }),
      auth: null,
    })
    expect(result.status).toBe('failed')
    expect(result.issues.map((issue) => issue.code)).toContain('E_POST_COMMIT_RECONCILE')
  })

  it('refuses a matching receipt whose durable mappings are missing', async () => {
    const data = noopFixture()
    const result = await applyResolvedPlan({
      runId: 'apply-run',
      resolvedPlan: data.resolved,
      session: noopSession(data, []),
      auth: null,
    })
    expect(result.status).toBe('failed')
    expect(result.issues.map((issue) => issue.code)).toContain('E_MAPPING_MISSING')
  })

  it('refuses a matching receipt whose durable mapping points elsewhere', async () => {
    const data = noopFixture()
    const result = await applyResolvedPlan({
      runId: 'apply-run',
      resolvedPlan: data.resolved,
      session: noopSession(data, [
        {
          entity: 'profiles',
          source_id: PROFILE_SOURCE_ID,
          destination_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        },
      ]),
      auth: null,
    })
    expect(result.status).toBe('failed')
    expect(result.issues.map((issue) => issue.code)).toContain('E_MAPPING_MISMATCH')
  })

  it('ignores mappings owned by a later run when verifying a completed run', async () => {
    const data = noopFixture()
    const result = await applyResolvedPlan({
      runId: 'apply-run',
      resolvedPlan: data.resolved,
      session: noopSession(data, [
        ...expectedMapping,
        // A later run mapped a record this resolution never contained.
        {
          entity: 'projects',
          source_id: '99999999-9999-4999-8999-999999999999',
          destination_id: '88888888-8888-4888-8888-888888888888',
        },
      ]),
      auth: null,
    })
    expect(result.status).toBe('no-op')
    expect(result.issues).toEqual([])
  })

  it('refuses a destination whose role-independent instance facts changed', async () => {
    const data = noopFixture()
    const result = await applyResolvedPlan({
      runId: 'apply-run',
      resolvedPlan: data.resolved,
      session: noopSession(data, expectedMapping, { runtimeFingerprint: 'a-different-instance' }),
      auth: null,
    })
    expect(result.status).toBe('failed')
    expect(result.issues.map((issue) => issue.code)).toContain('E_TARGET_MISMATCH')
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
// tools/migration/tests/migration-import-safety.test.ts
