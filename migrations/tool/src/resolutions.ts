// migrations/tool/src/resolutions.ts
// The reviewed resolution artifact: a versioned, allowlisted decision file and
// the resolved plan it produces.
//
// Nothing here touches a database: `resolve` validates operator decisions
// against the reviewed plan, materializes the expected merged state and fails
// closed on any unresolved, illegal or inconsistent decision.

import { z } from 'zod'
import {
  ENTITY_NAMES,
  ENTITY_ORDER,
  canonicalStringify,
  canonicalizeTimestampText,
  sha256Hex,
  sourceInstanceSchema,
  type CanonicalRow,
  type MigrationEntity,
} from './format'
import {
  CONFLICT_KINDS,
  MERGE_PLAN_FORMAT,
  MERGE_PLAN_FORMAT_VERSION,
  RESOLVED_PLAN_FORMAT,
  applyDecisions,
  deploymentSnapshotDigest,
  expectedResultDigest,
  perEntityDigests,
  resolutionContextOf,
  resolutionDigest,
  type DecisionInput,
  type MergeIssue,
  type MergePlan,
  type ResolvedPlan,
} from './merge-plan'
import { MATCHING_RULES_VERSION } from './matching'

export const RESOLUTIONS_FORMAT = 'vsis-data-migration-resolutions'
export const RESOLUTIONS_FORMAT_VERSION = 1
/** Placeholder the template uses; resolve rejects it so a decision must be reviewed. */
export const PENDING_REVIEW = 'PENDING-REVIEW'

const HEX64 = /^[0-9a-f]{64}$/
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

const entitySchema = z.enum(ENTITY_NAMES as [MigrationEntity, ...MigrationEntity[]])
const timestampSchema = z.string().regex(TIMESTAMP).superRefine((value, ctx) => {
  try {
    if (canonicalizeTimestampText(value) !== value) {
      ctx.addIssue({ code: 'custom', message: 'timestamp must be a canonical real UTC instant' })
    }
  } catch {
    ctx.addIssue({ code: 'custom', message: 'timestamp must be a canonical real UTC instant' })
  }
})
const sourceActionSchema = z.enum(['create', 'update', 'map', 'exclude'])
const planActionSchema = z.enum(['create', 'update', 'map', 'retain', 'exclude'])

export const decisionFileSchema = z.strictObject({
  format: z.literal(RESOLUTIONS_FORMAT),
  formatVersion: z.literal(RESOLUTIONS_FORMAT_VERSION),
  planDigest: z.string().regex(HEX64),
  operator: z.strictObject({
    name: z.string().min(1),
    at: timestampSchema,
  }),
  decisions: z.array(
    z.strictObject({
      entity: entitySchema,
      sourceId: z.string().min(1),
      action: sourceActionSchema,
      destinationId: z.string().min(1).optional(),
      allocatedId: z.string().regex(UUID).optional(),
      fields: z.record(z.string().min(1), z.enum(['source', 'destination'])).optional(),
      overrides: z
        .record(z.string().min(1), z.union([z.string(), z.number(), z.boolean(), z.null()]))
        .optional(),
      reason: z.string().min(1).optional(),
    })
  ),
  security: z
    .array(
      z.strictObject({
        entity: entitySchema,
        sourceId: z.string().min(1),
        field: z.string().min(1),
        value: z.union([z.string(), z.boolean(), z.number(), z.null()]),
        reason: z.string().min(1),
      })
    )
    .optional(),
  settings: z.record(z.string().min(1), z.enum(['source', 'destination'])).optional(),
})

export type DecisionFile = z.infer<typeof decisionFileSchema>

const previewEntrySchema = z.strictObject({
  entity: entitySchema,
  sourceId: z.string().min(1).nullable(),
  destinationId: z.string().min(1).nullable(),
  action: planActionSchema,
  status: z.enum(['proposed', 'unresolved', 'resolved']),
  evidence: z.array(z.string().min(1)),
  detail: z.string().nullable(),
})

export const unresolvedConflictSchema = z.strictObject({
  entity: entitySchema,
  sourceId: z.string().min(1),
  destinationId: z.string().min(1).nullable(),
  // Derived from the planner's own conflict union: a new kind becomes schema
  // coverage automatically instead of silently failing E_PLAN_SCHEMA.
  kind: z.enum(CONFLICT_KINDS),
  message: z.string(),
  allowedActions: z.array(sourceActionSchema),
  evidence: z.array(z.string().min(1)),
})

const entityCountsSchema = z.strictObject({
  create: z.number().int().nonnegative(),
  update: z.number().int().nonnegative(),
  retain: z.number().int().nonnegative(),
  map: z.number().int().nonnegative(),
  exclude: z.number().int().nonnegative(),
  unresolved: z.number().int().nonnegative(),
})

const targetDescriptorSchema = z.strictObject({
  provider: z.enum(['native', 'supabase']),
  namespace: z.string().min(1),
  runtimeFingerprint: z.string().min(1),
  applicationVersion: z.string().min(1),
  schemaFingerprint: z.string().regex(HEX64),
  snapshotDigest: z.string().regex(HEX64),
})

const canonicalValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()])
const canonicalRowSchema = z.record(z.string(), canonicalValueSchema)
const canonicalRowsSchema = z.record(entitySchema, z.array(canonicalRowSchema))
const previewImpactSchema = z.strictObject({
  affectedUsers: z.array(z.string().min(1)),
  relationships: z.array(
    z.strictObject({
      entity: entitySchema,
      sourceId: z.string().min(1),
      field: z.string().min(1),
      referencedEntity: entitySchema,
      sourceValue: z.string(),
      proposedDestinationId: z.string().min(1).nullable(),
    })
  ),
  totals: z.strictObject({
    sourceRows: z.number().int().nonnegative(),
    destinationRows: z.number().int().nonnegative(),
    sourceTimesheetHours: z.string().min(1),
    destinationTimesheetHours: z.string().min(1),
    projectedTimesheetHours: z.string().min(1).nullable(),
  }),
})

const planSnapshotSchema = z.strictObject({
  sourceRows: canonicalRowsSchema,
  targetRows: canonicalRowsSchema,
  /** Destination identity facts captured for matching and drift comparison. */
  identities: z.array(
    z.strictObject({
      id: z.string().min(1),
      email: z.string().nullable(),
      emailConfirmed: z.boolean().nullable(),
      hasCredential: z.boolean().nullable(),
      /** Absent in plans written before provider identities were recorded. */
      providerIdentities: z.array(z.string()).nullable().optional(),
      /** Absent in plans written before second factors were recorded. */
      mfaFactors: z.number().int().nonnegative().nullable().optional(),
    })
  ),
  /**
   * Source account assurance facts. Absent in plans written before the bundle
   * carried an identity inventory; the apply fails closed for those.
   */
  sourceIdentities: z
    .array(
      z.strictObject({
        id: z.string().min(1),
        email: z.string().nullable(),
        emailConfirmed: z.boolean().nullable(),
        hasCredential: z.boolean().nullable(),
        providerIdentities: z.array(z.string()).nullable(),
        mfaFactors: z.number().int().nonnegative().nullable(),
      })
    )
    .optional(),
  retryHistory: z.array(
    z.strictObject({
      sourceNamespace: z.string().min(1),
      key: z.string().min(1),
      sourceActorId: z.string().min(1),
      operation: z.enum([
        'create_timesheet', 'update_timesheet', 'delete_timesheet',
        'create_leave', 'delete_leave',
        'create_reminder', 'update_reminder', 'delete_reminder',
      ]),
      outcome: z.enum(['committed', 'uncertain']),
      responseStatus: z.number().int().nonnegative(),
      fingerprintKind: z.enum(['request-json-v1', 'effect-v1']),
      fingerprint: z.string().regex(HEX64).nullable(),
      sourceResourceId: z.string().nullable(),
      createdAt: timestampSchema,
    })
  ),
  retryHistoryCaptured: z.boolean(),
  receipts: z.array(
    z.strictObject({
      kind: z.literal('destination-receipt'),
      sourceNamespace: z.string().min(1),
      targetNamespace: z.string().min(1),
      entity: entitySchema,
      sourceId: z.string().min(1),
      destinationId: z.string().min(1),
      runId: z.string().min(1),
      state: z.enum(['data-committed', 'verified', 'publication-intent', 'writable']),
    })
  ),
})

export const mergePlanSchema = z.strictObject({
  format: z.literal(MERGE_PLAN_FORMAT),
  formatVersion: z.literal(MERGE_PLAN_FORMAT_VERSION),
  runId: z.string().min(1),
  bundleId: z.string().min(1),
  bundleDigest: z.string().regex(HEX64),
  sourceInstance: sourceInstanceSchema,
  target: targetDescriptorSchema,
  matchingRulesVersion: z.number().int().positive(),
  createdAt: timestampSchema,
  counts: z.record(entitySchema, entityCountsSchema),
  unresolved: z.array(unresolvedConflictSchema),
  entries: z.array(previewEntrySchema),
  impact: previewImpactSchema,
  snapshot: planSnapshotSchema,
  expectedResultDigest: z.string().regex(HEX64).nullable(),
  planDigest: z.string().regex(HEX64),
})

export const resolvedPlanSchema = z.strictObject({
  format: z.literal(RESOLVED_PLAN_FORMAT),
  formatVersion: z.literal(MERGE_PLAN_FORMAT_VERSION),
  plan: mergePlanSchema,
  decisions: decisionFileSchema,
  entries: z.array(previewEntrySchema),
  idMap: z.record(entitySchema, z.record(z.string(), z.string())),
  exclusions: z.array(
    z.strictObject({ entity: entitySchema, sourceId: z.string().min(1), reason: z.string() })
  ),
  expectedResult: canonicalRowsSchema,
  expectedResultDigest: z.string().regex(HEX64),
  perEntityDigest: z.record(entitySchema, z.string().regex(HEX64)),
  operator: z.strictObject({ name: z.string().min(1), at: timestampSchema }),
  resolutionDigest: z.string().regex(HEX64),
})

export interface ResolveOutcome {
  ok: boolean
  resolvedPlan: ResolvedPlan | null
  issues: MergeIssue[]
}

export function toDecisionInput(file: DecisionFile): DecisionInput {
  return {
    records: file.decisions,
    security: file.security ?? [],
    settings: file.settings ?? null,
  }
}

/**
 * Apply a reviewed decision file to its plan. Fails closed on a mismatched plan
 * digest, an unresolved conflict, an illegal action, a protected field or an
 * invalid merged state.
 */
export function resolvePlan(
  plan: MergePlan,
  file: DecisionFile,
  options: { allocatedId?: () => string } = {}
): ResolveOutcome {
  const issues: MergeIssue[] = []
  if (file.planDigest !== plan.planDigest) {
    return {
      ok: false,
      resolvedPlan: null,
      issues: [
        {
          code: 'E_PLAN_DIGEST_MISMATCH',
          entity: null,
          sourceId: null,
          message: `Decision file targets plan ${file.planDigest.slice(0, 12)} but the plan digest is ${plan.planDigest.slice(0, 12)}.`,
        },
      ],
    }
  }
  const snapshotIssues = snapshotDigestIssues(plan)
  if (snapshotIssues.length > 0) return { ok: false, resolvedPlan: null, issues: snapshotIssues }
  // A plan generated under older matching behavior must not be reviewed as if
  // it followed the current rules; regenerate it against this release.
  if (plan.matchingRulesVersion !== MATCHING_RULES_VERSION) {
    return {
      ok: false,
      resolvedPlan: null,
      issues: [
        {
          code: 'E_MATCHING_RULES_UNSUPPORTED',
          entity: null,
          sourceId: null,
          message: `The plan records matching rules version ${plan.matchingRulesVersion}, but this release reviews version ${MATCHING_RULES_VERSION}. Regenerate the plan.`,
        },
      ],
    }
  }

  const application = applyDecisions(resolutionContextOf(plan), plan, toDecisionInput(file), options)
  issues.push(...application.issues)

  for (const decision of file.decisions) {
    if (decision.reason === PENDING_REVIEW) {
      issues.push({
        code: 'E_DECISION_PENDING_REVIEW',
        entity: decision.entity,
        sourceId: decision.sourceId,
        message: 'This decision still carries the PENDING-REVIEW placeholder reason.',
      })
    }
  }
  for (const decision of file.security ?? []) {
    if (decision.reason === PENDING_REVIEW) {
      issues.push({
        code: 'E_DECISION_PENDING_REVIEW',
        entity: decision.entity,
        sourceId: decision.sourceId,
        message: 'This security decision still carries the PENDING-REVIEW placeholder reason.',
      })
    }
  }
  if (issues.length > 0) return { ok: false, resolvedPlan: null, issues }

  const planWithoutDigest = { ...plan } as Record<string, unknown>
  delete planWithoutDigest.planDigest
  if (sha256Hex(canonicalStringify(planWithoutDigest)) !== plan.planDigest) {
    return {
      ok: false,
      resolvedPlan: null,
      issues: [
        {
          code: 'E_PLAN_TAMPERED',
          entity: null,
          sourceId: null,
          message: 'The plan document does not match its own digest.',
        },
      ],
    }
  }

  const resolvedPlan: ResolvedPlan = {
    format: RESOLVED_PLAN_FORMAT,
    formatVersion: MERGE_PLAN_FORMAT_VERSION,
    plan,
    decisions: file,
    entries: application.entries,
    idMap: application.idMap,
    exclusions: application.expected.exclusions,
    expectedResult: application.expected.rows,
    expectedResultDigest: expectedResultDigest(application.expected),
    perEntityDigest: application.expected.perEntityDigest,
    operator: { name: file.operator.name, at: file.operator.at },
    resolutionDigest: resolutionDigest({
      planDigest: plan.planDigest,
      decisions: file,
      expectedResultDigest: expectedResultDigest(application.expected),
      idMap: application.idMap,
      operator: { name: file.operator.name, at: file.operator.at },
    }),
  }
  return { ok: true, resolvedPlan, issues: [] }
}

/**
 * The embedded destination snapshot must be the one `target.snapshotDigest`
 * describes. Without this, an edited plan whose own hashes were recomputed
 * would verify, because every later check re-derives from the same snapshot.
 */
function snapshotDigestIssues(plan: MergePlan): MergeIssue[] {
  const recomputed = deploymentSnapshotDigest({
    provider: plan.target.provider,
    namespace: plan.target.namespace,
    runtimeFingerprint: plan.target.runtimeFingerprint,
    rows: plan.snapshot.targetRows,
    identities: plan.snapshot.identities,
    receipts: plan.snapshot.receipts,
  })
  if (recomputed === plan.target.snapshotDigest) return []
  return [
    {
      code: 'E_SNAPSHOT_DIGEST_MISMATCH',
      entity: null,
      sourceId: null,
      message:
        'The embedded destination snapshot does not match the reviewed target snapshot digest; regenerate and re-review the plan.',
    },
  ]
}

/** Recompute every digest of a resolved plan to detect tampering or drift. */
export function verifyResolvedPlan(
  resolved: ResolvedPlan,
  options: { allocatedId?: () => string } = {}
): MergeIssue[] {
  const issues: MergeIssue[] = []
  const planWithoutDigest = { ...resolved.plan } as Record<string, unknown>
  delete planWithoutDigest.planDigest
  if (sha256Hex(canonicalStringify(planWithoutDigest)) !== resolved.plan.planDigest) {
    issues.push({ code: 'E_PLAN_TAMPERED', entity: null, sourceId: null, message: 'Plan digest mismatch.' })
  }
  issues.push(...snapshotDigestIssues(resolved.plan))
  if (resolved.plan.matchingRulesVersion !== MATCHING_RULES_VERSION) {
    issues.push({
      code: 'E_MATCHING_RULES_UNSUPPORTED',
      entity: null,
      sourceId: null,
      message: `The plan records matching rules version ${resolved.plan.matchingRulesVersion}, but this release reviews version ${MATCHING_RULES_VERSION}.`,
    })
  }
  const recomputedPerEntity = perEntityDigests(resolved.expectedResult as Record<MigrationEntity, CanonicalRow[]>)
  for (const entity of ENTITY_ORDER) {
    if (recomputedPerEntity[entity] !== resolved.perEntityDigest[entity]) {
      issues.push({
        code: 'E_ENTITY_DIGEST_MISMATCH',
        entity,
        sourceId: null,
        message: `Expected rows for ${entity} do not match their recorded digest.`,
      })
    }
  }
  const recomputedExpected = expectedResultDigest({ perEntityDigest: resolved.perEntityDigest })
  if (recomputedExpected !== resolved.expectedResultDigest) {
    issues.push({
      code: 'E_RESULT_DIGEST_MISMATCH',
      entity: null,
      sourceId: null,
      message: 'Expected-result digest does not match the per-entity digests.',
    })
  }
  const recomputedResolution = resolutionDigest({
    planDigest: resolved.plan.planDigest,
    decisions: resolved.decisions,
    expectedResultDigest: resolved.expectedResultDigest,
    idMap: resolved.idMap,
    operator: resolved.operator,
  })
  if (recomputedResolution !== resolved.resolutionDigest) {
    issues.push({
      code: 'E_RESOLUTION_DIGEST_MISMATCH',
      entity: null,
      sourceId: null,
      message: 'Resolution digest does not match its bound inputs.',
    })
  }

  const parsedDecisions = decisionFileSchema.safeParse(resolved.decisions)
  if (!parsedDecisions.success) {
    issues.push({
      code: 'E_DECISIONS_SCHEMA',
      entity: null,
      sourceId: null,
      message: 'Resolved decisions do not match the reviewed decision schema.',
    })
  } else if (parsedDecisions.data.planDigest !== resolved.plan.planDigest) {
    issues.push({
      code: 'E_PLAN_DIGEST_MISMATCH',
      entity: null,
      sourceId: null,
      message: 'Resolved decisions target a different plan digest.',
    })
  } else {
    if (canonicalStringify(parsedDecisions.data.operator) !== canonicalStringify(resolved.operator)) {
      issues.push({
        code: 'E_RESOLVED_OPERATOR_MISMATCH',
        entity: null,
        sourceId: null,
        message: 'Top-level resolved-plan operator metadata does not match the reviewed decision file.',
      })
    }
    // Hashes prove that the artifact is internally self-consistent. Reapply the
    // reviewed decisions as well so an edited expected result/id map cannot be
    // made acceptable merely by recomputing all of its hashes.
    const application = applyDecisions(
      resolutionContextOf(resolved.plan),
      resolved.plan,
      toDecisionInput(parsedDecisions.data),
      options
    )
    for (const issue of application.issues) {
      issues.push({
        ...issue,
        code: issue.code === 'E_DECISION_PENDING_REVIEW' ? issue.code : `E_RESOLVED_${issue.code}`,
      })
    }
    if (canonicalStringify(application.entries) !== canonicalStringify(resolved.entries)) {
      issues.push({
        code: 'E_RESOLVED_ENTRIES_MISMATCH',
        entity: null,
        sourceId: null,
        message: 'Resolved entries do not match the result of reapplying the decisions.',
      })
    }
    if (canonicalStringify(application.expected.idMap) !== canonicalStringify(resolved.idMap)) {
      issues.push({
        code: 'E_RESOLVED_ID_MAP_MISMATCH',
        entity: null,
        sourceId: null,
        message: 'Resolved id mappings do not match the result of reapplying the decisions.',
      })
    }
    if (canonicalStringify(application.expected.exclusions) !== canonicalStringify(resolved.exclusions)) {
      issues.push({
        code: 'E_RESOLVED_EXCLUSIONS_MISMATCH',
        entity: null,
        sourceId: null,
        message: 'Resolved exclusions do not match the result of reapplying the decisions.',
      })
    }
    if (canonicalStringify(application.expected.rows) !== canonicalStringify(resolved.expectedResult)) {
      issues.push({
        code: 'E_RESOLVED_EXPECTED_RESULT_MISMATCH',
        entity: null,
        sourceId: null,
        message: 'Resolved expected rows do not match the result of reapplying the decisions.',
      })
    }
  }
  const unresolved = resolved.entries.filter((entry) => entry.status !== 'resolved')
  if (unresolved.length > 0) {
    issues.push({
      code: 'E_UNRESOLVED_ENTRIES',
      entity: null,
      sourceId: null,
      message: `${unresolved.length} entries are not resolved.`,
    })
  }
  return issues
}

/** Starting point for the operator: every unresolved conflict, pre-filled. */
export function buildDecisionsTemplate(
  plan: MergePlan,
  operator: { name: string; at: string }
): DecisionFile {
  return {
    format: RESOLUTIONS_FORMAT,
    formatVersion: RESOLUTIONS_FORMAT_VERSION,
    planDigest: plan.planDigest,
    operator,
    decisions: plan.unresolved.map((conflict) => ({
      entity: conflict.entity,
      sourceId: conflict.sourceId,
      action: conflict.allowedActions.includes('map') ? 'map' : conflict.allowedActions[0],
      ...(conflict.allowedActions.includes('map') && conflict.destinationId
        ? { destinationId: conflict.destinationId }
        : {}),
      reason: PENDING_REVIEW,
    })),
  }
}
