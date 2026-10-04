// tools/migration/src/import.ts
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

import { ENTITY_ORDER, entitySpec, isMigrationEntity, primaryKeyOf, type CanonicalRow, type MigrationEntity } from './format'
import { MigrationRunError } from './journal'
import { deploymentSnapshotDigest, entityDigest, type MergeIssue, type ResolvedPlan } from './merge-plan'
import { verifyResolvedPlan } from './resolutions'
import { buildIdentityDispositions, type IdentityDispositionPlan } from './identities'
import { lockWriteGateForApply, readWriteGateForApply } from './gate'
import { cleanupRunIdentities, provisionIdentities, type IdentityProvisionOutcome } from './identity'
import { computeSchemaFingerprint, checkMigrationLedger, CURRENT_APPLICATION_RELEASE } from './schema'
import { readDeploymentSnapshot, type DeploymentSnapshot } from './providers/read'
import type { AuthAdminPort } from './providers/supabase'
import type { WriteSession, WriteTransaction } from './providers/session'
import { decodePersistedKey, encodePersistedKey } from './persisted-key'

const MAX_INSERT_ROWS = 100

export interface ApplyRequest {
  runId: string
  resolvedPlan: ResolvedPlan
  session: WriteSession
  auth: AuthAdminPort | null
  /** Reviewed plan digest the operator recorded; must match the artifact. */
  expectPlanDigest?: string
  /**
   * Application release the operator declares for this apply. It must equal
   * the release recorded in the reviewed plan (plan C01M task 5 binds the
   * application version and requires a recheck before mutation).
   */
  expectedApplicationVersion?: string
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
  /**
   * Row-content differences found when a verified/published receipt is
   * replayed as a no-op: legitimate later edits are reported, never
   * overwritten. Present only on the no-op path; absent on failure, where
   * drift is reported through `issues` instead.
   */
  rowDriftIssues?: MergeIssue[]
  counts: ApplyCounts
  identityProvisions: IdentityProvisionOutcome[]
  /**
   * Identity dispositions and enrollment status, recorded separately from the
   * data import so an operator can see which accounts enroll where.
   */
  identityDispositions: IdentityDispositionSummary | null
  receipt: ReceiptRecord | null
}

export interface IdentityDispositionSummary {
  counts: Record<string, number>
  enrollments: Record<string, number>
  /** Destination ids created through the Auth provider by this run. */
  provisioned: string[]
  /** Referenced by imported data but not an account: never a login. */
  historical: string[]
  /**
   * Run-created identities removed after a failed provisioning pass. Empty
   * unless the pass failed; a retry can re-create them under the same run id.
   */
  cleanedUp: string[]
}

function issue(code: string, message: string, entity: MigrationEntity | null = null): MergeIssue {
  return { code, entity, sourceId: null, message }
}

export async function applyResolvedPlan(request: ApplyRequest): Promise<ApplyResult> {
  const { resolvedPlan: resolved, session } = request
  const empty: ApplyCounts = { created: 0, updated: 0, mapped: 0, excluded: 0 }
  const failures = (
    issues: MergeIssue[],
    extra: Partial<Pick<ApplyResult, 'identityProvisions' | 'identityDispositions' | 'receipt'>> = {}
  ): ApplyResult => ({
    status: 'failed',
    issues,
    counts: empty,
    identityProvisions: extra.identityProvisions ?? [],
    identityDispositions: extra.identityDispositions ?? null,
    receipt: extra.receipt ?? null,
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

  const declaredApplicationVersion =
    request.expectedApplicationVersion ?? CURRENT_APPLICATION_RELEASE
  if (declaredApplicationVersion !== plan.target.applicationVersion) {
    return failures([
      issue(
        'E_RELEASE_MISMATCH',
        `The operator declared application release "${declaredApplicationVersion}" but the plan was reviewed for "${plan.target.applicationVersion}". Re-plan against the current release or correct --target-app-version.`
      ),
    ])
  }

  const identity = await session.identity()
  // The runtime fingerprint is role-independent, so it also catches a
  // destination reached through a connection whose namespace was computed with
  // different privileges than the one used at plan time.
  if (
    identity.namespace !== plan.target.namespace ||
    identity.runtimeFingerprint !== plan.target.runtimeFingerprint
  ) {
    return failures([
      issue(
        'E_TARGET_MISMATCH',
        `This plan was reviewed for destination ${plan.target.namespace} (${plan.target.runtimeFingerprint.slice(0, 12)}) but the connection resolves to ${identity.namespace} (${identity.runtimeFingerprint.slice(0, 12)}).`
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

  const ledgerCheck = checkMigrationLedger(identity.provider, await session.migrationLedger())
  if (!ledgerCheck.ok) {
    return failures([
      issue(
        'E_LEDGER_INCOMPLETE',
        `The destination migration ledger is missing required migrations (${ledgerCheck.missing.join(', ')}); apply the destination's own migration set before importing.`
      ),
    ])
  }
  // Completed receipt replay is deliberately read-only: it validates durable,
  // run-owned evidence and reports data drift, but never needs writers to be
  // fenced. Every path that may promote a receipt or mutate identities/data
  // uses this precheck and then takes the transactional row lock below.
  const fencedGateIssue = async (): Promise<MergeIssue | null> => {
    let gatePrecheck: Awaited<ReturnType<typeof readWriteGateForApply>>
    try {
      gatePrecheck = await readWriteGateForApply(session)
    } catch (error) {
      return issue(
        'E_GATE_UNREADABLE',
        `Run ${request.runId} cannot apply because the destination write gate could not be read: ${error instanceof Error ? error.message : String(error)}`
      )
    }
    if (gatePrecheck.kind === 'missing-table' || gatePrecheck.kind === 'missing-row') {
      return issue(
        'E_GATE_MISSING',
        `Run ${request.runId} cannot apply: the destination has no write-gate ${gatePrecheck.kind === 'missing-table' ? 'table' : 'row'}, so it cannot prove it was fenced. Initialize and fence the destination first.`
      )
    }
    if (gatePrecheck.kind === 'open') {
      return issue(
        'E_WRITERS_NOT_FENCED',
        `Run ${request.runId} cannot apply while destination writers are admitted. Fence the destination first (migration gate --state fenced --reason ...); the current gate was last set by ${gatePrecheck.gate.updatedBy}.`
      )
    }
    return null
  }

  const existingReceipt = await readReceipt(session, request.runId)
  if (existingReceipt) {
    if (!receiptIsCommitted(existingReceipt)) {
      return failures([issue('E_RECEIPT_STATE', `Run ${request.runId} has receipt state ${existingReceipt.state}; it is not a completed import.`)])
    }
    if (receiptMatchesResolved(existingReceipt, resolved)) {
      if (existingReceipt.state === 'data-committed') {
        const gateIssue = await fencedGateIssue()
        if (gateIssue) return failures([gateIssue])
        // A data-committed receipt has not yet been promoted to `verified`, so
        // promotion keeps the full bar: rows, mappings, dispositions and retry
        // history must still match the approved result. Later edits fail here
        // rather than being waved through by the promotion.
        const issues = await postCommitIssues(session, resolved, request.runId)
        if (issues.length > 0) {
          return failures(issues, {
            identityDispositions: identityDispositionSummary(buildIdentityDispositions(resolved)),
            receipt: existingReceipt,
          })
        }
        const verifiedReceipt = await markReceiptVerified(session, existingReceipt)
        return {
          status: 'no-op',
          issues: [],
          counts: empty,
          identityProvisions: [],
          identityDispositions: identityDispositionSummary(buildIdentityDispositions(resolved)),
          receipt: verifiedReceipt,
        }
      }
      // A verified or published receipt already passed full reconciliation
      // before promotion. The immutable run-owned evidence must still be
      // intact; later row edits are legitimate, so they are reported as drift,
      // never overwritten and never mistaken for corruption. A read failure
      // propagates instead of masquerading as a no-op warning.
      const issues = [
        ...(await verifyMappings(session, resolved)),
        ...(await verifyDispositions(session, resolved, request.runId)),
        ...(await verifyRetryHistory(session, resolved, request.runId)),
      ]
      if (issues.length > 0) {
        return failures(issues, {
          identityDispositions: identityDispositionSummary(buildIdentityDispositions(resolved)),
          receipt: existingReceipt,
        })
      }
      let rowDriftIssues: MergeIssue[] = []
      try {
        rowDriftIssues = await reconcile(session, resolved)
      } catch (error) {
        return failures([
          issue(
            'E_POST_COMMIT_RECONCILE',
            `The committed state could not be read to check the reviewed result: ${error instanceof Error ? error.message : String(error)}`
          ),
        ], {
          identityDispositions: identityDispositionSummary(buildIdentityDispositions(resolved)),
          receipt: existingReceipt,
        })
      }
      return {
        status: 'no-op',
        issues: [],
        rowDriftIssues,
        counts: empty,
        identityProvisions: [],
        identityDispositions: identityDispositionSummary(buildIdentityDispositions(resolved)),
        receipt: existingReceipt,
      }
    }
    return failures([
      issue('E_RUN_ID_REUSED', `Run id ${request.runId} was already used for different digests; refusing to replay it.`),
    ])
  }

  const gateIssue = await fencedGateIssue()
  if (gateIssue) return failures([gateIssue])

  const baseline = await readDeploymentSnapshot(session, plan.sourceInstance.namespace)
  if (deploymentSnapshotDigest(baseline) !== plan.target.snapshotDigest) {
    return failures([
      issue('E_STALE_PLAN', 'The destination changed since this plan was reviewed; regenerate and re-review the plan.'),
    ])
  }

  if (!plan.snapshot.retryHistoryCaptured) {
    return failures([
      issue(
        'E_RETRY_HISTORY_MISSING',
        'The reviewed bundle did not capture portable retry history; re-export after installing the retry-history migration.'
      ),
    ])
  }

  // --- identity disposition (pure, before any provider call) ---
  // Every source account must be mapped, provisioned, historical/non-login or
  // explicitly excluded before the destination is touched; anything else is a
  // blocker rather than a silent default.
  const identityPlan = buildIdentityDispositions(resolved)
  if (identityPlan.blockers.length > 0) {
    return failures(
      identityPlan.blockers.map((blocker) => issue(blocker.code, blocker.message, 'profiles'))
    )
  }
  const dispositionSummary: IdentityDispositionSummary = {
    counts: identityPlan.counts,
    enrollments: identityPlan.enrollments,
    provisioned: [],
    historical: identityPlan.historicalReferenceIds,
    cleanedUp: [],
  }

  // --- identity provisioning (outside the app-data transaction) ---
  const plannedProfiles = plannedProfileCreates(resolved, new Set(identityPlan.provisionIds))
  let provisions: IdentityProvisionOutcome[] = []
  try {
    provisions = await provisionIdentities({
      runId: request.runId,
      provider: identity.provider,
      requests: plannedProfiles.map((row) => {
        const id = String(row.id)
        const disposition = identityPlan.dispositions.find((item) => item.destinationId === id)
        return {
          id,
          email: String(row.email),
          name: typeof row.name === 'string' ? row.name : '',
          // A source verification fact is recorded for review; it is never
          // applied, because the destination re-verifies on enrollment.
          sourceEmailConfirmed: disposition?.sourceEmailConfirmed ?? null,
        }
      }),
      session,
      auth: request.auth,
    })
  } catch (error) {
    // Partial provisioning is reported separately instead of being collapsed
    // into one message: the journal proves which accounts were created or
    // adopted before the failure, and those run-created accounts are removed
    // again (no app-data receipt can exist yet, so cleanup is safe).
    const issues: MergeIssue[] = [
      issue('E_IDENTITY_PROVISION', error instanceof Error ? error.message : String(error)),
    ]
    let partial: IdentityProvisionOutcome[] = []
    try {
      partial = await journaledProvisionOutcomes(session, request.runId, plannedProfiles)
    } catch (journalError) {
      issues.push(
        issue(
          'E_IDENTITY_JOURNAL',
          `Journaled provisioning outcomes could not be read: ${
            journalError instanceof Error ? journalError.message : String(journalError)
          }`
        )
      )
    }
    const cleanup = await cleanupRunIdentities({ runId: request.runId, session, auth: request.auth }).catch(
      () => ({ deleted: [], errors: ['identity cleanup could not be attempted'] })
    )
    issues.push(...cleanup.errors.map((message) => issue('E_IDENTITY_CLEANUP', message)))
    return failures(issues, {
      identityProvisions: partial,
      identityDispositions: {
        ...dispositionSummary,
        provisioned: partial
          .filter((provision) => provision.action === 'created')
          .map((provision) => provision.id)
          .sort(),
        cleanedUp: [...cleanup.deleted].sort(),
      },
    })
  }
  dispositionSummary.provisioned = provisions
    .filter((provision) => provision.action === 'created')
    .map((provision) => provision.id)
    .sort()
  const toleratedProfileIds = new Set(provisions.filter((p) => p.action !== 'skipped').map((p) => p.id))

  const afterProvisioning = await readDeploymentSnapshot(session, plan.sourceInstance.namespace)
  const provisioningDrift = baselineDrift(plan.target.snapshotDigest, afterProvisioning, toleratedProfileIds)
  if (provisioningDrift) {
    // The destination changed for reasons other than this run's journaled
    // provisioning, so remove the accounts this run created before stopping.
    const cleanup = await cleanupRunIdentities({ runId: request.runId, session, auth: request.auth }).catch(
      () => ({ deleted: [], errors: ['identity cleanup could not be attempted'] })
    )
    return failures(
      [
        issue('E_DESTINATION_DRIFT', provisioningDrift),
        ...cleanup.errors.map((message) => issue('E_IDENTITY_CLEANUP', message)),
      ],
      {
        identityProvisions: provisions,
        identityDispositions: { ...dispositionSummary, cleanedUp: [...cleanup.deleted].sort() },
      }
    )
  }

  const counts = countPlannedWork(resolved)
  let receipt: ReceiptRecord | null = null

  try {
    await session.transaction(async (tx) => {
      // Take the destination gate lock before anything is checked or written:
      // it serializes concurrent applies and operator transitions, and it
      // refuses an apply whose destination was never fenced (C06A fences both
      // deployments for the final planning/apply window).
      await lockWriteGateForApply(tx, request.runId)

      // The baseline is rechecked inside the transaction: the window between
      // preflight and here must not hide a concurrent writer.
      const inTransaction = await readDeploymentSnapshot(session, plan.sourceInstance.namespace)
      const inTransactionDrift = baselineDrift(
        plan.target.snapshotDigest,
        inTransaction,
        toleratedProfileIds
      )
      if (inTransactionDrift) {
        throw new MigrationRunError('E_DESTINATION_DRIFT', inTransactionDrift)
      }

      await applyEntries(tx, resolved, catalog, toleratedProfileIds)
      // Mappings must carry the import receipt's run id: the destination's
      // provenance reader joins map rows to their receipt, and a planning run
      // id here would silently break every later reverse/repeat migration.
      await writeMappings(tx, resolved, request.runId)
      await writeDispositions(tx, resolved, request.runId)
      await writeRetryHistory(tx, resolved, request.runId)
      receipt = await writeReceipt(tx, request.runId, resolved, counts, request.now?.() ?? new Date())

      const reconciled = await reconcile(session, resolved)
      if (reconciled.length > 0) {
        throw new MigrationRunError('E_RECONCILE_FAILED', reconciled.map((item) => item.message).join(' | '))
      }
    })
  } catch (error) {
    // A commit can succeed even when the connection loses its response. Never
    // remove Auth users until a durable receipt query proves no app-data commit
    // happened; deleting them after commit could cascade into merged records.
    let durableReceipt: ReceiptRecord | null
    try {
      durableReceipt = await readReceipt(session, request.runId)
    } catch {
      return failures([issue('E_COMMIT_UNCERTAIN', 'The transaction outcome could not be confirmed; keep journaled identities and inspect the destination receipt before retrying.')])
    }
    if (durableReceipt) {
      if (!receiptIsCommitted(durableReceipt)) {
        return failures([issue('E_RECEIPT_STATE', `Run ${request.runId} has receipt state ${durableReceipt.state}; keep journaled identities and investigate.`)])
      }
      if (!receiptMatchesResolved(durableReceipt, resolved)) {
        return failures([issue('E_RECEIPT_MISMATCH', 'A durable receipt exists for this run with different digests; keep journaled identities and investigate.')])
      }
      const issues = await postCommitIssues(session, resolved, request.runId)
      if (issues.length > 0) {
        return { status: 'failed', issues, counts, identityProvisions: provisions, identityDispositions: dispositionSummary, receipt: durableReceipt }
      }
      const verifiedReceipt = durableReceipt.state === 'data-committed'
        ? await markReceiptVerified(session, durableReceipt)
        : durableReceipt
      return { status: 'committed', issues: [], counts, identityProvisions: provisions, identityDispositions: dispositionSummary, receipt: verifiedReceipt }
    }
    const cleanup = await cleanupRunIdentities({ runId: request.runId, session, auth: request.auth }).catch(() => ({
      deleted: [],
      errors: ['identity cleanup could not be attempted'],
    }))
    return failures(
      [
        issue('E_APPLY_FAILED', error instanceof Error ? error.message : String(error)),
        ...cleanup.errors.map((message) => issue('E_IDENTITY_CLEANUP', message)),
      ],
      {
        identityProvisions: provisions,
        identityDispositions: { ...dispositionSummary, cleanedUp: [...cleanup.deleted].sort() },
      }
    )
  }

  if (!receipt) {
    return failures([issue('E_RECEIPT_MISSING', 'The import transaction completed without returning its durable receipt.')], {
      identityProvisions: provisions,
      identityDispositions: dispositionSummary,
    })
  }
  const committedIssues = await postCommitIssues(session, resolved, request.runId)
  if (committedIssues.length > 0) {
    return { status: 'failed', issues: committedIssues, counts, identityProvisions: provisions, identityDispositions: dispositionSummary, receipt }
  }
  try {
    receipt = await markReceiptVerified(session, receipt)
  } catch (error) {
    return {
      status: 'failed',
      issues: [issue('E_VERIFY_STATE', error instanceof Error ? error.message : String(error))],
      counts,
      identityProvisions: provisions,
      identityDispositions: dispositionSummary,
      receipt,
    }
  }
  return { status: 'committed', issues: [], counts, identityProvisions: provisions, identityDispositions: dispositionSummary, receipt }
}

function receiptIsCommitted(receipt: ReceiptRecord): boolean {
  return receipt.state === 'data-committed' ||
    receipt.state === 'verified' ||
    receipt.state === 'publication-intent' ||
    receipt.state === 'writable'
}

function receiptMatchesResolved(receipt: ReceiptRecord, resolved: ResolvedPlan): boolean {
  return receipt.bundleDigest === resolved.plan.bundleDigest &&
    receipt.planDigest === resolved.plan.planDigest &&
    receipt.resolutionDigest === resolved.resolutionDigest &&
    receipt.expectedResultDigest === resolved.expectedResultDigest &&
    receipt.sourceNamespace === resolved.plan.sourceInstance.namespace &&
    receipt.targetNamespace === resolved.plan.target.namespace
}

/* ------------------------------------------------------------------ */

function identityDispositionSummary(plan: IdentityDispositionPlan): IdentityDispositionSummary {
  return {
    counts: plan.counts,
    enrollments: plan.enrollments,
    provisioned: [],
    historical: plan.historicalReferenceIds,
    cleanedUp: [],
  }
}

/**
 * A failed provisioning pass can still report what it did: every provider
 * outcome is journaled before the next account is attempted. Emails come from
 * the reviewed requests; nothing is inferred from the destination.
 */
async function journaledProvisionOutcomes(
  session: WriteSession,
  runId: string,
  plannedProfiles: CanonicalRow[]
): Promise<IdentityProvisionOutcome[]> {
  const rows = await session.query<{ destination_id: string; action: string }>(
    'select destination_id, action from public.migration_identity_journal where run_id = $1 order by destination_id',
    [runId]
  )
  const emailById = new Map(plannedProfiles.map((row) => [String(row.id), String(row.email)]))
  return rows.map((row) => ({
    id: row.destination_id,
    email: emailById.get(row.destination_id) ?? '',
    action: row.action === 'created' ? 'created' : 'adopted',
    detail: 'journaled before the provisioning pass failed',
  }))
}

/**
 * Profile rows this apply may provision through the Auth provider: only the
 * identities the disposition plan classified as `provision`. A historical
 * reference or an excluded account never reaches the provider.
 */
function plannedProfileCreates(resolved: ResolvedPlan, provisionIds: Set<string>): CanonicalRow[] {
  const created: CanonicalRow[] = []
  for (const entry of resolved.entries) {
    if (entry.entity !== 'profiles' || entry.action !== 'create' || entry.sourceId === null) continue
    const destinationId = resolved.idMap.profiles[entry.sourceId]
    if (!destinationId || !provisionIds.has(destinationId)) continue
    const row = resolved.expectedResult.profiles.find((candidate) => String(candidate.id) === destinationId)
    if (row) created.push(row)
  }
  return created
}

/**
 * Compare the current destination against the reviewed baseline, tolerating
 * only the profile rows and identity records this run's provisioning created.
 *
 * The caller reads only receipts for this plan's source namespace. A new
 * receipt from that source changes the baseline; other sources do not.
 */
function baselineDrift(
  expectedDigest: string,
  current: DeploymentSnapshot,
  toleratedProfileIds: Set<string>
): string | null {
  if (deploymentSnapshotDigest(current) === expectedDigest) return null
  if (toleratedProfileIds.size === 0) {
    return 'The destination changed since this plan was reviewed.'
  }
  const filtered: DeploymentSnapshot = {
    ...current,
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
    const baseline = new Map(resolved.plan.snapshot.targetRows[entity].map((row) => [primaryKeyOf(entity, row), row]))

    for (const destinationId of planned[entity].values()) {
      const row = resolved.expectedResult[entity].find((candidate) => primaryKeyOf(entity, candidate) === destinationId)
      if (!row) continue
      // A profile created by the provider trigger already exists: applying its
      // approved state is an update, not an insert.
      if (entity === 'profiles' && toleratedProfileIds.has(destinationId)) updates.push(row)
      else creates.push(row)
    }
    // Map decisions can select fields and security values too. The reviewed
    // state, rather than the disposition label, determines existing-row writes.
    for (const row of resolved.expectedResult[entity]) {
      const previous = baseline.get(primaryKeyOf(entity, row))
      if (previous && spec.columns.some((column) => row[column.name] !== previous[column.name])) {
        updates.push(row)
      }
    }

    // These nullable unique indexes are immediate on both backends. Release
    // only occupied slots whose reviewed value changes, before any final
    // writes, so creates can reuse them and updates can swap them. The caller's
    // single transaction rolls this staging back together with all other writes.
    if (entity === 'projects' || entity === 'activity_types') {
      for (const row of updates) {
        const previous = baseline.get(primaryKeyOf(entity, row))
        if (previous?.telegram_no != null && previous.telegram_no !== row.telegram_no) {
          await tx.query(
            `update public.${entity} set "telegram_no" = null where "id" = $1${castFor('uuid', liveUdt(entity, 'id'))}`,
            [row.id]
          )
        }
      }
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
        [sourceNamespace, entity, encodePersistedKey(sourceId), encodePersistedKey(destinationId), runId]
      )
    }
  }
}

/**
 * Persist the complete reviewed disposition of every source record. This is
 * deliberately separate from the mapping table: excluded records have no
 * destination mapping, and dependent exclusions still need a durable reason.
 */
async function writeDispositions(tx: WriteTransaction, resolved: ResolvedPlan, runId: string): Promise<void> {
  const exclusionReasons = new Map(
    resolved.exclusions.map((item) => [`${item.entity}\u0000${item.sourceId}`, item.reason])
  )
  for (const entry of resolved.entries) {
    if (entry.sourceId === null) continue
    const key = `${entry.entity}\u0000${entry.sourceId}`
    const destinationId = entry.action === 'exclude'
      ? null
      : resolved.idMap[entry.entity]?.[entry.sourceId] ?? entry.destinationId
    await tx.query(
      `insert into public.migration_record_dispositions
         (run_id, source_namespace, entity, source_id, action, destination_id, reason)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [
        runId,
        resolved.plan.sourceInstance.namespace,
        entry.entity,
        encodePersistedKey(entry.sourceId),
        entry.action,
        destinationId === null ? null : encodePersistedKey(destinationId),
        exclusionReasons.get(key) ?? null,
      ]
    )
  }
}

function retryResourceEntity(operation: string): MigrationEntity | null {
  if (operation.endsWith('_timesheet')) return 'timesheets'
  if (operation.endsWith('_leave')) return 'leaves'
  if (operation.endsWith('_reminder')) return 'reminders'
  return null
}

async function writeRetryHistory(tx: WriteTransaction, resolved: ResolvedPlan, runId: string): Promise<void> {
  for (const fact of resolved.plan.snapshot.retryHistory) {
    const destinationActorId = resolved.idMap.profiles?.[fact.sourceActorId] ?? null
    const resourceEntity = retryResourceEntity(fact.operation)
    const destinationResourceId = fact.sourceResourceId && resourceEntity
      ? resolved.idMap[resourceEntity]?.[fact.sourceResourceId] ?? null
      : null
    await tx.query(
      `insert into public.migration_retry_history (
         source_namespace, key, source_actor_id, destination_actor_id, operation,
         outcome, response_status, fingerprint_kind, fingerprint,
         source_resource_id, destination_resource_id, created_at, run_id
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        fact.sourceNamespace,
        fact.key,
        fact.sourceActorId,
        destinationActorId,
        fact.operation,
        fact.outcome,
        fact.responseStatus,
        fact.fingerprintKind,
        fact.fingerprint,
        fact.sourceResourceId,
        destinationResourceId,
        fact.createdAt,
        runId,
      ]
    )
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
  }>(
    `select run_id, bundle_digest, plan_digest, resolution_digest, expected_result_digest,
            source_namespace, target_namespace, state, counts
       from public.migration_runs where run_id = $1`,
    [runId]
  )
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

/**
 * Verify a committed run the way a later migration will read it: the rows must
 * still reconcile against the approved result, and every reviewed
 * source→destination mapping must be present and exact. A receipt alone proves
 * the digests, not that the durable state still matches them.
 */
async function postCommitIssues(
  session: WriteSession,
  resolved: ResolvedPlan,
  runId: string
): Promise<MergeIssue[]> {
  try {
    return [
      ...(await reconcile(session, resolved)),
      ...(await verifyMappings(session, resolved)),
      ...(await verifyDispositions(session, resolved, runId)),
      ...(await verifyRetryHistory(session, resolved, runId)),
    ]
  } catch {
    return [
      issue(
        'E_POST_COMMIT_RECONCILE',
        'The committed state could not be reconciled; keep journaled identities and verify the destination.'
      ),
    ]
  }
}

async function markReceiptVerified(session: WriteSession, receipt: ReceiptRecord): Promise<ReceiptRecord> {
  await session.transaction(async (tx) => {
    await lockWriteGateForApply(tx, receipt.runId)
    const rows = await tx.query<{ state: string }>(
      'select state from public.migration_runs where run_id = $1 for update',
      [receipt.runId]
    )
    const state = rows[0]?.state
    if (state !== 'data-committed' && state !== 'verified') {
      throw new MigrationRunError(
        'E_RECEIPT_STATE',
        `Run ${receipt.runId} cannot be verified from receipt state ${state ?? 'missing'}.`
      )
    }
    if (state === 'data-committed') {
      await tx.query("update public.migration_runs set state = 'verified' where run_id = $1", [receipt.runId])
    }
  })
  return { ...receipt, state: 'verified' }
}

/**
 * Mapping check for a committed run against the reviewed id map.
 *
 * The mapping table is keyed by (source_namespace, entity, source_id) and a
 * later run may legitimately re-map a record (relabelling `run_id`) or add
 * mappings this resolution never contained. What must hold for this run is that
 * every reviewed pair still exists with the exact destination id; extra rows
 * belong to other runs and are not this run's corruption.
 */
async function verifyMappings(session: WriteSession, resolved: ResolvedPlan): Promise<MergeIssue[]> {
  const sourceNamespace = resolved.plan.sourceInstance.namespace
  const rows = await session.query<{ entity: string; source_id: string; destination_id: string }>(
    'select entity, source_id, destination_id from public.migration_record_map where source_namespace = $1',
    [sourceNamespace]
  )
  const actual = new Map(rows.map((row) => [
    `${row.entity}\u0000${decodePersistedKey(row.source_id)}`,
    { ...row, destination_id: decodePersistedKey(row.destination_id) },
  ]))
  const issues: MergeIssue[] = []
  for (const entity of ENTITY_ORDER) {
    for (const [sourceId, destinationId] of Object.entries(resolved.idMap[entity] ?? {})) {
      const row = actual.get(`${entity}\u0000${sourceId}`)
      if (!row) {
        issues.push({
          code: 'E_MAPPING_MISSING',
          entity,
          sourceId,
          message: `The committed run has no durable mapping for ${entity} ${sourceId}.`,
        })
      } else if (row.destination_id !== destinationId) {
        issues.push({
          code: 'E_MAPPING_MISMATCH',
          entity,
          sourceId,
          message: `The durable mapping for ${entity} ${sourceId} points at ${row.destination_id} instead of ${destinationId}.`,
        })
      }
    }
  }
  return issues
}

async function verifyDispositions(
  session: WriteSession,
  resolved: ResolvedPlan,
  runId: string
): Promise<MergeIssue[]> {
  const rows = await session.query<{
    entity: string
    source_id: string
    action: string
    destination_id: string | null
    reason: string | null
  }>(
    `select entity, source_id, action, destination_id, reason
       from public.migration_record_dispositions
      where run_id = $1 and source_namespace = $2`,
    [runId, resolved.plan.sourceInstance.namespace]
  )
  const actual = new Map(rows.map((row) => {
    const sourceId = decodePersistedKey(row.source_id)
    return [`${row.entity}\u0000${sourceId}`, {
      ...row, source_id: sourceId,
      destination_id: row.destination_id === null ? null : decodePersistedKey(row.destination_id),
    }]
  }))
  const reasons = new Map(
    resolved.exclusions.map((item) => [`${item.entity}\u0000${item.sourceId}`, item.reason])
  )
  const issues: MergeIssue[] = []
  for (const entry of resolved.entries) {
    if (entry.sourceId === null) continue
    const key = `${entry.entity}\u0000${entry.sourceId}`
    const row = actual.get(key)
    actual.delete(key)
    const expectedDestination = entry.action === 'exclude'
      ? null
      : resolved.idMap[entry.entity]?.[entry.sourceId] ?? entry.destinationId
    const expectedReason = reasons.get(key) ?? null
    if (!row) {
      issues.push({
        code: 'E_DISPOSITION_MISSING', entity: entry.entity, sourceId: entry.sourceId,
        message: `The committed run has no durable disposition for ${entry.entity} ${entry.sourceId}.`,
      })
    } else if (
      row.action !== entry.action ||
      row.destination_id !== expectedDestination ||
      row.reason !== expectedReason
    ) {
      issues.push({
        code: 'E_DISPOSITION_MISMATCH', entity: entry.entity, sourceId: entry.sourceId,
        message: `The durable disposition for ${entry.entity} ${entry.sourceId} does not match the reviewed resolution.`,
      })
    }
  }
  for (const row of actual.values()) {
    issues.push({
      code: 'E_DISPOSITION_UNEXPECTED',
      entity: isMigrationEntity(row.entity) ? row.entity : null,
      sourceId: row.source_id,
      message: `The committed run contains an unreviewed disposition for ${row.entity} ${row.source_id}.`,
    })
  }
  return issues
}

async function verifyRetryHistory(
  session: WriteSession,
  resolved: ResolvedPlan,
  runId: string
): Promise<MergeIssue[]> {
  const rows = await session.query<{
    source_namespace: string
    key: string
    source_actor_id: string
    destination_actor_id: string | null
    operation: string
    outcome: string
    response_status: number
    fingerprint_kind: string
    fingerprint: string
    source_resource_id: string | null
    destination_resource_id: string | null
    created_at: string
  }>(
    `select source_namespace, key, source_actor_id, destination_actor_id, operation,
            outcome, response_status, fingerprint_kind, fingerprint,
            source_resource_id, destination_resource_id,
            to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_at
       from public.migration_retry_history where run_id = $1`,
    [runId]
  )
  const keyOf = (item: { source_namespace: string; key: string; source_actor_id: string; operation: string }) =>
    `${item.source_namespace}\u0000${item.key}\u0000${item.source_actor_id}\u0000${item.operation}`
  const actual = new Map(rows.map((row) => [keyOf(row), row]))
  const issues: MergeIssue[] = []
  for (const fact of resolved.plan.snapshot.retryHistory) {
    const key = keyOf({
      source_namespace: fact.sourceNamespace,
      key: fact.key,
      source_actor_id: fact.sourceActorId,
      operation: fact.operation,
    })
    const row = actual.get(key)
    actual.delete(key)
    const resourceEntity = retryResourceEntity(fact.operation)
    const expectedResourceId = fact.sourceResourceId && resourceEntity
      ? resolved.idMap[resourceEntity]?.[fact.sourceResourceId] ?? null
      : null
    if (!row) {
      issues.push(issue('E_RETRY_HISTORY_MISSING', `The committed run is missing retry history ${fact.operation}/${fact.key}.`))
      continue
    }
    if (
      row.destination_actor_id !== (resolved.idMap.profiles?.[fact.sourceActorId] ?? null) ||
      row.outcome !== fact.outcome ||
      row.response_status !== fact.responseStatus ||
      row.fingerprint_kind !== fact.fingerprintKind ||
      row.fingerprint !== fact.fingerprint ||
      row.source_resource_id !== fact.sourceResourceId ||
      row.destination_resource_id !== expectedResourceId ||
      canonicalizeTimestampForCompare(row.created_at) !== canonicalizeTimestampForCompare(fact.createdAt)
    ) {
      issues.push(issue('E_RETRY_HISTORY_MISMATCH', `Retry history ${fact.operation}/${fact.key} differs from the reviewed artifact.`))
    }
  }
  if (actual.size > 0) {
    issues.push(issue('E_RETRY_HISTORY_UNEXPECTED', 'The committed run contains retry history absent from the reviewed artifact.'))
  }
  return issues
}

function canonicalizeTimestampForCompare(value: string): string {
  return value.replace(/\.0+Z$/, '.000000Z')
}
