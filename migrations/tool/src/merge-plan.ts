// migrations/tool/src/merge-plan.ts
// Reviewed merge planning against a populated destination.
//
// buildPreview() turns a validated bundle plus a read-only destination snapshot
// into a complete, inspectable plan: every source record becomes create, update,
// map, exclude or an explicit unresolved conflict, and every destination-only
// record is retained. applyDecisions() turns an operator decision file into the
// exact expected merged state, which is validated against the application's
// real invariants (unique keys, foreign keys, hierarchy cycles, daily hour caps,
// singleton rows) before anything is allowed to write.

import {
  ENTITY_ORDER,
  MigrationFormatError,
  UUID_RE,
  bundleDigestOf,
  canonicalStringify,
  canonicalizeRow,
  entitySpec,
  primaryKeyOf,
  sha256Hex,
  type BundleManifest,
  type CanonicalRow,
  type IdentityFact,
  type MigrationEntity,
  type ProviderName,
  type ProvenanceAlias,
  type RetryHistoryFact,
  type SourceInstanceDescriptor,
} from './format'
import { MigrationRunError } from './journal'
import {
  MATCHING_RULES_VERSION,
  matchRecords,
  normalizeEmail,
  type DestinationProvenanceReceipt,
  type MatchEvidence,
} from './matching'
import type { DeploymentSnapshot, IdentityRecord } from './providers/read'

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

export interface PreviewRelationship {
  entity: MigrationEntity
  sourceId: string
  field: string
  referencedEntity: MigrationEntity
  sourceValue: string
  proposedDestinationId: string | null
}

/** Read-only consequences included in the operator-facing preview artifact. */
export interface PreviewImpact {
  affectedUsers: string[]
  relationships: PreviewRelationship[]
  totals: {
    sourceRows: number
    destinationRows: number
    sourceTimesheetHours: string
    destinationTimesheetHours: string
    /** Null until every mapping/exclusion that can affect the union is resolved. */
    projectedTimesheetHours: string | null
  }
}

/**
 * Every conflict kind in one place: `ConflictKind` and the resolution artifact
 * schema both derive from this tuple, so a kind the planner can emit cannot be
 * missing from the document an operator has to resolve.
 */
export const CONFLICT_KINDS = [
  'account-candidate',
  'account-collision',
  'uuid-collision',
  'reference-candidate',
  'changed-record',
  'stale-provenance',
  'destination-claimed',
] as const

export type ConflictKind = (typeof CONFLICT_KINDS)[number]

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
  /** Destination identity facts (matching and drift), never source assurance. */
  identities: DeploymentSnapshot['identities']
  /** Source account assurance facts captured in the bundle. */
  sourceIdentities: IdentityFact[]
  /** Normalized, namespaced committed/uncertain mobile retry outcomes. */
  retryHistory: RetryHistoryFact[]
  /** False only for an older bundle that omitted the required artifact. */
  retryHistoryCaptured: boolean
  receipts: DestinationProvenanceReceipt[]
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
  impact: PreviewImpact
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
  /** Explicit stable id for a newly created single-id row. */
  allocatedId?: string
  fields?: Record<string, 'source' | 'destination'>
  /** Reviewed literal overrides used only for unique values on create. */
  overrides?: Record<string, string | number | boolean | null>
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
  /**
   * Source account assurance facts captured in the bundle. They are never
   * matched against destination accounts; they exist so the reviewed identity
   * disposition can see OAuth sign-ins and second factors before provisioning.
   */
  sourceIdentities?: IdentityFact[]
  sourceRetryHistory?: RetryHistoryFact[]
  retryHistoryCaptured?: boolean
  target: DeploymentSnapshot
  trustedReceipts?: DestinationProvenanceReceipt[]
  targetApplicationVersion: string
  targetSchemaFingerprint: string
}

/** Everything `resolve` needs, taken from the plan's own bound snapshot. */
export interface ResolutionContext {
  sourceRows: Record<MigrationEntity, CanonicalRow[]>
  targetRows: Record<MigrationEntity, CanonicalRow[]>
  targetIdentities: IdentityRecord[]
  /** Destination provider, used for provider-specific merged-state constraints. */
  targetProvider?: ProviderName
}

export function resolutionContextOf(plan: MergePlan): ResolutionContext {
  return {
    sourceRows: plan.snapshot.sourceRows,
    targetRows: plan.snapshot.targetRows,
    targetIdentities: plan.snapshot.identities,
    targetProvider: plan.target.provider,
  }
}

// Fields an operator may resolve per record. Credentials, identity ownership,
// role axes, activation, manager links and verification facts are deliberately
// absent: they are only reachable through a security decision with a reason.
export const ALLOWED_MERGE_FIELDS: Record<MigrationEntity, string[]> = {
  titles: ['name'],
  whitelisted_domains: [],
  projects: ['name', 'so_number', 'telegram_no', 'is_timesheet_project'],
  activity_types: ['name', 'is_active', 'telegram_no'],
  app_settings: [],
  profiles: ['name', 'department', 'title', 'dashboard_layout', 'admin_layout', 'mobile_layout'],
  global_reminders: ['message', 'remind_at'],
  timesheets: ['project_id', 'activity_type_id', 'entry_type', 'activity_code', 'activity_other', 'ticket_number', 'log_date', 'hours_worked', 'work_done'],
  leaves: ['leave_date', 'reason'],
  reminders: ['message', 'remind_at', 'done'],
  global_reminder_dismissals: ['dismissed_at'],
  audit_logs: [],
}

const ALLOWED_CREATE_OVERRIDES: Partial<Record<MigrationEntity, readonly string[]>> = {
  projects: ['name'],
  activity_types: ['name'],
  titles: ['name'],
  whitelisted_domains: ['domain'],
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

/**
 * Digest over every destination row and identity: later drift invalidates a
 * plan. Sign-in providers and registered second factors are part of the digest:
 * an account gaining an OAuth identity or an MFA factor after review must not
 * pass the stale-plan check.
 */
export function deploymentSnapshotDigest(snapshot: DeploymentSnapshot): string {
  const lines: string[] = []
  for (const entity of ENTITY_ORDER) {
    for (const row of snapshot.rows[entity]) lines.push(`row:${entity}:${canonicalStringify(row)}`)
  }
  for (const identity of snapshot.identities) {
    const providers = identity.providerIdentities
    const mfaFactors = identity.mfaFactors
    lines.push(
      [
        'identity',
        identity.id,
        identity.email ?? '',
        String(identity.emailConfirmed),
        String(identity.hasCredential),
        providers == null ? 'providers:none' : `providers:${[...providers].sort().join(',')}`,
        mfaFactors == null ? 'mfa:none' : `mfa:${mfaFactors}`,
      ].join(':')
    )
  }
  for (const receipt of snapshot.receipts ?? []) {
    lines.push(
      `receipt:${receipt.kind}:${receipt.sourceNamespace}:${receipt.targetNamespace}:${receipt.entity}:${receipt.sourceId}:${receipt.destinationId}:${receipt.runId}:${receipt.state}`
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
    // The destination row is already claimed by another source record. The
    // only safe disposition is an explicit exclusion; if the operator believes
    // a different destination row is the right match, the plan must be
    // regenerated rather than retargeted silently.
    case 'destination-claimed':
      return ['exclude']
  }
}

function identityConflictFor(
  sourceRow: CanonicalRow,
  destinationRows: CanonicalRow[],
  identities: IdentityRecord[]
): { destinationId: string; message: string; allowedActions: SourceAction[] } | null {
  const sourceId = String(sourceRow.id)
  const sourceEmail = typeof sourceRow.email === 'string' ? normalizeEmail(sourceRow.email) : ''
  if (!sourceEmail) return null

  const destinationProfileIds = new Set(destinationRows.map((row) => String(row.id)))
  const orphanOwners = identities.filter(
    (identity) =>
      !destinationProfileIds.has(identity.id) &&
      typeof identity.email === 'string' &&
      normalizeEmail(identity.email) === sourceEmail
  )
  const sameId = identities.find((identity) => identity.id === sourceId)
  if (sameId && (typeof sameId.email !== 'string' || normalizeEmail(sameId.email) !== sourceEmail)) {
    return {
      destinationId: sameId.id,
      message: `Destination Auth identity ${sameId.id} owns a different email; creating this profile would change existing identity ownership.`,
      allowedActions: ['exclude'],
    }
  }
  if (orphanOwners.length === 0) return null

  const owner = orphanOwners[0]
  return {
    destinationId: owner.id,
    message: `Destination Auth identity ${owner.id} already owns normalized email "${sourceEmail}" but has no profile row; explicitly adopt that identity or exclude this source account.`,
    allowedActions: orphanOwners.length === 1 ? ['map', 'exclude'] : ['exclude'],
  }
}

/**
 * Exact decimal decomposition. Digits stay a BigInt: plan §3 forbids passing
 * PostgreSQL decimals through lossy JavaScript numbers, and float conversion
 * here would silently corrupt totals and digests for large or high-scale text.
 */
function decimalParts(value: string): { negative: boolean; digits: bigint; scale: number } | null {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value)
  if (!match) return null
  return {
    negative: match[1] === '-',
    digits: BigInt(`${match[2]}${match[3] ?? ''}`),
    scale: (match[3] ?? '').length,
  }
}

function addDecimal(left: string, right: string): string {
  const a = decimalParts(left)
  const b = decimalParts(right)
  if (!a || !b) return '0'
  const scale = Math.max(a.scale, b.scale)
  const total =
    (a.negative ? -1n : 1n) * a.digits * 10n ** BigInt(scale - a.scale) +
    (b.negative ? -1n : 1n) * b.digits * 10n ** BigInt(scale - b.scale)
  if (total === 0n) return '0'
  const negative = total < 0n
  const raw = String(negative ? -total : total).padStart(scale + 1, '0')
  const integer = scale > 0 ? raw.slice(0, -scale) : raw
  const fraction = scale > 0 ? raw.slice(-scale).replace(/0+$/, '') : ''
  return `${negative ? '-' : ''}${integer}${fraction ? `.${fraction}` : ''}`
}

/** Fixed-point scale used for hour comparisons; well above numeric(4,2). */
const HOURS_SCALE = 6
const HOURS_MAX_SCALED = 24n * 10n ** BigInt(HOURS_SCALE)

/** Exact fixed-point value of a decimal text, or null when out of supported scale. */
function hoursScaled(value: string): bigint | null {
  const parts = decimalParts(value)
  if (!parts || parts.scale > HOURS_SCALE) return null
  const scaled = parts.digits * 10n ** BigInt(HOURS_SCALE - parts.scale)
  return parts.negative ? -scaled : scaled
}

function scaledToDecimalText(value: bigint, scale: number): string {
  const negative = value < 0n
  const raw = String(negative ? -value : value).padStart(scale + 1, '0')
  const integer = scale > 0 ? raw.slice(0, -scale) : raw
  const fraction = scale > 0 ? raw.slice(-scale).replace(/0+$/, '') : ''
  return `${negative ? '-' : ''}${integer}${fraction ? `.${fraction}` : ''}`
}

function buildPreviewImpact(
  context: PlanningContext,
  entries: PreviewEntry[],
  unresolved: UnresolvedConflict[]
): PreviewImpact {
  const affectedUsers = new Set<string>()
  const relationships: PreviewRelationship[] = []
  const entriesByKey = new Map<string, PreviewEntry>()
  for (const entry of entries) {
    if (entry.sourceId !== null) entriesByKey.set(entryKey(entry.entity, entry.sourceId), entry)
  }

  for (const entry of entries) {
    if (entry.sourceId === null || entry.action === 'retain') continue
    const sourceRow = context.sourceRows[entry.entity].find((row) => primaryKeyOf(entry.entity, row) === entry.sourceId)
    if (!sourceRow) continue
    if (entry.entity === 'profiles') affectedUsers.add(entry.sourceId)
    if (entry.entity === 'profiles' && entry.destinationId) affectedUsers.add(entry.destinationId)
    for (const column of entitySpec(entry.entity).columns) {
      if (!column.references) continue
      const value = sourceRow[column.name]
      if (value === null || value === undefined) continue
      const sourceValue = String(value)
      if (column.references.entity === 'profiles') affectedUsers.add(sourceValue)
      const parentEntry = entriesByKey.get(entryKey(column.references.entity, sourceValue))
      if (parentEntry?.destinationId && column.references.entity === 'profiles') {
        affectedUsers.add(parentEntry.destinationId)
      }
      relationships.push({
        entity: entry.entity,
        sourceId: entry.sourceId,
        field: column.name,
        referencedEntity: column.references.entity,
        sourceValue,
        proposedDestinationId: parentEntry?.destinationId ?? null,
      })
    }
  }

  const dedupedRelationships = new Map<string, PreviewRelationship>()
  for (const relationship of relationships) {
    const key = `${relationship.entity}\u0000${relationship.sourceId}\u0000${relationship.field}`
    dedupedRelationships.set(key, relationship)
  }
  let sourceTimesheetHours = '0'
  let destinationTimesheetHours = '0'
  for (const row of context.sourceRows.timesheets) {
    if (typeof row.hours_worked === 'string') sourceTimesheetHours = addDecimal(sourceTimesheetHours, row.hours_worked)
  }
  for (const row of context.target.rows.timesheets) {
    if (typeof row.hours_worked === 'string') destinationTimesheetHours = addDecimal(destinationTimesheetHours, row.hours_worked)
  }
  let projectedTimesheetHours: string | null = null
  if (unresolved.length === 0) {
    projectedTimesheetHours = destinationTimesheetHours
    for (const entry of entries) {
      if (entry.entity !== 'timesheets' || entry.sourceId === null || entry.action !== 'create') continue
      const row = context.sourceRows.timesheets.find((item) => primaryKeyOf('timesheets', item) === entry.sourceId)
      if (typeof row?.hours_worked === 'string') projectedTimesheetHours = addDecimal(projectedTimesheetHours, row.hours_worked)
    }
  }
  return {
    affectedUsers: [...affectedUsers].sort(),
    relationships: [...dedupedRelationships.values()].sort((left, right) =>
      `${left.entity}\u0000${left.sourceId}\u0000${left.field}`.localeCompare(
        `${right.entity}\u0000${right.sourceId}\u0000${right.field}`
      )
    ),
    totals: {
      sourceRows: ENTITY_ORDER.reduce((total, entity) => total + context.sourceRows[entity].length, 0),
      destinationRows: ENTITY_ORDER.reduce((total, entity) => total + context.target.rows[entity].length, 0),
      sourceTimesheetHours,
      destinationTimesheetHours,
      projectedTimesheetHours,
    },
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
    // Destination rows already proposed for a source record. Two distinct
    // source records must never be merged into one destination row; the second
    // contender becomes an explicit conflict instead of a second mapping.
    const claimedDestinationRows = new Map<string, string>()

    const claimDestination = (destinationId: string, sourceId: string): boolean => {
      const claimedBy = claimedDestinationRows.get(destinationId)
      if (claimedBy !== undefined && claimedBy !== sourceId) return false
      claimedDestinationRows.set(destinationId, sourceId)
      return true
    }
    const emitDestinationClaimed = (entity: MigrationEntity, match: { sourceId: string; destinationId: string | null }): void => {
      const claimedBy = match.destinationId ? claimedDestinationRows.get(match.destinationId) : undefined
      const message =
        claimedBy === undefined
          ? 'A destination row is required for this record, but none is available.'
          : `Destination row ${match.destinationId} is already proposed for source record ${claimedBy}; distinct source records stay distinct — map one and exclude the other with a reason.`
      unresolved.push({
        entity,
        sourceId: match.sourceId,
        destinationId: match.destinationId,
        kind: 'destination-claimed',
        message,
        allowedActions: ['exclude'],
        evidence: ['destination-claimed'],
      })
      entries.push({
        entity,
        sourceId: match.sourceId,
        destinationId: match.destinationId,
        action: 'map',
        status: 'unresolved',
        evidence: ['destination-claimed'],
        detail: message,
      })
      entityCounts.unresolved += 1
    }

    if (entity === 'app_settings' && sourceRows.length > 0 && destinationRows.length > 0) {
      const sourceRow = sourceRows[0]
      const destinationRow = destinationRows[0]
      const sourceKey = primaryKeyOf(entity, sourceRow)
      const destinationKey = primaryKeyOf(entity, destinationRow)
      if (rowsDifferIgnoringReferences(entity, sourceRow, destinationRow)) {
        const kind: ConflictKind = 'uuid-collision'
        const message = 'Destination singleton exists; resolve whose field values survive.'
        unresolved.push({
          entity,
          sourceId: sourceKey,
          destinationId: destinationKey,
          kind,
          message,
          allowedActions: ['update', 'map', 'exclude'],
          evidence: ['single-row'],
        })
        entries.push({
          entity,
          sourceId: sourceKey,
          destinationId: destinationKey,
          action: 'update',
          status: 'unresolved',
          evidence: ['single-row'],
          detail: message,
        })
        entityCounts.unresolved += 1
        claimedDestinationRows.set(destinationKey, sourceKey)
      } else {
        // Identical singleton: the prior mapping carries over without review.
        entries.push({
          entity,
          sourceId: sourceKey,
          destinationId: destinationKey,
          action: 'map',
          status: 'proposed',
          evidence: ['single-row'],
          detail: null,
        })
        entityCounts.map += 1
        claimedDestinationRows.set(destinationKey, sourceKey)
      }
    } else {
      // Only the singleton can be matched; extra source rows are handled below
      // as explicit exclusions, never as a second create for the same record.
      const matchableSourceRows = entity === 'app_settings' ? sourceRows.slice(0, 1) : sourceRows
      const matches = matchRecords({
        entity,
        sourceRows: matchableSourceRows,
        destinationRows,
        aliases: context.provenance,
        sourceNamespace: context.manifest.source.namespace,
        destinationNamespace: context.target.namespace,
        trustedReceipts: context.trustedReceipts ?? context.target.receipts ?? [],
      })
      for (const match of matches) {
        const sourceRow = sourceRows.find((row) => primaryKeyOf(entity, row) === match.sourceId)
        if (entity === ACCOUNT_ENTITY && sourceRow) {
          const identityConflict = identityConflictFor(sourceRow, destinationRows, context.target.identities)
          if (identityConflict) {
            const evidence: MatchEvidence[] = ['normalized-email']
            if (identityConflict.destinationId && !claimDestination(identityConflict.destinationId, match.sourceId)) {
              emitDestinationClaimed(entity, match)
              continue
            }
            unresolved.push({
              entity,
              sourceId: match.sourceId,
              destinationId: identityConflict.destinationId,
              kind: 'account-collision',
              message: identityConflict.message,
              allowedActions: identityConflict.allowedActions,
              evidence,
            })
            entries.push({
              entity,
              sourceId: match.sourceId,
              destinationId: identityConflict.destinationId,
              action: identityConflict.allowedActions.includes('map') ? 'map' : 'exclude',
              status: 'unresolved',
              evidence,
              detail: identityConflict.message,
            })
            entityCounts.unresolved += 1
            continue
          }
        }
        if (match.status === 'confirmed' && match.destinationId) {
          if (!claimDestination(match.destinationId, match.sourceId)) {
            emitDestinationClaimed(entity, match)
            continue
          }
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
        if (match.destinationId && !claimDestination(match.destinationId, match.sourceId)) {
          emitDestinationClaimed(entity, match)
          continue
        }
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
      if (claimedDestinationRows.has(key)) continue
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
    impact: buildPreviewImpact(context, entries, unresolved),
    snapshot: {
      sourceRows: context.sourceRows,
      targetRows: context.target.rows,
      /** Destination identity facts, kept for review and drift comparison. */
      identities: context.target.identities,
      /** Source assurance facts; the identity disposition reads only these. */
      sourceIdentities: context.sourceIdentities ?? [],
      retryHistory: context.sourceRetryHistory ?? [],
      retryHistoryCaptured: context.retryHistoryCaptured ?? true,
      receipts: context.trustedReceipts ?? context.target.receipts ?? [],
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

function stableAllocatedId(planDigest: string, sequence: number): string {
  const hex = sha256Hex(`vsis-migration-allocation\n${planDigest}\n${sequence}`)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

export function applyDecisions(
  context: ResolutionContext,
  plan: MergePlan,
  decisions: DecisionInput,
  options: { allocatedId?: () => string } = {}
): DecisionApplication {
  const issues: MergeIssue[] = []
  let allocationSequence = 0
  const allocate =
    options.allocatedId ??
    (() => {
      allocationSequence += 1
      return stableAllocatedId(plan.planDigest, allocationSequence)
    })

  const unresolvedByKey = new Map(plan.unresolved.map((conflict) => [entryKey(conflict.entity, conflict.sourceId), conflict]))
  const entriesByKey = new Map<string, PreviewEntry>()
  for (const entry of plan.entries) {
    if (entry.sourceId !== null) entriesByKey.set(entryKey(entry.entity, entry.sourceId), entry)
  }

  // Destination-claim uniqueness at decision time: proposed confirmed mappings
  // already own their destination row, and every reviewed map/update decision
  // claims its target. Two source records may never land on one destination
  // row; combining them is expressed by excluding one with a reason.
  const destinationClaims = new Map<string, string>()
  for (const entry of plan.entries) {
    if (entry.sourceId === null || !entry.destinationId) continue
    if (entry.action === 'map' && entry.status === 'proposed') {
      destinationClaims.set(`${entry.entity}\u0000${entry.destinationId}`, entry.sourceId)
    }
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
      if (
        decision.destinationId &&
        entry.destinationId &&
        decision.destinationId !== entry.destinationId &&
        !decision.reason
      ) {
        issues.push({
          code: 'E_DECISION_REASON_REQUIRED',
          entity: entry.entity,
          sourceId: entry.sourceId,
          message: `Remapping this record from the proposed destination ${entry.destinationId} to ${decision.destinationId} requires a recorded reason.`,
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
      if (decision.overrides) {
        const allowedOverrides = ALLOWED_CREATE_OVERRIDES[entry.entity] ?? []
        if (decision.action !== 'create') {
          issues.push({
            code: 'E_DECISION_OVERRIDES_ACTION',
            entity: entry.entity,
            sourceId: entry.sourceId,
            message: 'Literal overrides are only valid for create decisions.',
          })
        }
        for (const field of Object.keys(decision.overrides)) {
          if (!allowedOverrides.includes(field)) {
            issues.push({
              code: 'E_DECISION_OVERRIDE_PROTECTED',
              entity: entry.entity,
              sourceId: entry.sourceId,
              message: `Field "${field}" cannot be overridden when creating ${entry.entity}.`,
            })
          }
        }
      }
      if (decision.allocatedId && decision.action !== 'create') {
        issues.push({
          code: 'E_ALLOCATED_ID_ACTION',
          entity: entry.entity,
          sourceId: entry.sourceId,
          message: 'An allocated id is only valid for a create decision.',
        })
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

    const finalDestinationId = decision?.destinationId ?? entry.destinationId
    if ((action === 'map' || action === 'update') && finalDestinationId) {
      const claimKey = `${entry.entity}\u0000${finalDestinationId}`
      const claimedBy = destinationClaims.get(claimKey)
      if (claimedBy !== undefined && claimedBy !== entry.sourceId) {
        issues.push({
          code: 'E_DESTINATION_CLAIMED',
          entity: entry.entity,
          sourceId: entry.sourceId,
          message: `Destination row ${finalDestinationId} is the target of both source record ${claimedBy} and this record; distinct source records stay distinct — map one and exclude the other with a reason.`,
        })
      } else {
        destinationClaims.set(claimKey, entry.sourceId)
      }
    }

    resolvedEntries.push({
      ...entry,
      action,
      status: 'resolved',
      destinationId: decision?.destinationId ?? entry.destinationId,
    })
  }

  const seenSecurity = new Set<string>()
  for (const decision of decisions.security) {
    const securityKey = entryKey(decision.entity, decision.sourceId) + `\u0000${decision.field}`
    if (seenSecurity.has(securityKey)) {
      issues.push({
        code: 'E_SECURITY_DECISION_DUPLICATE',
        entity: decision.entity,
        sourceId: decision.sourceId,
        message: `More than one security decision was supplied for field "${decision.field}".`,
      })
    }
    seenSecurity.add(securityKey)
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
    issues.push(
      ...validateMergedState(materialized.expected, context.targetIdentities, {
        provider: context.targetProvider,
      })
    )
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
  const importedRows: Array<{ entity: MigrationEntity; sourceId: string; key: string; row: CanonicalRow; sourceForeignKeyFields: Set<string> }> = []

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
      if (!singleIdPk) {
        if (decision?.allocatedId) {
          issues.push({
            code: 'E_ALLOCATED_ID_UNSUPPORTED',
            entity,
            sourceId,
            message: 'Composite-primary-key records cannot receive an allocated id.',
          })
        }
      } else if (decision?.allocatedId) {
        destinationId = decision.allocatedId
      } else if (usedIds[entity].has(destinationId) || Object.values(idMap[entity]).includes(destinationId)) {
        destinationId = allocate()
      }
      if (singleIdPk && usedIds[entity].has(destinationId)) {
        issues.push({
          code: 'E_ALLOCATED_ID_COLLISION',
          entity,
          sourceId,
          message: `Allocated id ${destinationId} is already present in the merged result.`,
        })
        continue
      }
      idMap[entity][sourceId] = destinationId
      const row: CanonicalRow = { ...sourceRow }
      if (singleIdPk) {
        const idColumn = spec.columns.find((column) => column.name === 'id')
        if (idColumn?.kind === 'integer') {
          const numericId = Number(destinationId)
          if (!Number.isSafeInteger(numericId)) {
            issues.push({
              code: 'E_ALLOCATED_ID_INVALID',
              entity,
              sourceId,
              message: `Destination id ${destinationId} is not a valid ${entity} integer key.`,
            })
            continue
          }
          row.id = numericId
        } else {
          row.id = destinationId
        }
        usedIds[entity].add(destinationId)
      }
      if (decision?.overrides) {
        for (const [field, value] of Object.entries(decision.overrides)) row[field] = value
      }
      if (entity === 'profiles') {
        row.permission_role = 'user'
        row.hierarchy_role = 'user'
        row.is_active = false
        row.manager_id = null
      } else if (entity === 'titles') {
        row.hierarchy_role = 'user'
      } else if (entity === 'whitelisted_domains') {
        row.auto_activate = false
      }
      rows[entity].push(row)
      importedRows.push({
        entity,
        sourceId,
        row,
        key: primaryKeyOf(entity, row),
        sourceForeignKeyFields: new Set(spec.columns.filter((column) => column.references).map((column) => column.name)),
      })
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
      const adoptedIdentity =
        entity === 'profiles' && decision?.action === 'map'
          ? context.targetIdentities.find((identity) => identity.id === destinationId)
          : undefined
      if (adoptedIdentity) {
        const row: CanonicalRow = { ...sourceRow, id: destinationId }
        if (typeof adoptedIdentity.email === 'string') row.email = adoptedIdentity.email
        row.permission_role = 'user'
        row.hierarchy_role = 'user'
        row.is_active = false
        row.manager_id = null
        rows[entity].push(row)
        idMap[entity][sourceId] = destinationId
        importedRows.push({
          entity,
          sourceId,
          row,
          key: primaryKeyOf(entity, row),
          sourceForeignKeyFields: new Set(entitySpec(entity).columns.filter((column) => column.references).map((column) => column.name)),
        })
        continue
      }
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
      const sourceForeignKeyFields = new Set<string>()
      for (const [field, side] of Object.entries(fields)) {
        if (side === 'source') {
          destinationRow[field] = sourceRow[field]
          if (entitySpec(entity).columns.find((column) => column.name === field)?.references) {
            sourceForeignKeyFields.add(field)
          }
        }
      }
      importedRows.push({ entity, sourceId, row: destinationRow, key: primaryKeyOf(entity, destinationRow), sourceForeignKeyFields })
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
    // Keep row identity stable while foreign keys can change its primary key.
    const row = imported.row
    for (const column of spec.columns.filter((item) => item.references && imported.sourceForeignKeyFields.has(item.name))) {
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
    if (spec.primaryKey.length > 1) {
      idMap[imported.entity][imported.sourceId] = primaryKeyOf(imported.entity, row)
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
    // An excluded source singleton must not have its fields copied anyway: that
    // would silently override the operator's own exclusion decision.
    if (exclusions.some((item) => item.entity === 'app_settings')) {
      issues.push({
        code: 'E_SETTINGS_EXCLUDED',
        entity: 'app_settings',
        sourceId: null,
        message:
          'Settings field selections cannot apply because the source app_settings record is excluded; remove one of the two decisions.',
      })
    } else {
      const sourceRow = context.sourceRows.app_settings[0]
      const target = rows.app_settings[0]
      if (sourceRow && target) {
        for (const [field, side] of Object.entries(decisions.settings)) {
          if (side === 'source') target[field] = sourceRow[field]
        }
      }
    }
  }

  // Backstop: one destination row must never be the target of two mappings.
  for (const entity of ENTITY_ORDER) {
    const claimed = new Map<string, string>()
    for (const [sourceId, destinationId] of Object.entries(idMap[entity])) {
      const previous = claimed.get(destinationId)
      if (previous !== undefined && previous !== sourceId) {
        issues.push({
          code: 'E_DESTINATION_CLAIMED',
          entity,
          sourceId,
          message: `Destination row ${destinationId} is the target of mappings from both ${previous} and ${sourceId}.`,
        })
      }
      claimed.set(destinationId, sourceId)
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

function valueMatchesKind(kind: string, value: CanonicalRow[string]): boolean {
  if (typeof value === 'undefined') return false
  switch (kind) {
    case 'uuid':
      // Same grammar as the bundle contract: a legitimate PostgreSQL UUID must
      // never pass export/validation and then be rejected here.
      return typeof value === 'string' && UUID_RE.test(value)
    case 'text':
    case 'date':
    case 'timestamptz':
    case 'decimal':
    case 'json':
      return typeof value === 'string'
    case 'boolean':
      return typeof value === 'boolean'
    case 'integer':
      return typeof value === 'number' && Number.isSafeInteger(value)
    default:
      return false
  }
}

export function validateMergedState(
  expected: ExpectedResult,
  targetIdentities: IdentityRecord[] = [],
  options: { provider?: ProviderName } = {}
): MergeIssue[] {
  const issues: MergeIssue[] = []
  const rows = expected.rows

  // Validate every declared primary key, including composite keys such as
  // global_reminder_dismissals(user_id, reminder_id), after all FK rewrites.
  // The generic check catches collisions that entity-specific uniqueness rules
  // do not know about.
  for (const entity of ENTITY_ORDER) {
    const spec = entitySpec(entity)
    const seen = new Map<string, string>()
    for (const row of rows[entity]) {
      const key = primaryKeyOf(entity, row)
      const existing = seen.get(key)
      if (existing) {
        issues.push({
          code: 'E_DUPLICATE_ID',
          entity,
          sourceId: key,
          message: `${entity} primary key ${key.split('\u0000').join('/')} is duplicated with ${existing} in the merged result.`,
        })
      }
      seen.set(key, key)
      for (const column of spec.columns) {
        const value = row[column.name]
        if (value === null || value === undefined) {
          if (!column.nullable) {
            issues.push({
              code: 'E_REQUIRED_FIELD',
              entity,
              sourceId: key,
              message: `${entity}.${column.name} is required in the merged result.`,
            })
          }
          continue
        }
        if (!valueMatchesKind(column.kind, value)) {
          issues.push({
            code: 'E_VALUE_INVALID',
            entity,
            sourceId: key,
            message: `${entity}.${column.name} has a value incompatible with its ${column.kind} column.`,
          })
        }
      }
      // The merged state is the last gate before a write: re-run the exact
      // canonical contract (calendar validity, canonical JSON, decimal text) so
      // a value that passed export/validation cannot fail later at a cast.
      try {
        canonicalizeRow(entity, row)
      } catch (error) {
        issues.push({
          code: error instanceof MigrationFormatError ? error.code : 'E_VALUE_INVALID',
          entity,
          sourceId: key,
          message:
            error instanceof Error
              ? error.message
              : `${entity} row is not canonical under the bundle value contract.`,
        })
      }
    }
  }

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

  // Native enforces lower(name) uniqueness on titles (db/migrations/0022);
  // Supabase only constrains the exact name. A case-different pair fails the
  // native destination import, so it is reported rather than repaired — but
  // only for the provider whose constraint actually exists.
  if (options.provider === 'native') {
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

  const identityById = new Map(targetIdentities.map((identity) => [identity.id, identity]))
  for (const row of rows.profiles) {
    const profileId = String(row.id)
    const identity = identityById.get(profileId)
    if (identity && typeof identity.email === 'string' && typeof row.email === 'string') {
      if (normalizeEmail(identity.email) !== normalizeEmail(row.email)) {
        issues.push({
          code: 'E_AUTH_IDENTITY_MISMATCH',
          entity: 'profiles',
          sourceId: profileId,
          message: `Profile ${profileId} would claim email "${row.email}" while the destination Auth identity owns "${identity.email}".`,
        })
      }
    }
    if (typeof row.email !== 'string') continue
    const normalizedEmail = normalizeEmail(row.email)
    for (const owner of targetIdentities) {
      if (typeof owner.email !== 'string' || normalizeEmail(owner.email) !== normalizedEmail) continue
      if (owner.id !== profileId) {
        issues.push({
          code: 'E_AUTH_EMAIL_OWNERSHIP',
          entity: 'profiles',
          sourceId: profileId,
          message: `Normalized email "${normalizedEmail}" is already owned by destination Auth identity ${owner.id}.`,
        })
      }
    }
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

  const hoursByUserDate = new Map<string, bigint>()
  for (const row of rows.timesheets) {
    const hours = hoursScaled(String(row.hours_worked))
    if (hours === null) {
      issues.push({
        code: 'E_VALUE_INVALID',
        entity: 'timesheets',
        sourceId: String(row.id),
        message: `hours_worked ${String(row.hours_worked)} has more than ${HOURS_SCALE} fractional digits; the exact fixed-point comparison cannot represent it.`,
      })
      continue
    }
    if (hours <= 0n || hours > HOURS_MAX_SCALED) {
      issues.push({
        code: 'E_HOURS_RANGE',
        entity: 'timesheets',
        sourceId: String(row.id),
        message: `hours_worked ${String(row.hours_worked)} is outside the allowed (0, 24] range.`,
      })
    }
    const key = `${String(row.user_id)}\u0000${String(row.log_date)}`
    // Multiple entries per user and day are legal (db/migrations/0005 dropped
    // the per-day unique index); only the 24-hour cap over the merged set is
    // enforced, and it is summed in exact fixed-point arithmetic.
    hoursByUserDate.set(key, (hoursByUserDate.get(key) ?? 0n) + (hours !== null && hours > 0n ? hours : 0n))
  }
  for (const [key, total] of hoursByUserDate) {
    if (total > HOURS_MAX_SCALED) {
      const [userId, logDate] = key.split('\u0000')
      issues.push({
        code: 'E_DAILY_HOURS_CAP',
        entity: 'timesheets',
        sourceId: userId,
        message: `Merged total for user ${userId} on ${logDate} is ${scaledToDecimalText(total, HOURS_SCALE)} hours, above the 24-hour daily cap.`,
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
  /** The reviewed operator and timestamp are part of what was approved. */
  operator: { name: string; at: string }
}): string {
  return sha256Hex(
    canonicalStringify({
      planDigest: input.planDigest,
      decisions: input.decisions,
      expectedResultDigest: input.expectedResultDigest,
      idMap: input.idMap,
      operator: input.operator,
    })
  )
}

export function summarize(plan: MergePlan): string {
  return ENTITY_ORDER.map((entity) => {
    const counts = plan.counts[entity]
    return `${entity}: create=${counts.create} update=${counts.update} retain=${counts.retain} map=${counts.map} exclude=${counts.exclude} unresolved=${counts.unresolved}`
  }).join('\n')
}
