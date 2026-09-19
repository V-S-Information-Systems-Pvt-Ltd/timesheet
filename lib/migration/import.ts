// lib/migration/import.ts
// Destination-side apply: one app-data transaction that creates/updates the
// reviewed records, rewrites every reference through the approved id map,
// records mappings and the import receipt, then reconciles the committed state
// against the exact expected result before it is allowed to commit.
//
// Identity provisioning (Supabase Auth) happens before this transaction and is
// journaled separately; only those journaled effects may differ from the
// reviewed destination baseline.
//
// A repeated run with the same digests is a no-op: it returns the stored
// receipt and never reapplies its changes.

import { ENTITY_ORDER, entitySpec, type CanonicalRow, type MigrationEntity } from './format'
import { MigrationRunError } from './journal'
import { deploymentSnapshotDigest, entityDigest, type MergeIssue, type ResolvedPlan } from './merge-plan'
import { verifyResolvedPlan } from './resolutions'
import { cleanupRunIdentities, provisionIdentities, type IdentityProvisionOutcome } from './identity'
import { computeSchemaFingerprint } from './schema'
import { readDeploymentSnapshot, type DeploymentSnapshot } from './providers/read'
import type { AuthAdminPort } from './providers/supabase'
import type { WriteSession, WriteTransaction } from './providers/session'

const MAX_INSERT_ROWS = 100

export interface ApplyRequest {
  runId: string
  resolvedPlan: ResolvedPlan
  session: WriteSession
  auth: AuthAdminPort | null
  /** Reviewed plan digest the operator recorded; must match the artifact. */
  expectPlanDigest?: string
  now?: () => Date
}

export interface ApplyCounts {
  created: number
  updated: number
  mapped: number
  excluded: number
}

export interface ReceiptRecord {
  runId: string
  bundleDigest: string
  planDigest: string
  resolutionDigest: string
  expectedResultDigest: string
  sourceNamespace: string
  targetNamespace: string
  state: string
  counts: Record<string, unknown>
}

export interface ApplyResult {
  status: 'committed' | 'no-op' | 'failed'
  issues: MergeIssue[]
  counts: ApplyCounts
  identityProvisions: IdentityProvisionOutcome[]
  receipt: ReceiptRecord | null
}

function issue(code: string, message: string, entity: MigrationEntity | null = null): MergeIssue {
  return { code, entity, sourceId: null, message }
}

export async function applyResolvedPlan(request: ApplyRequest): Promise<ApplyResult> {
  const { resolvedPlan: resolved, session } = request
  const empty: ApplyCounts = { created: 0, updated: 0, mapped: 0, excluded: 0 }
  const failures = (issues: MergeIssue[]): ApplyResult => ({
    status: 'failed',
    issues,
    counts: empty,
    identityProvisions: [],
    receipt: null,
  })

  const verification = verifyResolvedPlan(resolved)
  if (verification.length > 0) return failures(verification)

  const plan = resolved.plan
  if (request.expectPlanDigest && request.expectPlanDigest !== plan.planDigest) {
    return failures([
      issue(
        'E_PLAN_DIGEST_MISMATCH',
        `The recorded plan digest ${request.expectPlanDigest.slice(0, 12)} does not match the artifact ${plan.planDigest.slice(0, 12)}.`
      ),
    ])
  }

  const identity = await session.identity()
  if (identity.namespace !== plan.target.namespace) {
    return failures([
      issue(
        'E_TARGET_MISMATCH',
        `This plan was reviewed for destination ${plan.target.namespace} but the connection resolves to ${identity.namespace}.`
      ),
    ])
  }

  const catalog = await session.inspectCatalog()
  const schemaFingerprint = computeSchemaFingerprint(catalog, identity.provider)
  if (schemaFingerprint !== plan.target.schemaFingerprint) {
    return failures([
      issue(
        'E_SCHEMA_DRIFT',
        `Target schema fingerprint ${schemaFingerprint.slice(0, 12)} no longer matches the reviewed ${plan.target.schemaFingerprint.slice(0, 12)}.`
      ),
    ])
  }

  const existingReceipt = await readReceipt(session, request.runId)
  if (existingReceipt) {
    const sameDigests =
      existingReceipt.bundleDigest === plan.bundleDigest &&
      existingReceipt.planDigest === plan.planDigest &&
      existingReceipt.resolutionDigest === resolved.resolutionDigest &&
      existingReceipt.expectedResultDigest === resolved.expectedResultDigest
    if (sameDigests) {
      return { status: 'no-op', issues: [], counts: empty, identityProvisions: [], receipt: existingReceipt }
    }
    return failures([
      issue('E_RUN_ID_REUSED', `Run id ${request.runId} was already used for different digests; refusing to replay it.`),
    ])
  }

  const baseline = await readDeploymentSnapshot(session)
  if (deploymentSnapshotDigest(baseline) !== plan.target.snapshotDigest) {
    return failures([
      issue('E_STALE_PLAN', 'The destination changed since this plan was reviewed; regenerate and re-review the plan.'),
    ])
  }

  // --- identity provisioning (outside the app-data transaction) ---
  const plannedProfiles = plannedProfileCreates(resolved)
  let provisions: IdentityProvisionOutcome[] = []
  try {
    provisions = await provisionIdentities({
      runId: request.runId,
      provider: identity.provider,
      requests: plannedProfiles.map((row) => ({
        id: String(row.id),
        email: String(row.email),
        name: typeof row.name === 'string' ? row.name : '',
        sourceEmailConfirmed: null,
      })),
      session,
      auth: request.auth,
    })
  } catch (error) {
    return failures([issue('E_IDENTITY_PROVISION', error instanceof Error ? error.message : String(error))])
  }
  const toleratedProfileIds = new Set(provisions.filter((p) => p.action !== 'skipped').map((p) => p.id))

  const afterProvisioning = await readDeploymentSnapshot(session)
  const provisioningDrift = baselineDrift(plan.target.snapshotDigest, afterProvisioning, toleratedProfileIds, plan.snapshot.receipts)
  if (provisioningDrift) {
    return failures([issue('E_DESTINATION_DRIFT', provisioningDrift)])
  }

  const counts = countPlannedWork(resolved)
  let receipt: ReceiptRecord | null = null

  try {
    await session.transaction(async (tx) => {
      // The baseline is rechecked inside the transaction: the window between
      // preflight and here must not hide a concurrent writer.
      const inTransaction = await readDeploymentSnapshot(session)
      const inTransactionDrift = baselineDrift(
        plan.target.snapshotDigest,
        inTransaction,
        toleratedProfileIds,
        plan.snapshot.receipts
      )
      if (inTransactionDrift) {
        throw new MigrationRunError('E_DESTINATION_DRIFT', inTransactionDrift)
      }

      await applyEntries(tx, resolved, catalog, toleratedProfileIds)
      // Mappings must carry the import receipt's run id: the destination's
      // provenance reader joins map rows to their receipt, and a planning run
      // id here would silently break every later reverse/repeat migration.
      await writeMappings(tx, resolved, request.runId)
      receipt = await writeReceipt(tx, request.runId, resolved, counts, request.now?.() ?? new Date())

      const reconciled = await reconcile(session, resolved)
      if (reconciled.length > 0) {
        throw new MigrationRunError('E_RECONCILE_FAILED', reconciled.map((item) => item.message).join(' | '))
      }
    })
  } catch (error) {
    const cleanup = await cleanupRunIdentities({ runId: request.runId, session, auth: request.auth }).catch(() => ({
      deleted: [],
      errors: ['identity cleanup could not be attempted'],
    }))
    return failures([
      issue('E_APPLY_FAILED', error instanceof Error ? error.message : String(error)),
      ...cleanup.errors.map((message) => issue('E_IDENTITY_CLEANUP', message)),
    ])
  }

  return { status: 'committed', issues: [], counts, identityProvisions: provisions, receipt }
}

/* ------------------------------------------------------------------ */

function plannedProfileCreates(resolved: ResolvedPlan): CanonicalRow[] {
  const created: CanonicalRow[] = []
  for (const entry of resolved.entries) {
    if (entry.entity !== 'profiles' || entry.action !== 'create' || entry.sourceId === null) continue
    const destinationId = resolved.idMap.profiles[entry.sourceId]
    const row = resolved.expectedResult.profiles.find((candidate) => String(candidate.id) === destinationId)
    if (row) created.push(row)
  }
  return created
}

/**
 * Compare the current destination against the reviewed baseline, tolerating
 * only the profile rows and identity records this run's provisioning created.
 *
 * The reviewed receipt set is the plan's own: provenance recorded by later or
 * concurrent runs of other sources must not invalidate a reviewed plan.
 */
function baselineDrift(
  expectedDigest: string,
  current: DeploymentSnapshot,
  toleratedProfileIds: Set<string>,
  reviewedReceipts: DeploymentSnapshot['receipts']
): string | null {
  const withReviewedReceipts: DeploymentSnapshot = { ...current, receipts: reviewedReceipts ?? [] }
  if (deploymentSnapshotDigest(withReviewedReceipts) === expectedDigest) return null
  if (toleratedProfileIds.size === 0) {
    return 'The destination changed since this plan was reviewed.'
  }
  const filtered: DeploymentSnapshot = {
    ...withReviewedReceipts,
    rows: {
      ...current.rows,
      profiles: current.rows.profiles.filter((row) => !toleratedProfileIds.has(String(row.id))),
    },
    identities: current.identities.filter((record) => !toleratedProfileIds.has(record.id)),
  }
  if (deploymentSnapshotDigest(filtered) === expectedDigest) return null
  return 'The destination changed since this plan was reviewed by more than the journaled provisioning effects.'
}

function countPlannedWork(resolved: ResolvedPlan): ApplyCounts {
  const counts: ApplyCounts = { created: 0, updated: 0, mapped: 0, excluded: 0 }
  for (const entry of resolved.entries) {
    if (entry.sourceId === null) continue
    if (entry.action === 'create') counts.created += 1
    else if (entry.action === 'update') counts.updated += 1
    else if (entry.action === 'map') counts.mapped += 1
    else if (entry.action === 'exclude') counts.excluded += 1
  }
  return counts
}

function castFor(kind: string, liveUdt: string | undefined): string {
  switch (kind) {
    case 'uuid':
      return liveUdt === 'text' ? '' : '::uuid'
    case 'timestamptz':
      return '::timestamptz'
    case 'date':
      return '::date'
    case 'decimal':
      return '::numeric'
    case 'json':
      return liveUdt === 'json' ? '::json' : '::jsonb'
    default:
      return ''
  }
}

async function applyEntries(
  tx: WriteTransaction,
  resolved: ResolvedPlan,
  catalog: { columns: Array<{ table: string; column: string; udtName: string }> },
  toleratedProfileIds: Set<string>
): Promise<void> {
  const liveUdt = (table: string, column: string): string | undefined =>
    catalog.columns.find((entry) => entry.table === table && entry.column === column)?.udtName
  const planned = plannedIdsByEntity(resolved)

  for (const entity of ENTITY_ORDER) {
    const spec = entitySpec(entity)
    const creates: CanonicalRow[] = []
    const updates: CanonicalRow[] = []

    for (const destinationId of planned[entity].values()) {
      const row = resolved.expectedResult[entity].find((candidate) => String(candidate.id) === destinationId)
      if (!row) continue
      // A profile created by the provider trigger already exists: applying its
      // approved state is an update, not an insert.
      if (entity === 'profiles' && toleratedProfileIds.has(destinationId)) updates.push(row)
      else creates.push(row)
    }
    for (const entry of resolved.entries) {
      if (entry.entity !== entity || entry.sourceId === null || entry.action !== 'update') continue
      const destinationId = resolved.idMap[entity][entry.sourceId]
      if (!destinationId) continue
      const row = resolved.expectedResult[entity].find((candidate) => String(candidate.id) === destinationId)
      if (row) updates.push(row)
    }

    if (creates.length > 0) {
      const columns = spec.columns.map((column) => column.name)
      for (let offset = 0; offset < creates.length; offset += MAX_INSERT_ROWS) {
        const chunk = creates.slice(offset, offset + MAX_INSERT_ROWS)
        const params: unknown[] = []
        const values = chunk.map((row) => {
          const placeholders = columns.map((name) => {
            params.push(row[name] ?? null)
            const kind = spec.columns.find((column) => column.name === name)?.kind ?? 'text'
            return `$${params.length}${castFor(kind, liveUdt(entity, name))}`
          })
          return `(${placeholders.join(', ')})`
        })
        await tx.query(
          `insert into public.${entity} (${columns.map((name) => `"${name}"`).join(', ')}) values ${values.join(', ')}`,
          params
        )
      }
    }

    for (const row of updates) {
      const params: unknown[] = []
      const assignments: string[] = []
      for (const column of spec.columns) {
        if (spec.primaryKey.includes(column.name)) continue
        params.push(row[column.name] ?? null)
        assignments.push(`"${column.name}" = $${params.length}${castFor(column.kind, liveUdt(entity, column.name))}`)
      }
      const predicates: string[] = []
      for (const key of spec.primaryKey) {
        params.push(row[key] ?? null)
        const kind = spec.columns.find((column) => column.name === key)?.kind ?? 'text'
        predicates.push(`"${key}" = $${params.length}${castFor(kind, liveUdt(entity, key))}`)
      }
      await tx.query(`update public.${entity} set ${assignments.join(', ')} where ${predicates.join(' and ')}`, params)
    }
  }
}

function plannedIdsByEntity(resolved: ResolvedPlan): Record<MigrationEntity, Map<string, string>> {
  const planned = {} as Record<MigrationEntity, Map<string, string>>
  for (const entity of ENTITY_ORDER) planned[entity] = new Map()
  for (const entry of resolved.entries) {
    if (entry.sourceId === null || entry.action !== 'create') continue
    const destinationId = resolved.idMap[entry.entity]?.[entry.sourceId]
    if (destinationId) planned[entry.entity].set(entry.sourceId, destinationId)
  }
  return planned
}

async function writeMappings(tx: WriteTransaction, resolved: ResolvedPlan, runId: string): Promise<void> {
  const sourceNamespace = resolved.plan.sourceInstance.namespace
  for (const entity of ENTITY_ORDER) {
    for (const [sourceId, destinationId] of Object.entries(resolved.idMap[entity] ?? {})) {
      await tx.query(
        `insert into public.migration_record_map (source_namespace, entity, source_id, destination_id, run_id)
         values ($1, $2, $3, $4, $5)
         on conflict (source_namespace, entity, source_id)
         do update set destination_id = excluded.destination_id, run_id = excluded.run_id`,
        [sourceNamespace, entity, sourceId, destinationId, runId]
      )
    }
  }
}

async function writeReceipt(
  tx: WriteTransaction,
  runId: string,
  resolved: ResolvedPlan,
  counts: ApplyCounts,
  now: Date
): Promise<ReceiptRecord> {
  const plan = resolved.plan
  await tx.query(
    `insert into public.migration_runs (
       run_id, bundle_id, bundle_digest, plan_digest, resolution_digest, expected_result_digest,
       source_namespace, target_namespace, application_version, schema_fingerprint, state, counts, committed_at
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'data-committed',$11::jsonb,$12)`,
    [
      runId,
      plan.bundleId,
      plan.bundleDigest,
      plan.planDigest,
      resolved.resolutionDigest,
      resolved.expectedResultDigest,
      plan.sourceInstance.namespace,
      plan.target.namespace,
      plan.target.applicationVersion,
      plan.target.schemaFingerprint,
      JSON.stringify(counts),
      now.toISOString(),
    ]
  )
  return {
    runId,
    bundleDigest: plan.bundleDigest,
    planDigest: plan.planDigest,
    resolutionDigest: resolved.resolutionDigest,
    expectedResultDigest: resolved.expectedResultDigest,
    sourceNamespace: plan.sourceInstance.namespace,
    targetNamespace: plan.target.namespace,
    state: 'data-committed',
    counts: counts as unknown as Record<string, unknown>,
  }
}

async function readReceipt(session: WriteSession, runId: string): Promise<ReceiptRecord | null> {
  const rows = await session.query<{
    run_id: string
    bundle_digest: string
    plan_digest: string
    resolution_digest: string
    expected_result_digest: string
    source_namespace: string
    target_namespace: string
    state: string
    counts: Record<string, unknown>
  }>('select * from public.migration_runs where run_id = $1', [runId])
  const row = rows[0]
  if (!row) return null
  return {
    runId: row.run_id,
    bundleDigest: row.bundle_digest,
    planDigest: row.plan_digest,
    resolutionDigest: row.resolution_digest,
    expectedResultDigest: row.expected_result_digest,
    sourceNamespace: row.source_namespace,
    targetNamespace: row.target_namespace,
    state: row.state,
    counts: row.counts,
  }
}

/** Compare the committed destination against the exact expected merged state. */
export async function reconcile(session: WriteSession, resolved: ResolvedPlan): Promise<MergeIssue[]> {
  const issues: MergeIssue[] = []
  const current = await readDeploymentSnapshot(session)
  for (const entity of ENTITY_ORDER) {
    const digest = entityDigest(entity, current.rows[entity])
    if (digest !== resolved.perEntityDigest[entity]) {
      issues.push({
        code: 'E_RECONCILE_MISMATCH',
        entity,
        sourceId: null,
        message: `Committed ${entity} rows do not match the approved expected result.`,
      })
    }
  }
  return issues
}
