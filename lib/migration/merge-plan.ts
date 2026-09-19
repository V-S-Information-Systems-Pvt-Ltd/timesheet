// lib/migration/merge-plan.ts
// Reviewed merge planning against a populated destination.
//
// buildPreview() turns a validated bundle plus a read-only destination snapshot
// into a complete, inspectable plan: every source record becomes create, update,
// map, exclude or an explicit unresolved conflict, and every destination-only
// record is retained. applyDecisions() turns an operator decision file into the
// exact expected merged state, which is validated against the application's
// real invariants (unique keys, foreign keys, hierarchy cycles, daily hour caps,
// singleton rows) before anything is allowed to write.

import { randomUUID } from 'node:crypto'
import {
  ENTITY_ORDER,
  bundleDigestOf,
  canonicalStringify,
  entitySpec,
  primaryKeyOf,
  sha256Hex,
  type BundleManifest,
  type CanonicalRow,
  type MigrationEntity,
  type ProviderName,
  type ProvenanceAlias,
  type SourceInstanceDescriptor,
} from './format'
import { MigrationRunError } from './journal'
import { MATCHING_RULES_VERSION, matchRecords, type MatchEvidence } from './matching'
import type { DeploymentSnapshot } from './providers/read'

export const MERGE_PLAN_FORMAT = 'vsis-data-migration-plan'
export const MERGE_PLAN_FORMAT_VERSION = 1
export const RESOLVED_PLAN_FORMAT = 'vsis-data-migration-resolved-plan'

export type PlanAction = 'create' | 'update' | 'map' | 'retain' | 'exclude'
export type SourceAction = Exclude<PlanAction, 'retain'>

export interface PreviewEntry {
  entity: MigrationEntity
  /** Null for retained destination-only rows. */
  sourceId: string | null
  destinationId: string | null
  action: PlanAction
  status: 'proposed' | 'unresolved' | 'resolved'
  evidence: MatchEvidence[]
  detail: string | null
}

export type ConflictKind =
  | 'account-candidate'
  | 'account-collision'
  | 'uuid-collision'
  | 'reference-candidate'
  | 'changed-record'
  | 'stale-provenance'

export interface UnresolvedConflict {
  entity: MigrationEntity
  sourceId: string
  destinationId: string | null
  kind: ConflictKind
  message: string
  allowedActions: SourceAction[]
  evidence: MatchEvidence[]
}

export interface EntityCounts {
  create: number
  update: number
  retain: number
  map: number
  exclude: number
  unresolved: number
}

export interface TargetDescriptor {
  provider: ProviderName
  namespace: string
  runtimeFingerprint: string
  applicationVersion: string
  schemaFingerprint: string
  snapshotDigest: string
}

export interface PlanSnapshot {
  sourceRows: Record<MigrationEntity, CanonicalRow[]>
  targetRows: Record<MigrationEntity, CanonicalRow[]>
  identities: DeploymentSnapshot['identities']
}

export interface MergePlan {
  format: typeof MERGE_PLAN_FORMAT
  formatVersion: typeof MERGE_PLAN_FORMAT_VERSION
  runId: string
  bundleId: string
  bundleDigest: string
  sourceInstance: SourceInstanceDescriptor
  target: TargetDescriptor
  matchingRulesVersion: number
  createdAt: string
  counts: Record<MigrationEntity, EntityCounts>
  unresolved: UnresolvedConflict[]
  entries: PreviewEntry[]
  /**
   * Both sides of the reviewed state, bound into the plan so `resolve` is a
   * pure step and `apply` can prove the destination has not drifted. This is a
   * sensitive artifact: it contains record bodies.
   */
  snapshot: PlanSnapshot
  /** Null while unresolved conflicts remain: no honest expected state exists yet. */
  expectedResultDigest: string | null
  planDigest: string
}

export interface MergeIssue {
  code: string
  entity: MigrationEntity | null
  sourceId: string | null
  message: string
}

export interface ExpectedResult {
  rows: Record<MigrationEntity, CanonicalRow[]>
  idMap: Record<MigrationEntity, Record<string, string>>
  exclusions: Array<{ entity: MigrationEntity; sourceId: string; reason: string }>
  perEntityDigest: Record<MigrationEntity, string>
  digest: string
}

/**
 * The reviewed, resolved artifact handed to `apply`: the preview plan, the
 * operator decisions, the complete expected merged state and every digest that
 * binds them.
 */
export interface ResolvedPlan {
  format: typeof RESOLVED_PLAN_FORMAT
  formatVersion: typeof MERGE_PLAN_FORMAT_VERSION
  plan: MergePlan
  decisions: unknown
  entries: PreviewEntry[]
  idMap: Record<MigrationEntity, Record<string, string>>
  exclusions: Array<{ entity: MigrationEntity; sourceId: string; reason: string }>
  expectedResult: Record<MigrationEntity, CanonicalRow[]>
  expectedResultDigest: string
  perEntityDigest: Record<MigrationEntity, string>
  operator: { name: string; at: string }
  resolutionDigest: string
}

export interface RecordDecision {
  entity: MigrationEntity
  sourceId: string
  action: SourceAction
  destinationId?: string
  fields?: Record<string, 'source' | 'destination'>
  reason?: string
}

export interface SecurityDecision {
  entity: MigrationEntity
  sourceId: string
  field: string
  value: string | boolean | number | null
  reason: string
}

export interface DecisionInput {
  records: RecordDecision[]
  security: SecurityDecision[]
  settings: Record<string, 'source' | 'destination'> | null
}

export interface DecisionApplication {
  entries: PreviewEntry[]
  idMap: Record<MigrationEntity, Record<string, string>>
  expected: ExpectedResult
  issues: MergeIssue[]
}

export interface PlanningContext {
  manifest: BundleManifest
  provenance: ProvenanceAlias[]
  sourceRows: Record<MigrationEntity, CanonicalRow[]>
  target: DeploymentSnapshot
  targetApplicationVersion: string
  targetSchemaFingerprint: string
}

/** Everything `resolve` needs, taken from the plan's own bound snapshot. */
export interface ResolutionContext {
  sourceRows: Record<MigrationEntity, CanonicalRow[]>
  targetRows: Record<MigrationEntity, CanonicalRow[]>
}

export function resolutionContextOf(plan: MergePlan): ResolutionContext {
  return { sourceRows: plan.snapshot.sourceRows, targetRows: plan.snapshot.targetRows }
}

// Fields an operator may resolve per record. Credentials, identity ownership,
// role axes, activation, manager links and verification facts are deliberately
// absent: they are only reachable through a security decision with a reason.
export const ALLOWED_MERGE_FIELDS: Record<MigrationEntity, string[]> = {
  titles: ['name'],
  whitelisted_domains: [],
  projects: ['name', 'so_number', 'telegram_no'],
  activity_types: ['name', 'is_active', 'telegram_no'],
  app_settings: [],
  profiles: ['name', 'department', 'title', 'dashboard_layout', 'admin_layout', 'mobile_layout'],
  global_reminders: ['message', 'remind_at'],
  timesheets: ['project_id', 'activity_type_id', 'log_date', 'hours_worked', 'work_done'],
  leaves: ['leave_date', 'reason'],
  reminders: ['message', 'remind_at', 'done'],
  global_reminder_dismissals: ['dismissed_at'],
  audit_logs: [],
}

export const SECURITY_FIELDS: Partial<Record<MigrationEntity, readonly string[]>> = {
  profiles: ['is_active', 'permission_role', 'hierarchy_role', 'manager_id'],
  titles: ['hierarchy_role'],
  whitelisted_domains: ['auto_activate'],
}

export const SETTINGS_FIELDS = [
  'backfill_window_days',
  'backfill_mode',
  'backfill_extra_days',
  'default_dashboard_layout',
  'default_admin_layout',
  'default_mobile_layout',
  'app_name',
  'primary_color',
  'logo_url',
  'updated_at',
] as const

const ACCOUNT_ENTITY: MigrationEntity = 'profiles'
const REFERENCE_ENTITIES: MigrationEntity[] = ['projects', 'activity_types', 'titles', 'whitelisted_domains']

/** Digest over every destination row and identity: later drift invalidates a plan. */
export function deploymentSnapshotDigest(snapshot: DeploymentSnapshot): string {
  const lines: string[] = []
  for (const entity of ENTITY_ORDER) {
    for (const row of snapshot.rows[entity]) lines.push(`row:${entity}:${canonicalStringify(row)}`)
  }
  for (const identity of snapshot.identities) {
    lines.push(
      `identity:${identity.id}:${identity.email ?? ''}:${String(identity.emailConfirmed)}:${String(identity.hasCredential)}`
    )
  }
  lines.sort()
  lines.push(
    `provider:${snapshot.provider}`,
    `namespace:${snapshot.namespace}`,
    `runtime:${snapshot.runtimeFingerprint}`
  )
  return sha256Hex(lines.join('\n'))
}

export function targetDescriptor(context: PlanningContext): TargetDescriptor {
  return {
    provider: context.target.provider,
    namespace: context.target.namespace,
    runtimeFingerprint: context.target.runtimeFingerprint,
    applicationVersion: context.targetApplicationVersion,
    schemaFingerprint: context.targetSchemaFingerprint,
    snapshotDigest: deploymentSnapshotDigest(context.target),
  }
}

/** True when any non-reference, non-identity column differs between two rows. */
export function rowsDifferIgnoringReferences(
  entity: MigrationEntity,
  left: CanonicalRow,
  right: CanonicalRow
): boolean {
  for (const column of entitySpec(entity).columns) {
    if (column.references) continue
    if (column.name === 'id') continue
    if (canonicalStringify(left[column.name] ?? null) !== canonicalStringify(right[column.name] ?? null)) {
      return true
    }
  }
  return false
}

function conflictFor(entity: MigrationEntity, match: { status: string }): ConflictKind {
  if (entity === ACCOUNT_ENTITY) {
    return match.status === 'collision' ? 'account-collision' : 'account-candidate'
  }
  if (REFERENCE_ENTITIES.includes(entity)) return 'reference-candidate'
  return 'uuid-collision'
}

function conflictActions(kind: ConflictKind): SourceAction[] {
  switch (kind) {
    case 'account-candidate':
    case 'stale-provenance':
      return ['map', 'exclude']
    // A UUID collision with a different email may be a distinct person: creating
    // a separate account (with an allocated id) is a legitimate reviewed choice.
    case 'account-collision':
      return ['map', 'create', 'exclude']
    // "Create separately with valid unique values" is a supported reference-row
    // choice; merged-state validation rejects it when the unique key collides.
    case 'reference-candidate':
      return ['map', 'create', 'exclude']
    case 'changed-record':
      return ['map', 'update', 'exclude']
    case 'uuid-collision':
      return ['map', 'create', 'exclude']
  }
}

export function buildPreview(
  context: PlanningContext,
  options: { runId: string; createdAt: string }
): MergePlan {
  const entries: PreviewEntry[] = []
  const unresolved: UnresolvedConflict[] = []
  const counts = {} as Record<MigrationEntity, EntityCounts>

  for (const entity of ENTITY_ORDER) {
    const sourceRows = context.sourceRows[entity]
    const destinationRows = context.target.rows[entity]
    const entityCounts: EntityCounts = { create: 0, update: 0, retain: 0, map: 0, exclude: 0, unresolved: 0 }
    const claimedDestinationKeys = new Set<string>()

    if (entity === 'app_settings' && sourceRows.length > 0 && destinationRows.length > 0) {
      const sourceRow = sourceRows[0]
      const destinationRow = destinationRows[0]
      const kind: ConflictKind = 'uuid-collision'
      const message = 'Destination singleton exists; resolve whose field values survive.'
      unresolved.push({
        entity,
        sourceId: primaryKeyOf(entity, sourceRow),
        destinationId: primaryKeyOf(entity, destinationRow),
        kind,
        message,
        allowedActions: ['update', 'map', 'exclude'],
        evidence: ['single-row'],
      })
      entries.push({
        entity,
        sourceId: primaryKeyOf(entity, sourceRow),
        destinationId: primaryKeyOf(entity, destinationRow),
        action: 'update',
        status: 'unresolved',
        evidence: ['single-row'],
        detail: message,
      })
      entityCounts.unresolved += 1
      claimedDestinationKeys.add(primaryKeyOf(entity, destinationRow))
    } else {
      const matches = matchRecords({
        entity,
        sourceRows,
        destinationRows,
        aliases: context.provenance,
        destinationNamespace: context.target.namespace,
      })
      for (const match of matches) {
        if (match.status === 'confirmed' && match.destinationId) {
          const destinationRow = destinationRows.find((row) => primaryKeyOf(entity, row) === match.destinationId)
          const sourceRow = sourceRows.find((row) => primaryKeyOf(entity, row) === match.sourceId)
          if (
            destinationRow &&
            sourceRow &&
            entity !== ACCOUNT_ENTITY &&
            rowsDifferIgnoringReferences(entity, sourceRow, destinationRow)
          ) {
            const message =
              'This record was imported by a prior run but now differs on one side; confirm retain, field update or exclusion.'
            unresolved.push({
              entity,
              sourceId: match.sourceId,
              destinationId: match.destinationId,
              kind: 'changed-record',
              message,
              allowedActions: conflictActions('changed-record'),
              evidence: match.evidence,
            })
            entries.push({
              entity,
              sourceId: match.sourceId,
              destinationId: match.destinationId,
              action: 'map',
              status: 'unresolved',
              evidence: match.evidence,
              detail: message,
            })
            entityCounts.unresolved += 1
          } else {
            entries.push({
              entity,
              sourceId: match.sourceId,
              destinationId: match.destinationId,
              action: 'map',
              status: 'proposed',
              evidence: match.evidence,
              detail: match.detail,
            })
            entityCounts.map += 1
          }
          claimedDestinationKeys.add(match.destinationId)
          continue
        }
        if (match.status === 'none') {
          entries.push({
            entity,
            sourceId: match.sourceId,
            destinationId: null,
            action: 'create',
            status: 'proposed',
            evidence: match.evidence,
            detail: match.detail,
          })
          entityCounts.create += 1
          continue
        }
        const kind = conflictFor(entity, match)
        unresolved.push({
          entity,
          sourceId: match.sourceId,
          destinationId: match.destinationId,
          kind,
          message: match.detail ?? 'A destination record may correspond to this source record.',
          allowedActions: conflictActions(kind),
          evidence: match.evidence,
        })
        entries.push({
          entity,
          sourceId: match.sourceId,
          destinationId: match.destinationId,
          action: 'map',
          status: 'unresolved',
          evidence: match.evidence,
          detail: match.detail,
        })
        entityCounts.unresolved += 1
        if (match.destinationId) claimedDestinationKeys.add(match.destinationId)
      }
    }

    // Only one app_settings row can exist in the merged result; extra source
    // rows are explicit exclusions rather than a silent bundle error.
    if (entity === 'app_settings' && sourceRows.length > 1) {
      for (const extra of sourceRows.slice(1)) {
        const message = 'The bundle contains more than one app_settings row; only the singleton is supported.'
        unresolved.push({
          entity,
          sourceId: primaryKeyOf(entity, extra),
          destinationId: null,
          kind: 'uuid-collision',
          message,
          allowedActions: ['exclude'],
          evidence: [],
        })
        entries.push({
          entity,
          sourceId: primaryKeyOf(entity, extra),
          destinationId: null,
          action: 'exclude',
          status: 'unresolved',
          evidence: [],
          detail: message,
        })
        entityCounts.unresolved += 1
      }
    }

    for (const row of destinationRows) {
      const key = primaryKeyOf(entity, row)
      if (claimedDestinationKeys.has(key)) continue
      entries.push({
        entity,
        sourceId: null,
        destinationId: key,
        action: 'retain',
        status: 'proposed',
        evidence: [],
        detail: null,
      })
      entityCounts.retain += 1
    }

    counts[entity] = entityCounts
  }

  const planWithoutDigest = {
    format: MERGE_PLAN_FORMAT as typeof MERGE_PLAN_FORMAT,
    formatVersion: MERGE_PLAN_FORMAT_VERSION as typeof MERGE_PLAN_FORMAT_VERSION,
    runId: options.runId,
    bundleId: context.manifest.bundleId,
    bundleDigest: bundleDigestOf(context.manifest),
    sourceInstance: context.manifest.source,
    target: targetDescriptor(context),
    matchingRulesVersion: MATCHING_RULES_VERSION,
    createdAt: options.createdAt,
    counts,
    unresolved,
    entries,
    snapshot: {
      sourceRows: context.sourceRows,
      targetRows: context.target.rows,
      identities: context.target.identities,
    },
    expectedResultDigest: null,
  }
  return { ...planWithoutDigest, planDigest: sha256Hex(canonicalStringify(planWithoutDigest)) }
}

/**
 * A reviewed plan is only reusable while the destination is unchanged. The
 * comparison covers the full snapshot, the live schema fingerprint and, when
 * the caller knows it, the declared application release.
 */
export function assertPlanFresh(
  plan: MergePlan,
  currentSnapshot: DeploymentSnapshot,
  current: { schemaFingerprint?: string; applicationVersion?: string } = {}
): void {
  const drift: string[] = []
  const snapshotDigest = deploymentSnapshotDigest(currentSnapshot)
  if (snapshotDigest !== plan.target.snapshotDigest) {
    drift.push(`snapshot ${snapshotDigest.slice(0, 12)} != ${plan.target.snapshotDigest.slice(0, 12)}`)
  }
  if (current.schemaFingerprint && current.schemaFingerprint !== plan.target.schemaFingerprint) {
    drift.push(`schema fingerprint ${current.schemaFingerprint.slice(0, 12)} != ${plan.target.schemaFingerprint.slice(0, 12)}`)
  }
  if (current.applicationVersion && current.applicationVersion !== plan.target.applicationVersion) {
    drift.push(`application version ${current.applicationVersion} != ${plan.target.applicationVersion}`)
  }
  if (drift.length > 0) {
    throw new MigrationRunError(
      'E_STALE_PLAN',
      `The destination changed since this plan was reviewed (${drift.join('; ')}). Regenerate and re-review the plan.`
    )
  }
}

export function entityDigest(entity: MigrationEntity, rows: CanonicalRow[]): string {
  const lines = rows.map((row) => canonicalStringify(row))
  lines.sort()
  return sha256Hex(`${entity}\n${lines.join('\n')}`)
}

export function perEntityDigests(rows: Record<MigrationEntity, CanonicalRow[]>): Record<MigrationEntity, string> {
  const digests = {} as Record<MigrationEntity, string>
  for (const entity of ENTITY_ORDER) digests[entity] = entityDigest(entity, rows[entity])
  return digests
}

export function expectedResultDigest(expected: Pick<ExpectedResult, 'perEntityDigest'>): string {
  const lines = ENTITY_ORDER.map((entity) => `${entity}:${expected.perEntityDigest[entity]}`)
  return sha256Hex(lines.join('\n'))
}

export function entryKey(entity: MigrationEntity, sourceId: string): string {
  return `${entity}\u0000${sourceId}`
}

export function applyDecisions(
  context: ResolutionContext,
  plan: MergePlan,
  decisions: DecisionInput,
  options: { allocatedId?: () => string } = {}
): DecisionApplication {
  const issues: MergeIssue[] = []
  const allocate = options.allocatedId ?? (() => randomUUID())

  const unresolvedByKey = new Map(plan.unresolved.map((conflict) => [entryKey(conflict.entity, conflict.sourceId), conflict]))
  const entriesByKey = new Map<string, PreviewEntry>()
  for (const entry of plan.entries) {
    if (entry.sourceId !== null) entriesByKey.set(entryKey(entry.entity, entry.sourceId), entry)
  }

  const decisionsByKey = new Map<string, RecordDecision>()
  for (const decision of decisions.records) {
    const key = entryKey(decision.entity, decision.sourceId)
    if (!entriesByKey.has(key)) {
      issues.push({
        code: 'E_DECISION_UNKNOWN_RECORD',
        entity: decision.entity,
        sourceId: decision.sourceId,
        message: 'Decision does not correspond to any source record in the reviewed plan.',
      })
      continue
    }
    if (decisionsByKey.has(key)) {
      issues.push({
        code: 'E_DECISION_DUPLICATE',
        entity: decision.entity,
        sourceId: decision.sourceId,
        message: 'More than one decision was supplied for the same source record.',
      })
      continue
    }
    decisionsByKey.set(key, decision)
  }

  for (const conflict of plan.unresolved) {
    if (!decisionsByKey.has(entryKey(conflict.entity, conflict.sourceId))) {
      issues.push({
        code: 'E_DECISION_MISSING',
        entity: conflict.entity,
        sourceId: conflict.sourceId,
        message: `Unresolved ${conflict.kind} requires an explicit decision (allowed: ${conflict.allowedActions.join(', ')}).`,
      })
    }
  }

  // A plan whose unresolved list does not describe its own unresolved entries
  // (tampered or written by another tool) must not resolve silently.
  for (const entry of plan.entries) {
    if (entry.status !== 'unresolved' || entry.sourceId === null) continue
    if (!unresolvedByKey.has(entryKey(entry.entity, entry.sourceId))) {
      issues.push({
        code: 'E_CONFLICT_MISSING',
        entity: entry.entity,
        sourceId: entry.sourceId,
        message: 'The plan marks this entry unresolved but records no conflict for it; regenerate the plan.',
      })
    }
  }

  const resolvedEntries: PreviewEntry[] = []
  const fieldsByKey = new Map<string, Record<string, 'source' | 'destination'>>()
  for (const entry of plan.entries) {
    if (entry.sourceId === null) {
      resolvedEntries.push({ ...entry, status: 'resolved' })
      continue
    }
    const key = entryKey(entry.entity, entry.sourceId)
    const decision = decisionsByKey.get(key)
    const conflict = unresolvedByKey.get(key)
    const action: PlanAction = decision ? decision.action : entry.action
    // A proposal is the safe default; an operator may still exclude a proposed
    // create (for example because its parent was excluded) or send a confirmed
    // mapping back for review as an update/exclusion.
    const allowed: SourceAction[] = conflict
      ? conflict.allowedActions
      : entry.action === 'create'
        ? ['create', 'exclude']
        : ['map', 'update', 'exclude']

    if (decision) {
      if (!allowed.includes(decision.action)) {
        issues.push({
          code: 'E_DECISION_NOT_ALLOWED',
          entity: entry.entity,
          sourceId: entry.sourceId,
          message: `Action "${decision.action}" is not allowed here (allowed: ${allowed.join(', ')}).`,
        })
      }
      if (decision.action !== entry.action && decision.action !== 'exclude' && !decision.reason) {
        issues.push({
          code: 'E_DECISION_REASON_REQUIRED',
          entity: entry.entity,
          sourceId: entry.sourceId,
          message: `Choosing "${decision.action}" instead of the proposed "${entry.action}" requires a recorded reason.`,
        })
      }
      if (decision.action === 'exclude' && !decision.reason) {
        issues.push({
          code: 'E_DECISION_REASON_REQUIRED',
          entity: entry.entity,
          sourceId: entry.sourceId,
          message: 'An exclusion requires a recorded reason.',
        })
      }
      if (decision.fields) {
        const fields = decision.fields
        const allowedFields = ALLOWED_MERGE_FIELDS[entry.entity] ?? []
        if (Object.keys(fields).length === 0) {
          issues.push({
            code: 'E_DECISION_FIELDS_EMPTY',
            entity: entry.entity,
            sourceId: entry.sourceId,
            message: 'A field-level decision must name at least one field.',
          })
        }
        for (const field of Object.keys(fields)) {
          if (!allowedFields.includes(field)) {
            issues.push({
              code: 'E_DECISION_FIELD_PROTECTED',
              entity: entry.entity,
              sourceId: entry.sourceId,
              message: `Field "${field}" cannot be set through a field-level decision.`,
            })
          }
        }
        if (decision.action !== 'update' && decision.action !== 'map') {
          issues.push({
            code: 'E_DECISION_FIELDS_ACTION',
            entity: entry.entity,
            sourceId: entry.sourceId,
            message: 'Field-level decisions are only valid for update or map actions.',
          })
        }
        fieldsByKey.set(key, fields)
      }
      if (decision.action === 'map' && !decision.destinationId && !entry.destinationId) {
        issues.push({
          code: 'E_MAPPING_TARGET_MISSING',
          entity: entry.entity,
          sourceId: entry.sourceId,
          message: 'A map decision needs a destination id.',
        })
      }
    }

    resolvedEntries.push({
      ...entry,
      action,
      status: 'resolved',
      destinationId: decision?.destinationId ?? entry.destinationId,
    })
  }

  for (const decision of decisions.security) {
    const securityFields = SECURITY_FIELDS[decision.entity]
    if (!securityFields || !securityFields.includes(decision.field)) {
      issues.push({
        code: 'E_SECURITY_FIELD_PROTECTED',
        entity: decision.entity,
        sourceId: decision.sourceId,
        message: `Field "${decision.field}" is not a resolvable security field for ${decision.entity}.`,
      })
    }
    if (!decision.reason) {
      issues.push({
        code: 'E_SECURITY_REASON_REQUIRED',
        entity: decision.entity,
        sourceId: decision.sourceId,
        message: 'A security-field decision requires a recorded reason.',
      })
    }
    if (decisions.records.some((record) => entryKey(record.entity, record.sourceId) === entryKey(decision.entity, decision.sourceId) && record.fields?.[decision.field])) {
      issues.push({
        code: 'E_SECURITY_FIELD_CONFLICT',
        entity: decision.entity,
        sourceId: decision.sourceId,
        message: `Field "${decision.field}" cannot receive both a field-level and a security decision.`,
      })
    }
  }

  if (decisions.settings) {
    for (const field of Object.keys(decisions.settings)) {
      if (!(SETTINGS_FIELDS as readonly string[]).includes(field)) {
        issues.push({
          code: 'E_SETTINGS_FIELD_PROTECTED',
          entity: 'app_settings',
          sourceId: null,
          message: `Settings field "${field}" cannot be resolved by the operator.`,
        })
      }
    }
  }

  const materialized = materialize(context, resolvedEntries, decisionsByKey, fieldsByKey, decisions, allocate)
  issues.push(...materialized.issues)

  if (issues.length === 0) {
    issues.push(...validateMergedState(materialized.expected))
  }

  materialized.expected.perEntityDigest = perEntityDigests(materialized.expected.rows)
  materialized.expected.digest = expectedResultDigest(materialized.expected)

  return {
    entries: resolvedEntries,
    idMap: materialized.expected.idMap,
    expected: materialized.expected,
    issues,
  }
}

function materialize(
  context: ResolutionContext,
  entries: PreviewEntry[],
  decisionsByKey: Map<string, RecordDecision>,
  fieldsByKey: Map<string, Record<string, 'source' | 'destination'>>,
  decisions: DecisionInput,
  allocate: () => string
): { expected: ExpectedResult; issues: MergeIssue[] } {
  const issues: MergeIssue[] = []
  const rows = {} as Record<MigrationEntity, CanonicalRow[]>
  const idMap = {} as Record<MigrationEntity, Record<string, string>>
  const usedIds = {} as Record<MigrationEntity, Set<string>>

  for (const entity of ENTITY_ORDER) {
    rows[entity] = context.targetRows[entity].map((row) => ({ ...row }))
    usedIds[entity] = new Set(rows[entity].map((row) => String(row.id ?? primaryKeyOf(entity, row))))
    idMap[entity] = {}
  }

  const exclusions: ExpectedResult['exclusions'] = []
  const importedRows: Array<{ entity: MigrationEntity; key: string }> = []

  for (const entry of entries) {
    if (entry.sourceId === null) continue
    const entity = entry.entity
    const sourceId = entry.sourceId
    const sourceRow = context.sourceRows[entity].find((row) => primaryKeyOf(entity, row) === sourceId)
    if (!sourceRow) {
      issues.push({
        code: 'E_SOURCE_ROW_MISSING',
        entity,
        sourceId,
        message: 'The plan references a source record that is not in the bundle.',
      })
      continue
    }
    const decision = decisionsByKey.get(entryKey(entity, sourceId))
    const fields = fieldsByKey.get(entryKey(entity, sourceId)) ?? null

    if (entry.action === 'exclude') {
      exclusions.push({ entity, sourceId, reason: decision?.reason ?? 'excluded' })
      continue
    }

    if (entry.action === 'create') {
      const spec = entitySpec(entity)
      const singleIdPk = spec.primaryKey.length === 1 && spec.primaryKey[0] === 'id'
      let destinationId = sourceId
      if (!singleIdPk) destinationId = sourceId
      else if (usedIds[entity].has(destinationId) || Object.values(idMap[entity]).includes(destinationId)) {
        destinationId = allocate()
      }
      idMap[entity][sourceId] = destinationId
      const row: CanonicalRow = { ...sourceRow }
      if (singleIdPk) {
        row.id = destinationId
        usedIds[entity].add(destinationId)
      }
      rows[entity].push(row)
      importedRows.push({ entity, key: primaryKeyOf(entity, row) })
      continue
    }

    const destinationId = entry.destinationId ?? decision?.destinationId ?? null
    if (!destinationId) {
      issues.push({
        code: 'E_MAPPING_TARGET_MISSING',
        entity,
        sourceId,
        message: 'A map/update decision needs an existing destination row.',
      })
      continue
    }
    const destinationRow = rows[entity].find((row) => String(row.id) === destinationId || primaryKeyOf(entity, row) === destinationId)
    if (!destinationRow) {
      issues.push({
        code: 'E_MAPPING_TARGET_MISSING',
        entity,
        sourceId,
        message: `Destination row ${destinationId} does not exist.`,
      })
      continue
    }
    idMap[entity][sourceId] = destinationId
    if (fields) {
      for (const [field, side] of Object.entries(fields)) {
        if (side === 'source') destinationRow[field] = sourceRow[field]
      }
      importedRows.push({ entity, key: primaryKeyOf(entity, destinationRow) })
    } else if (entry.action === 'update' && entity !== 'app_settings') {
      issues.push({
        code: 'E_UPDATE_WITHOUT_FIELDS',
        entity,
        sourceId,
        message: 'An update decision must name the fields the source value should win.',
      })
    }
  }

  // Foreign keys of imported rows are rewritten through the reviewed id map.
  for (const imported of importedRows) {
    const spec = entitySpec(imported.entity)
    const row = rows[imported.entity].find((item) => primaryKeyOf(imported.entity, item) === imported.key)
    if (!row) continue
    for (const column of spec.columns.filter((item) => item.references)) {
      const value = row[column.name]
      if (value === null) continue
      const referenced = column.references?.entity as MigrationEntity
      const mapped = idMap[referenced][String(value)]
      if (mapped) {
        row[column.name] = mapped
        continue
      }
      const isSourceValue = context.sourceRows[referenced].some((parent) => String(parent.id) === String(value))
      if (isSourceValue) {
        issues.push({
          code: 'E_DEPENDENT_ORPHAN',
          entity: imported.entity,
          sourceId: imported.key,
          message: `${imported.entity}.${column.name} references source ${referenced} ${String(value)}, which has no approved mapping (excluded or undecided).`,
        })
      }
    }
  }

  // Excluded parents must not silently orphan their dependents.
  for (const exclusion of exclusions) {
    for (const entity of ENTITY_ORDER) {
      for (const column of entitySpec(entity).columns.filter((item) => item.references?.entity === exclusion.entity)) {
        for (const row of context.sourceRows[entity]) {
          if (String(row[column.name]) !== exclusion.sourceId) continue
          const key = entryKey(entity, primaryKeyOf(entity, row))
          const decision = decisionsByKey.get(key)
          const fields = fieldsByKey.get(key)
          const entry = entries.find((item) => item.entity === entity && item.sourceId === primaryKeyOf(entity, row))
          if (!entry) continue
          if (entry.action === 'exclude') continue
          if (entry.action === 'map') continue
          if (fields?.[column.name] === 'destination') continue
          if (decision?.action === 'update' && fields?.[column.name] === 'source') {
            issues.push({
              code: 'E_EXCLUDED_PARENT_DEPENDENT',
              entity,
              sourceId: primaryKeyOf(entity, row),
              message: `Field "${column.name}" still points at the excluded ${exclusion.entity} ${exclusion.sourceId}.`,
            })
            continue
          }
          issues.push({
            code: 'E_EXCLUDED_PARENT_DEPENDENT',
            entity,
            sourceId: primaryKeyOf(entity, row),
            message: `${entity}.${column.name} depends on the excluded ${exclusion.entity} ${exclusion.sourceId}; give the dependent row an explicit disposition.`,
          })
        }
      }
    }
  }

  for (const decision of decisions.security) {
    const destinationId = idMap[decision.entity][decision.sourceId]
    const target = destinationId
      ? rows[decision.entity].find((row) => String(row.id) === destinationId || primaryKeyOf(decision.entity, row) === destinationId)
      : undefined
    if (!target) {
      issues.push({
        code: 'E_SECURITY_TARGET_MISSING',
        entity: decision.entity,
        sourceId: decision.sourceId,
        message: 'Security decisions require a mapped or created record.',
      })
      continue
    }
    let value = decision.value
    if (decision.field === 'manager_id' && typeof value === 'string') {
      value = idMap.profiles[value] ?? value
    }
    target[decision.field] = value as CanonicalRow[string]
  }

  if (decisions.settings) {
    const sourceRow = context.sourceRows.app_settings[0]
    const target = rows.app_settings[0]
    if (sourceRow && target) {
      for (const [field, side] of Object.entries(decisions.settings)) {
        if (side === 'source') target[field] = sourceRow[field]
      }
    }
  }

  const expected: ExpectedResult = {
    rows,
    idMap,
    exclusions,
    perEntityDigest: perEntityDigests(rows),
    digest: '',
  }
  return { expected, issues }
}

export function validateMergedState(expected: ExpectedResult): MergeIssue[] {
  const issues: MergeIssue[] = []
  const rows = expected.rows

  const uniqueExact: Array<[MigrationEntity, string]> = [
    ['projects', 'name'],
    ['activity_types', 'name'],
    ['titles', 'name'],
    ['whitelisted_domains', 'domain'],
  ]
  for (const [entity, field] of uniqueExact) {
    const seen = new Map<string, string>()
    for (const row of rows[entity]) {
      const value = row[field]
      if (typeof value !== 'string') continue
      const existing = seen.get(value)
      if (existing) {
        issues.push({
          code: 'E_UNIQUE_VIOLATION',
          entity,
          sourceId: String(row.id),
          message: `${entity}.${field} "${value}" is duplicated with ${existing} in the merged result.`,
        })
      }
      seen.set(value, String(row.id))
    }
  }

  // Native enforces lower(name) uniqueness on titles; a case-different pair
  // would fail the destination import, so it is reported rather than repaired.
  const titleNames = new Map<string, string>()
  for (const row of rows.titles) {
    if (typeof row.name !== 'string') continue
    const key = row.name.toLowerCase()
    const existing = titleNames.get(key)
    if (existing) {
      issues.push({
        code: 'E_UNIQUE_VIOLATION',
        entity: 'titles',
        sourceId: String(row.id),
        message: `titles.name "${row.name}" collides case-insensitively with ${existing} (native enforces lower(name) uniqueness).`,
      })
    }
    titleNames.set(key, String(row.id))
  }

  // telegram_no is unique where not null on both providers.
  for (const entity of ['projects', 'activity_types'] as const) {
    const seen = new Map<number, string>()
    for (const row of rows[entity]) {
      const value = row.telegram_no
      if (typeof value !== 'number') continue
      const existing = seen.get(value)
      if (existing) {
        issues.push({
          code: 'E_UNIQUE_VIOLATION',
          entity,
          sourceId: String(row.id),
          message: `${entity}.telegram_no ${value} is duplicated with ${existing} in the merged result.`,
        })
      }
      seen.set(value, String(row.id))
    }
  }

  const emailSeen = new Map<string, string>()
  for (const row of rows.profiles) {
    if (typeof row.email !== 'string') continue
    const key = row.email.trim().toLowerCase()
    const existing = emailSeen.get(key)
    if (existing) {
      issues.push({
        code: 'E_EMAIL_COLLISION',
        entity: 'profiles',
        sourceId: String(row.id),
        message: `Normalized email "${key}" appears more than once (also ${existing}) in the merged result.`,
      })
    }
    emailSeen.set(key, String(row.id))
  }

  const leaveSeen = new Set<string>()
  for (const row of rows.leaves) {
    const key = `${String(row.user_id)}\u0000${String(row.leave_date)}`
    if (leaveSeen.has(key)) {
      issues.push({
        code: 'E_LEAVE_DUPLICATE',
        entity: 'leaves',
        sourceId: String(row.id),
        message: `Merged result has two leave rows for the same user and date (${String(row.leave_date)}).`,
      })
    }
    leaveSeen.add(key)
  }

  const hoursByUserDate = new Map<string, number>()
  for (const row of rows.timesheets) {
    const hours = Number(row.hours_worked)
    if (!Number.isFinite(hours) || hours <= 0 || hours > 24) {
      issues.push({
        code: 'E_HOURS_RANGE',
        entity: 'timesheets',
        sourceId: String(row.id),
        message: `hours_worked ${String(row.hours_worked)} is outside the allowed (0, 24] range.`,
      })
    }
    const key = `${String(row.user_id)}\u0000${String(row.log_date)}`
    hoursByUserDate.set(key, (hoursByUserDate.get(key) ?? 0) + (Number.isFinite(hours) ? hours : 0))
  }
  for (const [key, total] of hoursByUserDate) {
    if (total > 24) {
      const [userId, logDate] = key.split('\u0000')
      issues.push({
        code: 'E_DAILY_HOURS_CAP',
        entity: 'timesheets',
        sourceId: userId,
        message: `Merged total for user ${userId} on ${logDate} is ${total} hours, above the 24-hour daily cap.`,
      })
    }
  }

  const permissionRoles = new Set(['admin', 'pm', 'co', 'user'])
  const hierarchyRoles = new Set(['manager', 'team_lead', 'engineer', 'user'])
  const profileIds = new Set(rows.profiles.map((row) => String(row.id)))
  const managerOf = new Map<string, string | null>()
  for (const row of rows.profiles) {
    if (typeof row.permission_role === 'string' && !permissionRoles.has(row.permission_role)) {
      issues.push({
        code: 'E_ROLE_INVALID',
        entity: 'profiles',
        sourceId: String(row.id),
        message: `permission_role "${row.permission_role}" is not a valid role.`,
      })
    }
    if (typeof row.hierarchy_role === 'string' && !hierarchyRoles.has(row.hierarchy_role)) {
      issues.push({
        code: 'E_ROLE_INVALID',
        entity: 'profiles',
        sourceId: String(row.id),
        message: `hierarchy_role "${row.hierarchy_role}" is not a valid role.`,
      })
    }
    const managerId = row.manager_id === null || row.manager_id === undefined ? null : String(row.manager_id)
    if (managerId !== null && !profileIds.has(managerId)) {
      issues.push({
        code: 'E_MANAGER_MISSING',
        entity: 'profiles',
        sourceId: String(row.id),
        message: `manager_id ${managerId} does not exist in the merged result.`,
      })
    }
    managerOf.set(String(row.id), managerId)
  }
  for (const [profileId] of managerOf) {
    const seen = new Set<string>([profileId])
    let current = managerOf.get(profileId) ?? null
    while (current) {
      if (seen.has(current)) {
        issues.push({
          code: 'E_MANAGER_CYCLE',
          entity: 'profiles',
          sourceId: profileId,
          message: 'manager_id chain contains a cycle in the merged result.',
        })
        break
      }
      seen.add(current)
      current = managerOf.get(current) ?? null
    }
  }

  if (rows.app_settings.length > 1) {
    issues.push({
      code: 'E_SETTINGS_SINGLETON',
      entity: 'app_settings',
      sourceId: null,
      message: 'The merged result would contain more than one app_settings row.',
    })
  }
  for (const row of rows.app_settings) {
    if (Number(row.id) !== 1) {
      issues.push({
        code: 'E_SETTINGS_SINGLETON',
        entity: 'app_settings',
        sourceId: String(row.id),
        message: 'app_settings.id must be the singleton value 1.',
      })
    }
  }

  const idSets = {} as Record<MigrationEntity, Set<string>>
  for (const entity of ENTITY_ORDER) idSets[entity] = new Set(rows[entity].map((row) => String(row.id)))
  for (const entity of ENTITY_ORDER) {
    for (const column of entitySpec(entity).columns) {
      if (!column.references) continue
      for (const row of rows[entity]) {
        const value = row[column.name]
        if (value === null || value === undefined) continue
        if (!idSets[column.references.entity].has(String(value))) {
          issues.push({
            code: 'E_FK_ORPHAN',
            entity,
            sourceId: String(row.id),
            message: `${entity}.${column.name} references ${column.references.entity} ${String(value)}, which is missing from the merged result.`,
          })
        }
      }
    }
  }

  for (const row of rows.titles) {
    if (typeof row.hierarchy_role === 'string' && !hierarchyRoles.has(row.hierarchy_role)) {
      issues.push({
        code: 'E_ROLE_INVALID',
        entity: 'titles',
        sourceId: String(row.id),
        message: `titles.hierarchy_role "${row.hierarchy_role}" is not valid.`,
      })
    }
  }

  return issues
}

export function resolutionDigest(input: {
  planDigest: string
  decisions: unknown
  expectedResultDigest: string
  idMap: Record<MigrationEntity, Record<string, string>>
}): string {
  return sha256Hex(
    canonicalStringify({
      planDigest: input.planDigest,
      decisions: input.decisions,
      expectedResultDigest: input.expectedResultDigest,
      idMap: input.idMap,
    })
  )
}

export function summarize(plan: MergePlan): string {
  return ENTITY_ORDER.map((entity) => {
    const counts = plan.counts[entity]
    return `${entity}: create=${counts.create} update=${counts.update} retain=${counts.retain} map=${counts.map} exclude=${counts.exclude} unresolved=${counts.unresolved}`
  }).join('\n')
}
