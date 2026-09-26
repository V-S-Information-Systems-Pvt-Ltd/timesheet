// tests/migration-merge-plan.test.ts
// C01M: candidate discovery, reviewed conflict resolution, ID/provenance
// mapping and the expected-merged-state invariants. These tests are pure: no
// database session is ever created, which is itself part of the contract
// (`resolve` performs no SQL and sends no email).

import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  ENTITY_ORDER,
  canonicalStringify,
  canonicalizeRow,
  sha256Hex,
  type CanonicalRow,
  type MigrationEntity,
  type ProvenanceAlias,
} from '@vsis/migration-tool/format'
import {
  CONFLICT_KINDS,
  applyDecisions,
  assertPlanFresh,
  buildPreview,
  deploymentSnapshotDigest,
  expectedResultDigest,
  perEntityDigests,
  resolutionContextOf,
  resolutionDigest,
  validateMergedState,
  type ConflictKind,
  type DecisionInput,
  type ExpectedResult,
  type MergePlan,
  type PlanningContext,
  type RecordDecision,
  type SecurityDecision,
} from '@vsis/migration-tool/merge-plan'
import type { DeploymentSnapshot, IdentityRecord } from '@vsis/migration-tool/providers/read'
import type { DestinationProvenanceReceipt } from '@vsis/migration-tool/matching'
import {
  PENDING_REVIEW,
  RESOLUTIONS_FORMAT,
  RESOLUTIONS_FORMAT_VERSION,
  buildDecisionsTemplate,
  decisionFileSchema,
  resolvePlan,
  unresolvedConflictSchema,
  verifyResolvedPlan,
  type DecisionFile,
} from '@vsis/migration-tool/resolutions'
import {
  activityTypeRow,
  appSettingsRow,
  auditLogRow,
  dismissalRow,
  domainRow,
  globalReminderRow,
  leaveRow,
  makeManifest,
  profileRow,
  projectRow,
  reminderRow,
  timesheetRow,
  titleRow,
} from './helpers/migration-fixtures'

const PROFILE_SOURCE_ID = '11111111-1111-4111-8111-111111111111'
const PROFILE_TARGET_ID = '10000000-0000-4000-8000-000000000001'
const PROJECT_SOURCE_ID = '22222222-2222-4222-8222-222222222222'
const PROJECT_TARGET_ID = '20000000-0000-4000-8000-000000000001'
const TIMESHEET_SOURCE_ID = '33333333-3333-4333-8333-333333333333'
const TIMESHEET_TARGET_ID = '30000000-0000-4000-8000-000000000001'

const NOW = '2026-09-19T10:00:00.000000Z'

type RowInput = Record<string, unknown>

function canonicalRows(
  entity: MigrationEntity,
  rows: RowInput[] | undefined
): CanonicalRow[] {
  return (rows ?? []).map((row) => canonicalizeRow(entity, row))
}

function snapshot(
  input: Partial<Record<MigrationEntity, RowInput[]>>,
  over: {
    namespace?: string
    runtimeFingerprint?: string
    identities?: IdentityRecord[]
    receipts?: DestinationProvenanceReceipt[]
    provider?: 'native' | 'supabase'
  } = {}
): DeploymentSnapshot {
  const rows = {} as Record<MigrationEntity, CanonicalRow[]>
  for (const entity of ENTITY_ORDER) rows[entity] = canonicalRows(entity, input[entity])
  return {
    provider: over.provider ?? ('native' as const),
    namespace: over.namespace ?? 'native:target',
    runtimeFingerprint: over.runtimeFingerprint ?? 'rt-target',
    rows,
    identities: over.identities ?? [],
    receipts: over.receipts ?? [],
  }
}

interface ContextInput {
  source: Partial<Record<MigrationEntity, RowInput[]>>
  target: Partial<Record<MigrationEntity, RowInput[]>>
  aliases?: ProvenanceAlias[]
  targetNamespace?: string
  targetProvider?: 'native' | 'supabase'
  identities?: IdentityRecord[]
  receipts?: DestinationProvenanceReceipt[]
}

function context(input: ContextInput): PlanningContext {
  const sourceRows = {} as Record<MigrationEntity, CanonicalRow[]>
  for (const entity of ENTITY_ORDER) sourceRows[entity] = canonicalRows(entity, input.source[entity])
  return {
    manifest: makeManifest(),
    provenance: input.aliases ?? [],
    sourceRows,
    target: snapshot(input.target, {
      namespace: input.targetNamespace ?? 'native:target',
      provider: input.targetProvider,
      identities: input.identities,
      receipts: input.receipts,
    }),
    trustedReceipts: input.receipts,
    targetApplicationVersion: '1.0.3',
    targetSchemaFingerprint: 'a'.repeat(64),
  }
}

function alias(entity: MigrationEntity, sourceId: string, destinationId: string, namespace = 'native:target'): ProvenanceAlias {
  return { entity, sourceId, destinationId, instanceNamespace: namespace, recordedAt: NOW }
}

function receipt(
  entity: MigrationEntity,
  sourceId: string,
  destinationId: string,
  sourceNamespace = 'native:source',
  targetNamespace = 'native:target'
): DestinationProvenanceReceipt {
  return {
    kind: 'destination-receipt',
    sourceNamespace,
    targetNamespace,
    entity,
    sourceId,
    destinationId,
    runId: 'run-receipt-1',
    state: 'data-committed',
  }
}

function preview(input: ContextInput): MergePlan {
  return buildPreview(context(input), { runId: 'run-1', createdAt: NOW })
}

function decisionFile(
  plan: MergePlan,
  decisions: Array<RecordDecision & { entity: MigrationEntity; sourceId: string }>,
  over: { security?: SecurityDecision[]; settings?: Record<string, 'source' | 'destination'>; planDigest?: string } = {}
): DecisionFile {
  return {
    format: RESOLUTIONS_FORMAT,
    formatVersion: RESOLUTIONS_FORMAT_VERSION,
    planDigest: over.planDigest ?? plan.planDigest,
    operator: { name: 'Operator', at: NOW },
    decisions,
    security: over.security,
    settings: over.settings,
  }
}

function mustResolve(plan: MergePlan, file: DecisionFile, allocate = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd') {
  const outcome = resolvePlan(plan, file, { allocatedId: () => allocate })
  expect(outcome.issues.map((issue) => issue.message).join('\n')).toBe('')
  expect(outcome.ok).toBe(true)
  if (!outcome.resolvedPlan) throw new Error('resolved plan missing')
  return outcome.resolvedPlan
}

describe('C01M matching and preview', () => {
  it('proposes create for unmatched source rows and retains destination-only rows', () => {
    const plan = preview({
      source: { projects: [projectRow({ id: PROJECT_SOURCE_ID, name: 'New Project' })] },
      target: { projects: [projectRow({ id: PROJECT_TARGET_ID, name: 'Existing Project' })] },
    })
    const creates = plan.entries.filter((entry) => entry.action === 'create')
    const retains = plan.entries.filter((entry) => entry.action === 'retain')
    expect(creates).toHaveLength(1)
    expect(creates[0].sourceId).toBe(PROJECT_SOURCE_ID)
    expect(retains).toHaveLength(1)
    expect(retains[0].destinationId).toBe(PROJECT_TARGET_ID)
    expect(plan.counts.projects.create).toBe(1)
    expect(plan.counts.projects.retain).toBe(1)
    expect(plan.unresolved).toHaveLength(0)
  })

  it('exposes affected users, relationships and projected totals in the preview', () => {
    const plan = preview({
      source: {
        profiles: [profileRow({ id: PROFILE_SOURCE_ID, email: 'new@example.com' })],
        projects: [projectRow({ id: PROJECT_SOURCE_ID, name: 'New Project' })],
        timesheets: [timesheetRow({ user_id: PROFILE_SOURCE_ID, project_id: PROJECT_SOURCE_ID, hours_worked: '7.50' })],
      },
      target: {},
    })
    expect(plan.impact.affectedUsers).toContain(PROFILE_SOURCE_ID)
    expect(plan.impact.relationships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ entity: 'timesheets', field: 'user_id', sourceValue: PROFILE_SOURCE_ID }),
        expect.objectContaining({ entity: 'timesheets', field: 'project_id', sourceValue: PROJECT_SOURCE_ID }),
      ])
    )
    expect(plan.impact.totals).toMatchObject({
      sourceRows: 3,
      destinationRows: 0,
      sourceTimesheetHours: '7.5',
      destinationTimesheetHours: '0',
      projectedTimesheetHours: '7.5',
    })
  })

  it('never coalesces distinct rows that merely display equal values', () => {
    const plan = preview({
      source: { timesheets: [timesheetRow({ user_id: PROFILE_SOURCE_ID, project_id: PROJECT_SOURCE_ID })] },
      target: {
        timesheets: [timesheetRow({ id: TIMESHEET_TARGET_ID, user_id: PROFILE_TARGET_ID, project_id: PROJECT_TARGET_ID })],
      },
    })
    expect(plan.counts.timesheets.create).toBe(1)
    expect(plan.counts.timesheets.retain).toBe(1)
    expect(plan.counts.timesheets.map).toBe(0)
    expect(plan.unresolved).toHaveLength(0)
  })

  it('treats a same-UUID account as an unresolved candidate and never links it automatically', () => {
    const plan = preview({
      source: { profiles: [profileRow({ id: PROFILE_SOURCE_ID })] },
      target: { profiles: [profileRow({ id: PROFILE_SOURCE_ID })] },
    })
    expect(plan.unresolved).toHaveLength(1)
    expect(plan.unresolved[0].kind).toBe('account-candidate')
    expect(plan.unresolved[0].allowedActions).toEqual(['map', 'exclude'])
    expect(plan.entries.find((entry) => entry.sourceId === PROFILE_SOURCE_ID)?.status).toBe('unresolved')
    expect(plan.counts.profiles.map).toBe(0)
    expect(plan.expectedResultDigest).toBeNull()
  })

  it('flags a UUID collision with a different email as a collision', () => {
    const plan = preview({
      source: { profiles: [profileRow({ id: PROFILE_SOURCE_ID, email: 'alice@example.com' })] },
      target: { profiles: [profileRow({ id: PROFILE_SOURCE_ID, email: 'someone.else@example.com' })] },
    })
    expect(plan.unresolved[0].kind).toBe('account-collision')
    expect(plan.unresolved[0].message).toContain('different email')
  })

  it('allocates the same stable id when the same collision is resolved twice', () => {
    const plan = preview({
      source: { profiles: [profileRow({ id: PROFILE_SOURCE_ID, email: 'new-owner@example.com' })] },
      target: { profiles: [profileRow({ id: PROFILE_SOURCE_ID, email: 'existing-owner@example.com' })] },
    })
    const file = decisionFile(plan, [
      { entity: 'profiles', sourceId: PROFILE_SOURCE_ID, action: 'create', reason: 'distinct person reused a UUID' },
    ])
    const first = resolvePlan(plan, file)
    const second = resolvePlan(plan, file)
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    expect(first.resolvedPlan?.idMap).toEqual(second.resolvedPlan?.idMap)
    expect(first.resolvedPlan?.expectedResultDigest).toBe(second.resolvedPlan?.expectedResultDigest)
  })

  it('flags an email-only account match as a candidate and keeps both accounts separate', () => {
    const plan = preview({
      source: { profiles: [profileRow({ id: PROFILE_SOURCE_ID, email: 'Alice@Example.com' })] },
      target: { profiles: [profileRow({ id: PROFILE_TARGET_ID, email: 'alice@example.com' })] },
    })
    expect(plan.unresolved).toHaveLength(1)
    expect(plan.unresolved[0].kind).toBe('account-candidate')
    expect(plan.counts.profiles.create).toBe(0)
    expect(plan.counts.profiles.unresolved).toBe(1)
    const resolved = mustResolve(
      plan,
      decisionFile(plan, [
        {
          entity: 'profiles',
          sourceId: PROFILE_SOURCE_ID,
          action: 'exclude',
          reason: 'distinct person sharing the normalized email',
        },
      ])
    )
    expect(resolved.expectedResult.profiles.map((row) => row.id)).toEqual([PROFILE_TARGET_ID])
  })

  it('blocks a profile create when an orphan destination Auth identity owns the email', () => {
    const identityId = '40000000-0000-4000-8000-000000000001'
    const plan = preview({
      source: { profiles: [profileRow({ id: PROFILE_SOURCE_ID, email: 'orphan@example.com' })] },
      target: {},
      identities: [{ id: identityId, email: 'orphan@example.com', emailConfirmed: true, hasCredential: null }],
    })
    expect(plan.unresolved[0].kind).toBe('account-collision')
    expect(plan.unresolved[0].allowedActions).toEqual(['map', 'exclude'])
    expect(plan.entries.find((entry) => entry.sourceId === PROFILE_SOURCE_ID)?.action).toBe('map')

    const blocked = resolvePlan(
      plan,
      decisionFile(plan, [
        { entity: 'profiles', sourceId: PROFILE_SOURCE_ID, action: 'create', reason: 'try to create a duplicate owner' },
      ])
    )
    expect(blocked.issues.map((issue) => issue.code)).toContain('E_DECISION_NOT_ALLOWED')

    const adopted = mustResolve(
      plan,
      decisionFile(plan, [
        { entity: 'profiles', sourceId: PROFILE_SOURCE_ID, action: 'map', destinationId: identityId, reason: 'adopt the existing Auth identity' },
      ])
    )
    expect(adopted.expectedResult.profiles).toEqual([
      expect.objectContaining({ id: identityId, email: 'orphan@example.com', is_active: false, permission_role: 'user' }),
    ])
  })

  it('does not carry privilege or activation fields into a new account without security review', () => {
    const plan = preview({
      source: {
        profiles: [
          profileRow({
            id: PROFILE_SOURCE_ID,
            email: 'new@example.com',
            permission_role: 'admin',
            hierarchy_role: 'manager',
            is_active: true,
          }),
        ],
        titles: [titleRow({ hierarchy_role: 'manager' })],
        whitelisted_domains: [domainRow({ auto_activate: true })],
      },
      target: {},
    })
    const resolved = mustResolve(plan, decisionFile(plan, []))
    expect(resolved.expectedResult.profiles[0]).toEqual(
      expect.objectContaining({ permission_role: 'user', hierarchy_role: 'user', is_active: false, manager_id: null })
    )
    expect(resolved.expectedResult.titles[0].hierarchy_role).toBe('user')
    expect(resolved.expectedResult.whitelisted_domains[0].auto_activate).toBe(false)
  })

  it('matches reference rows by unique key as an unresolved candidate, never a silent merge', () => {
    const plan = preview({
      source: { projects: [projectRow({ id: PROJECT_SOURCE_ID, name: 'Support' })] },
      target: { projects: [projectRow({ id: PROJECT_TARGET_ID, name: 'Support' })] },
    })
    expect(plan.unresolved[0].kind).toBe('reference-candidate')
    expect(plan.unresolved[0].allowedActions).toEqual(['map', 'create', 'exclude'])
    expect(plan.counts.projects.map).toBe(0)
  })

  it('treats a case-different unique key as a weaker candidate', () => {
    const plan = preview({
      source: { titles: [titleRow({ id: '77777777-7777-4777-8777-777777777777', name: 'systems engineer' })] },
      target: { titles: [titleRow({ id: '70000000-0000-4000-8000-000000000001', name: 'Systems Engineer' })] },
    })
    const conflict = plan.unresolved[0]
    expect(conflict.kind).toBe('reference-candidate')
    expect(conflict.message).toContain('case-different')
    expect(conflict.evidence).toContain('unique-key-case-differs')
  })

  it('uses verified prior provenance to map an already-imported record instead of recreating it', () => {
    const plan = preview({
      source: { timesheets: [timesheetRow({ user_id: PROFILE_SOURCE_ID, project_id: PROJECT_SOURCE_ID })] },
      target: {
        timesheets: [
          timesheetRow({ id: TIMESHEET_TARGET_ID, user_id: PROFILE_TARGET_ID, project_id: PROJECT_TARGET_ID }),
        ],
      },
      aliases: [alias('timesheets', TIMESHEET_SOURCE_ID, TIMESHEET_TARGET_ID)],
      receipts: [receipt('timesheets', TIMESHEET_SOURCE_ID, TIMESHEET_TARGET_ID)],
    })
    const entry = plan.entries.find((item) => item.sourceId === TIMESHEET_SOURCE_ID)
    expect(entry?.action).toBe('map')
    expect(entry?.destinationId).toBe(TIMESHEET_TARGET_ID)
    expect(plan.counts.timesheets.create).toBe(0)
    expect(plan.counts.timesheets.map).toBe(1)
  })

  it('reports a stale alias whose destination row no longer exists', () => {
    const plan = preview({
      source: { timesheets: [timesheetRow()] },
      target: { timesheets: [] },
      aliases: [alias('timesheets', TIMESHEET_SOURCE_ID, TIMESHEET_TARGET_ID)],
      receipts: [receipt('timesheets', TIMESHEET_SOURCE_ID, TIMESHEET_TARGET_ID)],
    })
    expect(plan.unresolved[0].message).toContain('no longer exists')
  })

  it('flags a previously imported record whose content changed as a review item', () => {
    const plan = preview({
      source: { timesheets: [timesheetRow({ work_done: 'Original text' })] },
      target: {
        timesheets: [
          timesheetRow({ id: TIMESHEET_TARGET_ID, work_done: 'Edited on the destination' }),
        ],
      },
      aliases: [alias('timesheets', TIMESHEET_SOURCE_ID, TIMESHEET_TARGET_ID)],
      receipts: [receipt('timesheets', TIMESHEET_SOURCE_ID, TIMESHEET_TARGET_ID)],
    })
    expect(plan.unresolved[0].kind).toBe('changed-record')
    expect(plan.unresolved[0].allowedActions).toEqual(['map', 'update', 'exclude'])
  })

  it('ignores aliases recorded for a different destination namespace', () => {
    const plan = preview({
      source: { timesheets: [timesheetRow()] },
      target: { timesheets: [] },
      aliases: [alias('timesheets', TIMESHEET_SOURCE_ID, TIMESHEET_TARGET_ID, 'native:other-deployment')],
    })
    expect(plan.counts.timesheets.create).toBe(1)
    expect(plan.unresolved).toHaveLength(0)
  })
})

describe('C01M resolution', () => {
  it('requires an explicit decision for every unresolved conflict', () => {
    const plan = preview({
      source: { profiles: [profileRow({ id: PROFILE_SOURCE_ID })] },
      target: { profiles: [profileRow({ id: PROFILE_SOURCE_ID })] },
    })
    const outcome = resolvePlan(plan, decisionFile(plan, []))
    expect(outcome.ok).toBe(false)
    expect(outcome.issues.map((issue) => issue.code)).toContain('E_DECISION_MISSING')
  })

  it('rejects an action the plan does not allow', () => {
    const plan = preview({
      source: { projects: [projectRow({ id: PROJECT_SOURCE_ID, name: 'Support' })] },
      target: { projects: [projectRow({ id: PROJECT_TARGET_ID, name: 'Support' })] },
    })
    const outcome = resolvePlan(
      plan,
      decisionFile(plan, [{ entity: 'projects', sourceId: PROJECT_SOURCE_ID, action: 'update' }])
    )
    expect(outcome.issues.map((issue) => issue.code)).toContain('E_DECISION_NOT_ALLOWED')
  })

  it('rejects protected field overrides for accounts', () => {
    const plan = preview({
      source: { profiles: [profileRow({ id: PROFILE_SOURCE_ID })] },
      target: { profiles: [profileRow({ id: PROFILE_SOURCE_ID })] },
    })
    const outcome = resolvePlan(
      plan,
      decisionFile(plan, [
        {
          entity: 'profiles',
          sourceId: PROFILE_SOURCE_ID,
          action: 'map',
          destinationId: PROFILE_SOURCE_ID,
          fields: { email: 'source' },
          reason: 'overwrite email',
        },
      ])
    )
    expect(outcome.issues.map((issue) => issue.code)).toContain('E_DECISION_FIELD_PROTECTED')
  })

  it('rejects the PENDING-REVIEW placeholder and template decisions', () => {
    const plan = preview({
      source: { profiles: [profileRow({ id: PROFILE_SOURCE_ID })] },
      target: { profiles: [profileRow({ id: PROFILE_SOURCE_ID })] },
    })
    const template = buildDecisionsTemplate(plan, { name: 'Operator', at: NOW })
    expect(template.decisions[0].reason).toBe(PENDING_REVIEW)
    const outcome = resolvePlan(plan, template)
    expect(outcome.issues.map((issue) => issue.code)).toContain('E_DECISION_PENDING_REVIEW')
  })

  it('rejects a decision for a record that is not in the plan', () => {
    const plan = preview({
      source: { profiles: [profileRow({ id: PROFILE_SOURCE_ID })] },
      target: { profiles: [profileRow({ id: PROFILE_SOURCE_ID })] },
    })
    const outcome = resolvePlan(
      plan,
      decisionFile(plan, [
        { entity: 'profiles', sourceId: PROFILE_SOURCE_ID, action: 'map', destinationId: PROFILE_SOURCE_ID, reason: 'ok' },
        { entity: 'profiles', sourceId: 'ffffffff-ffff-4fff-8fff-ffffffffffff', action: 'create' },
      ])
    )
    expect(outcome.issues.map((issue) => issue.code)).toContain('E_DECISION_UNKNOWN_RECORD')
  })

  it('rejects a decision file bound to a different plan digest', () => {
    const plan = preview({
      source: { profiles: [profileRow({ id: PROFILE_SOURCE_ID })] },
      target: { profiles: [profileRow({ id: PROFILE_SOURCE_ID })] },
    })
    const outcome = resolvePlan(plan, decisionFile(plan, [], { planDigest: 'f'.repeat(64) }))
    expect(outcome.issues.map((issue) => issue.code)).toContain('E_PLAN_DIGEST_MISMATCH')
  })

  it('resolves a mapping and rewrites dependent foreign keys through the reviewed map', () => {
    const plan = preview({
      source: {
        profiles: [profileRow({ id: PROFILE_SOURCE_ID, email: 'alice@example.com' })],
        projects: [projectRow({ id: PROJECT_SOURCE_ID, name: 'Support' })],
        timesheets: [timesheetRow({ project_id: PROJECT_SOURCE_ID })],
      },
      target: {
        profiles: [profileRow({ id: PROFILE_TARGET_ID, email: 'alice@example.com' })],
        projects: [projectRow({ id: PROJECT_TARGET_ID, name: 'Support' })],
      },
    })
    const resolved = mustResolve(
      plan,
      decisionFile(plan, [
        { entity: 'profiles', sourceId: PROFILE_SOURCE_ID, action: 'map', destinationId: PROFILE_TARGET_ID, reason: 'same person' },
        { entity: 'projects', sourceId: PROJECT_SOURCE_ID, action: 'map', destinationId: PROJECT_TARGET_ID, reason: 'same project' },
      ])
    )
    expect(resolved.idMap.profiles[PROFILE_SOURCE_ID]).toBe(PROFILE_TARGET_ID)
    expect(resolved.idMap.projects[PROJECT_SOURCE_ID]).toBe(PROJECT_TARGET_ID)
    const timesheet = resolved.expectedResult.timesheets.find((row) => row.id === TIMESHEET_SOURCE_ID)
    expect(timesheet?.user_id).toBe(PROFILE_TARGET_ID)
    expect(timesheet?.project_id).toBe(PROJECT_TARGET_ID)
    expect(verifyResolvedPlan(resolved)).toEqual([])
  })

  it('rewrites only source-selected foreign keys on a mapped row', () => {
    const retainedProjectId = PROJECT_SOURCE_ID
    const plan = preview({
      source: {
        profiles: [profileRow({ id: PROFILE_SOURCE_ID, email: 'alice@example.com' })],
        projects: [projectRow({ id: PROJECT_SOURCE_ID, name: 'Mapped project' })],
        timesheets: [timesheetRow({ project_id: PROJECT_SOURCE_ID, work_done: 'Source wording' })],
      },
      target: {
        profiles: [profileRow({ id: PROFILE_TARGET_ID, email: 'alice@example.com' })],
        projects: [
          projectRow({ id: retainedProjectId, name: 'Retained destination project', telegram_no: 95 }),
          projectRow({ id: PROJECT_TARGET_ID, name: 'Mapped project' }),
        ],
        timesheets: [
          timesheetRow({
            id: TIMESHEET_TARGET_ID,
            user_id: PROFILE_TARGET_ID,
            project_id: retainedProjectId,
            work_done: 'Destination wording',
          }),
        ],
      },
      receipts: [
        receipt('profiles', PROFILE_SOURCE_ID, PROFILE_TARGET_ID),
        receipt('projects', PROJECT_SOURCE_ID, PROJECT_TARGET_ID),
        receipt('timesheets', TIMESHEET_SOURCE_ID, TIMESHEET_TARGET_ID),
      ],
    })
    const resolved = mustResolve(
      plan,
      decisionFile(plan, [
        { entity: 'projects', sourceId: PROJECT_SOURCE_ID, action: 'map', destinationId: PROJECT_TARGET_ID, reason: 'same project' },
        { entity: 'timesheets', sourceId: TIMESHEET_SOURCE_ID, action: 'update', fields: { work_done: 'source' }, reason: 'correct wording' },
      ])
    )
    const timesheet = resolved.expectedResult.timesheets.find((row) => row.id === TIMESHEET_TARGET_ID)
    expect(timesheet?.work_done).toBe('Source wording')
    expect(timesheet?.project_id).toBe(retainedProjectId)
  })

  it('allocates a new id for a UUID collision resolved as create and rewrites dependents', () => {
    const allocated = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    const plan = preview({
      source: {
        profiles: [profileRow({ id: PROFILE_SOURCE_ID, email: 'alice.new@example.com' })],
        projects: [projectRow({ id: PROJECT_SOURCE_ID, name: 'Support' })],
        timesheets: [timesheetRow({ user_id: PROFILE_SOURCE_ID, project_id: PROJECT_SOURCE_ID })],
      },
      target: {
        profiles: [profileRow({ id: PROFILE_SOURCE_ID, email: 'alice@example.com' })],
        projects: [projectRow({ id: PROJECT_TARGET_ID, name: 'Support' })],
      },
    })
    expect(plan.unresolved.map((conflict) => conflict.kind)).toContain('account-collision')
    const resolved = mustResolve(
      plan,
      decisionFile(plan, [
        { entity: 'profiles', sourceId: PROFILE_SOURCE_ID, action: 'create', reason: 'distinct person reusing a UUID' },
        { entity: 'projects', sourceId: PROJECT_SOURCE_ID, action: 'map', destinationId: PROJECT_TARGET_ID, reason: 'same project' },
      ]),
      allocated
    )
    expect(resolved.idMap.profiles[PROFILE_SOURCE_ID]).toBe(allocated)
    const created = resolved.expectedResult.profiles.find((row) => row.id === allocated)
    expect(created?.email).toBe('alice.new@example.com')
    const timesheet = resolved.expectedResult.timesheets.find((row) => row.id === TIMESHEET_SOURCE_ID)
    expect(timesheet?.user_id).toBe(allocated)
    expect(timesheet?.project_id).toBe(PROJECT_TARGET_ID)
    expect(resolved.expectedResult.profiles).toHaveLength(2)
  })

  it('records an explicit exclusion with its reason', () => {
    const plan = preview({
      source: { timesheets: [timesheetRow()] },
      target: { timesheets: [] },
    })
    const resolved = mustResolve(
      plan,
      decisionFile(plan, [
        { entity: 'timesheets', sourceId: TIMESHEET_SOURCE_ID, action: 'exclude', reason: 'superseded by a corrected entry' },
      ])
    )
    expect(resolved.exclusions).toEqual([
      { entity: 'timesheets', sourceId: TIMESHEET_SOURCE_ID, reason: 'superseded by a corrected entry' },
    ])
    expect(resolved.expectedResult.timesheets).toHaveLength(0)
  })

  it('applies field-level updates only for allowlisted data fields', () => {
    const plan = preview({
      source: {
        profiles: [profileRow({ id: PROFILE_SOURCE_ID, email: 'alice@example.com', name: 'Alice Source' })],
        projects: [projectRow({ id: PROJECT_SOURCE_ID, name: 'Support' })],
        timesheets: [timesheetRow({ work_done: 'Source text', project_id: PROJECT_SOURCE_ID })],
      },
      target: {
        profiles: [profileRow({ id: PROFILE_TARGET_ID, email: 'alice@example.com' })],
        projects: [projectRow({ id: PROJECT_TARGET_ID, name: 'Support' })],
        timesheets: [timesheetRow({ id: TIMESHEET_TARGET_ID, user_id: PROFILE_TARGET_ID, work_done: 'Destination text', project_id: PROJECT_TARGET_ID })],
      },
      aliases: [alias('timesheets', TIMESHEET_SOURCE_ID, TIMESHEET_TARGET_ID)],
      receipts: [receipt('timesheets', TIMESHEET_SOURCE_ID, TIMESHEET_TARGET_ID)],
    })
    const resolved = mustResolve(
      plan,
      decisionFile(plan, [
        { entity: 'profiles', sourceId: PROFILE_SOURCE_ID, action: 'map', destinationId: PROFILE_TARGET_ID, reason: 'same person' },
        { entity: 'projects', sourceId: PROJECT_SOURCE_ID, action: 'map', destinationId: PROJECT_TARGET_ID, reason: 'same project' },
        {
          entity: 'timesheets',
          sourceId: TIMESHEET_SOURCE_ID,
          action: 'update',
          fields: { work_done: 'source' },
          reason: 'source text is the corrected wording',
        },
      ])
    )
    const timesheet = resolved.expectedResult.timesheets.find((row) => row.id === TIMESHEET_TARGET_ID)
    expect(timesheet?.work_done).toBe('Source text')
    expect(timesheet?.project_id).toBe(PROJECT_TARGET_ID)
  })

  it('applies security decisions with reasons and rejects invalid role values', () => {
    const plan = preview({
      source: {
        profiles: [profileRow({ id: PROFILE_SOURCE_ID, email: 'alice@example.com', permission_role: 'admin' })],
      },
      target: { profiles: [profileRow({ id: PROFILE_TARGET_ID, email: 'alice@example.com' })] },
    })
    const ok = resolvePlan(
      plan,
      decisionFile(
        plan,
        [{ entity: 'profiles', sourceId: PROFILE_SOURCE_ID, action: 'map', destinationId: PROFILE_TARGET_ID, reason: 'same person' }],
        { security: [{ entity: 'profiles', sourceId: PROFILE_SOURCE_ID, field: 'permission_role', value: 'admin', reason: 'approved promotion' }] }
      )
    )
    expect(ok.ok).toBe(true)
    expect(ok.resolvedPlan?.expectedResult.profiles.find((row) => row.id === PROFILE_TARGET_ID)?.permission_role).toBe('admin')

    const invalid = resolvePlan(
      plan,
      decisionFile(
        plan,
        [{ entity: 'profiles', sourceId: PROFILE_SOURCE_ID, action: 'map', destinationId: PROFILE_TARGET_ID, reason: 'same person' }],
        { security: [{ entity: 'profiles', sourceId: PROFILE_SOURCE_ID, field: 'permission_role', value: 'superuser', reason: 'typo' }] }
      )
    )
    expect(invalid.issues.map((issue) => issue.code)).toContain('E_ROLE_INVALID')
  })

  it('rejects a security decision without a reason and protected security fields', () => {
    const plan = preview({
      source: { profiles: [profileRow({ id: PROFILE_SOURCE_ID })] },
      target: { profiles: [profileRow({ id: PROFILE_SOURCE_ID })] },
    })
    const outcome = resolvePlan(
      plan,
      decisionFile(plan, [{ entity: 'profiles', sourceId: PROFILE_SOURCE_ID, action: 'map', destinationId: PROFILE_SOURCE_ID, reason: 'ok' }], {
        security: [{ entity: 'profiles', sourceId: PROFILE_SOURCE_ID, field: 'email', value: 'x@example.com', reason: '' }],
      })
    )
    const codes = outcome.issues.map((issue) => issue.code)
    expect(codes).toContain('E_SECURITY_FIELD_PROTECTED')
    expect(codes).toContain('E_SECURITY_REASON_REQUIRED')
  })

  it('applies settings field decisions from the source', () => {
    const plan = preview({
      source: { app_settings: [appSettingsRow({ app_name: 'Source Name' })] },
      target: { app_settings: [appSettingsRow({ app_name: 'Destination Name' })] },
    })
    expect(plan.unresolved).toHaveLength(1)
    const resolved = mustResolve(
      plan,
      decisionFile(plan, [{ entity: 'app_settings', sourceId: '1', action: 'update', reason: 'branding approved' }], {
        settings: { app_name: 'source' },
      })
    )
    expect(resolved.expectedResult.app_settings[0].app_name).toBe('Source Name')
  })

  it('accepts a well-formed decision file through its published schema', () => {
    const plan = preview({
      source: { timesheets: [timesheetRow()] },
      target: { timesheets: [] },
    })
    const file = decisionFile(plan, [
      { entity: 'timesheets', sourceId: TIMESHEET_SOURCE_ID, action: 'create' },
    ])
    expect(decisionFileSchema.safeParse(file).success).toBe(true)
    expect(decisionFileSchema.safeParse({ ...file, extra: true }).success).toBe(false)
    expect(decisionFileSchema.safeParse({
      ...file,
      operator: { ...file.operator, at: '2026-02-31T00:00:00.000000Z' },
    }).success).toBe(false)
  })

  it('resolves the plan without any database access', () => {
    const plan = preview({
      source: { profiles: [profileRow({ id: PROFILE_SOURCE_ID })] },
      target: { profiles: [profileRow({ id: PROFILE_SOURCE_ID })] },
    })
    // No session or connection factory exists in this path: resolvePlan only
    // consumes the plan artifact it was given.
    const resolved = mustResolve(
      plan,
      decisionFile(plan, [
        { entity: 'profiles', sourceId: PROFILE_SOURCE_ID, action: 'map', destinationId: PROFILE_SOURCE_ID, reason: 'same person' },
      ])
    )
    expect(resolved.plan.snapshot.targetRows.profiles).toHaveLength(1)
  })
})

describe('C01M merged-state invariants', () => {
  it('keeps two timesheets for one user and day separate when the merged total stays within 24 hours', () => {
    // db/migrations/0005 dropped the per-day unique index: multiple entries
    // per user and day are legal, and the plan's conflict table requires
    // equal-looking timesheets to stay distinct.
    const plan = preview({
      source: {
        profiles: [profileRow({ id: PROFILE_SOURCE_ID, email: 'alice@example.com' })],
        projects: [projectRow({ id: PROJECT_SOURCE_ID, name: 'Alpha' })],
        timesheets: [timesheetRow({ id: TIMESHEET_SOURCE_ID, user_id: PROFILE_SOURCE_ID, hours_worked: '6.00' })],
      },
      target: {
        profiles: [profileRow({ id: PROFILE_TARGET_ID, email: 'alice@example.com' })],
        projects: [projectRow({ id: PROJECT_TARGET_ID, name: 'Alpha' })],
        timesheets: [timesheetRow({ id: TIMESHEET_TARGET_ID, user_id: PROFILE_TARGET_ID, project_id: PROJECT_TARGET_ID, hours_worked: '6.00' })],
      },
    })
    const outcome = resolvePlan(
      plan,
      decisionFile(plan, [
        { entity: 'profiles', sourceId: PROFILE_SOURCE_ID, action: 'map', destinationId: PROFILE_TARGET_ID, reason: 'same person' },
        { entity: 'projects', sourceId: PROJECT_SOURCE_ID, action: 'map', destinationId: PROJECT_TARGET_ID, reason: 'same project' },
      ])
    )
    expect(outcome.issues).toHaveLength(0)
    const resolved = outcome.resolvedPlan
    expect(resolved).not.toBeNull()
    if (!resolved) throw new Error('resolved plan missing')
    expect(resolved.expectedResult.timesheets).toHaveLength(2)
  })

  it('fails when the merged daily total exceeds 24 hours', () => {
    const plan = preview({
      source: {
        profiles: [profileRow({ id: PROFILE_SOURCE_ID, email: 'alice@example.com' })],
        timesheets: [timesheetRow({ id: TIMESHEET_SOURCE_ID, user_id: PROFILE_SOURCE_ID, hours_worked: '12.50' })],
      },
      target: {
        profiles: [profileRow({ id: PROFILE_TARGET_ID, email: 'alice@example.com' })],
        timesheets: [
          timesheetRow({ id: TIMESHEET_TARGET_ID, user_id: PROFILE_TARGET_ID, hours_worked: '12.00' }),
        ],
      },
    })
    const outcome = resolvePlan(
      plan,
      decisionFile(plan, [
        { entity: 'profiles', sourceId: PROFILE_SOURCE_ID, action: 'map', destinationId: PROFILE_TARGET_ID, reason: 'same person' },
      ])
    )
    expect(outcome.issues.map((issue) => issue.code)).toContain('E_DAILY_HOURS_CAP')
  })

  it('fails when a resolved rename would duplicate a unique name', () => {
    const otherProject = '20000000-0000-4000-8000-000000000002'
    const plan = preview({
      source: { projects: [projectRow({ id: PROJECT_SOURCE_ID, name: 'Support' })] },
      target: {
        projects: [
          projectRow({ id: PROJECT_TARGET_ID, name: 'Support' }),
          projectRow({ id: otherProject, name: 'Operations' }),
        ],
      },
    })
    const outcome = resolvePlan(
      plan,
      decisionFile(plan, [
        {
          entity: 'projects',
          sourceId: PROJECT_SOURCE_ID,
          action: 'map',
          destinationId: otherProject,
          fields: { name: 'source' },
          reason: 'renaming Operations is wrong on purpose for this test',
        },
      ])
    )
    expect(outcome.issues.map((issue) => issue.code)).toContain('E_UNIQUE_VIOLATION')
  })

  it('fails on a manager cycle introduced by security decisions', () => {
    const secondTarget = '10000000-0000-4000-8000-000000000002'
    const plan = preview({
      source: {
        profiles: [
          profileRow({ id: PROFILE_SOURCE_ID, email: 'alice@example.com' }),
          profileRow({ id: '11111111-1111-4111-8111-111111111112', email: 'bob@example.com', manager_id: PROFILE_SOURCE_ID }),
        ],
      },
      target: {
        profiles: [
          profileRow({ id: PROFILE_TARGET_ID, email: 'alice@example.com' }),
          profileRow({ id: secondTarget, email: 'bob@example.com' }),
        ],
      },
    })
    const outcome = resolvePlan(
      plan,
      decisionFile(
        plan,
        [
          { entity: 'profiles', sourceId: PROFILE_SOURCE_ID, action: 'map', destinationId: PROFILE_TARGET_ID, reason: 'same person' },
          {
            entity: 'profiles',
            sourceId: '11111111-1111-4111-8111-111111111112',
            action: 'map',
            destinationId: secondTarget,
            reason: 'same person',
          },
        ],
        {
          security: [
            { entity: 'profiles', sourceId: PROFILE_SOURCE_ID, field: 'manager_id', value: secondTarget, reason: 'reorg' },
            {
              entity: 'profiles',
              sourceId: '11111111-1111-4111-8111-111111111112',
              field: 'manager_id',
              value: PROFILE_TARGET_ID,
              reason: 'reorg',
            },
          ],
        }
      )
    )
    expect(outcome.issues.map((issue) => issue.code)).toContain('E_MANAGER_CYCLE')
  })

  it('fails when a security decision points at a manager that does not exist', () => {
    const plan = preview({
      source: { profiles: [profileRow({ id: PROFILE_SOURCE_ID, email: 'alice@example.com' })] },
      target: { profiles: [profileRow({ id: PROFILE_TARGET_ID, email: 'alice@example.com' })] },
    })
    const outcome = resolvePlan(
      plan,
      decisionFile(
        plan,
        [{ entity: 'profiles', sourceId: PROFILE_SOURCE_ID, action: 'map', destinationId: PROFILE_TARGET_ID, reason: 'same person' }],
        {
          security: [
            {
              entity: 'profiles',
              sourceId: PROFILE_SOURCE_ID,
              field: 'manager_id',
              value: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
              reason: 'assign manager',
            },
          ],
        }
      )
    )
    expect(outcome.issues.map((issue) => issue.code)).toContain('E_MANAGER_MISSING')
  })

  it('requires an explicit disposition for dependents of an excluded parent', () => {
    const plan = preview({
      source: {
        profiles: [profileRow({ id: PROFILE_SOURCE_ID, email: 'alice@example.com' })],
        timesheets: [timesheetRow({ user_id: PROFILE_SOURCE_ID })],
      },
      target: { profiles: [profileRow({ id: PROFILE_TARGET_ID, email: 'other@example.com' })] },
    })
    const outcome = resolvePlan(
      plan,
      decisionFile(plan, [
        { entity: 'profiles', sourceId: PROFILE_SOURCE_ID, action: 'exclude', reason: 'duplicate account' },
      ])
    )
    const codes = outcome.issues.map((issue) => issue.code)
    expect(codes).toContain('E_DEPENDENT_ORPHAN')
    expect(codes).toContain('E_EXCLUDED_PARENT_DEPENDENT')
  })

  it('accepts an excluded parent when every dependent is explicitly excluded too', () => {
    const plan = preview({
      source: {
        profiles: [profileRow({ id: PROFILE_SOURCE_ID, email: 'alice@example.com' })],
        timesheets: [timesheetRow({ user_id: PROFILE_SOURCE_ID })],
      },
      target: { profiles: [profileRow({ id: PROFILE_TARGET_ID, email: 'other@example.com' })] },
    })
    const resolved = mustResolve(
      plan,
      decisionFile(plan, [
        { entity: 'profiles', sourceId: PROFILE_SOURCE_ID, action: 'exclude', reason: 'duplicate account' },
        { entity: 'timesheets', sourceId: TIMESHEET_SOURCE_ID, action: 'exclude', reason: 'owner excluded' },
      ])
    )
    expect(resolved.exclusions).toHaveLength(2)
  })

  it('validates the merged result through applyDecisions as well as resolvePlan', () => {
    const contextInput: ContextInput = {
      source: {
        profiles: [profileRow({ id: PROFILE_SOURCE_ID, email: 'alice@example.com' })],
        projects: [projectRow({ id: PROJECT_SOURCE_ID, name: 'Support' })],
        timesheets: [timesheetRow({ hours_worked: '25.00', project_id: PROJECT_SOURCE_ID })],
      },
      target: {
        profiles: [profileRow({ id: PROFILE_TARGET_ID, email: 'alice@example.com' })],
        projects: [projectRow({ id: PROJECT_TARGET_ID, name: 'Support' })],
      },
    }
    const plan = preview(contextInput)
    const decisions: DecisionInput = {
      records: [
        { entity: 'profiles', sourceId: PROFILE_SOURCE_ID, action: 'map', destinationId: PROFILE_TARGET_ID, reason: 'same person' },
        { entity: 'projects', sourceId: PROJECT_SOURCE_ID, action: 'map', destinationId: PROJECT_TARGET_ID, reason: 'same project' },
      ],
      security: [],
      settings: null,
    }
    const application = applyDecisions(resolutionContextOf(plan), plan, decisions)
    expect(application.issues.map((issue) => issue.code)).toContain('E_HOURS_RANGE')
  })

  it('rejects a composite primary-key collision introduced by reviewed remapping', () => {
    const sourceReminderId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    const targetReminderId = 'b0000000-0000-4000-8000-000000000001'
    const sourceDismissal = dismissalRow({ user_id: PROFILE_SOURCE_ID, reminder_id: sourceReminderId })
    const plan = preview({
      source: {
        profiles: [profileRow({ id: PROFILE_SOURCE_ID, email: 'alice@example.com' })],
        global_reminders: [globalReminderRow({ id: sourceReminderId })],
        global_reminder_dismissals: [sourceDismissal],
      },
      target: {
        profiles: [profileRow({ id: PROFILE_TARGET_ID, email: 'alice@example.com' })],
        global_reminders: [globalReminderRow({ id: targetReminderId })],
        global_reminder_dismissals: [dismissalRow({ user_id: PROFILE_TARGET_ID, reminder_id: targetReminderId })],
      },
      receipts: [
        receipt('profiles', PROFILE_SOURCE_ID, PROFILE_TARGET_ID),
        receipt('global_reminders', sourceReminderId, targetReminderId),
      ],
    })
    const resolved = resolvePlan(
      plan,
      decisionFile(plan, [
        { entity: 'global_reminder_dismissals', sourceId: `${PROFILE_SOURCE_ID}\u0000${sourceReminderId}`, action: 'create' },
      ])
    )
    expect(resolved.issues.map((issue) => issue.code)).toContain('E_DUPLICATE_ID')
  })
})

describe('C01M freshness and tamper detection', () => {
  it('accepts an unchanged destination snapshot and rejects drift', () => {
    const contextInput: ContextInput = {
      source: { timesheets: [timesheetRow()] },
      target: { timesheets: [] },
    }
    const plan = preview(contextInput)
    const unchanged = context(contextInput)
    expect(() => assertPlanFresh(plan, unchanged.target)).not.toThrow()

    const drifted = context({
      ...contextInput,
      target: { timesheets: [timesheetRow({ id: TIMESHEET_TARGET_ID })] },
    })
    let error: unknown = null
    try {
      assertPlanFresh(plan, drifted.target)
    } catch (err) {
      error = err
    }
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toMatch(/changed since this plan was reviewed/)
  })

  it('binds the plan digest to the destination snapshot', () => {
    const first = preview({ source: { timesheets: [timesheetRow()] }, target: { timesheets: [] } })
    const second = preview({
      source: { timesheets: [timesheetRow()] },
      target: { timesheets: [timesheetRow({ id: TIMESHEET_TARGET_ID })] },
    })
    expect(first.planDigest).not.toBe(second.planDigest)
    expect(first.target.snapshotDigest).not.toBe(second.target.snapshotDigest)
  })

  it('detects tampering with the resolved plan digests', () => {
    const plan = preview({
      source: {
        profiles: [profileRow({ id: PROFILE_SOURCE_ID, email: 'alice@example.com' })],
        projects: [projectRow({ id: PROJECT_SOURCE_ID, name: 'Support' })],
        timesheets: [timesheetRow({ project_id: PROJECT_SOURCE_ID })],
      },
      target: {
        profiles: [profileRow({ id: PROFILE_TARGET_ID, email: 'alice@example.com' })],
        projects: [projectRow({ id: PROJECT_TARGET_ID, name: 'Support' })],
      },
    })
    const resolved = mustResolve(
      plan,
      decisionFile(plan, [
        { entity: 'profiles', sourceId: PROFILE_SOURCE_ID, action: 'map', destinationId: PROFILE_TARGET_ID, reason: 'same person' },
        { entity: 'projects', sourceId: PROJECT_SOURCE_ID, action: 'map', destinationId: PROJECT_TARGET_ID, reason: 'same project' },
        { entity: 'timesheets', sourceId: TIMESHEET_SOURCE_ID, action: 'create' },
      ])
    )
    expect(verifyResolvedPlan(resolved)).toEqual([])

    const tamperedDigest = { ...resolved, expectedResultDigest: 'f'.repeat(64) }
    expect(verifyResolvedPlan(tamperedDigest).map((issue) => issue.code)).toContain('E_RESULT_DIGEST_MISMATCH')

    const tamperedRows = {
      ...resolved,
      expectedResult: {
        ...resolved.expectedResult,
        timesheets: [
          ...resolved.expectedResult.timesheets,
          canonicalizeRow('timesheets', timesheetRow({ id: 'abcdabcd-abcd-4bcd-8bcd-abcdabcdabcd' })),
        ],
      },
    }
    expect(verifyResolvedPlan(tamperedRows).map((issue) => issue.code)).toContain('E_ENTITY_DIGEST_MISMATCH')

    const tamperedDecisions = {
      ...resolved,
      decisions: {
        ...(resolved.decisions as Record<string, unknown>),
        operator: { name: 'Someone Else', at: NOW },
      },
    }
    expect(verifyResolvedPlan(tamperedDecisions).map((issue) => issue.code)).toContain(
      'E_RESOLUTION_DIGEST_MISMATCH'
    )
  })

  it('reapplies decisions so a self-rehashed expected result cannot pass verification', () => {
    const plan = preview({
      source: {
        profiles: [profileRow({ id: PROFILE_SOURCE_ID, email: 'forged-check@example.com' })],
        projects: [projectRow({ id: PROJECT_SOURCE_ID, name: 'Forged Check' })],
        timesheets: [timesheetRow()],
      },
      target: {},
    })
    const resolved = mustResolve(
      plan,
      decisionFile(plan, [{ entity: 'timesheets', sourceId: TIMESHEET_SOURCE_ID, action: 'create' }])
    )
    const forgedRows = {
      ...resolved.expectedResult,
      timesheets: resolved.expectedResult.timesheets.map((row) => ({ ...row, work_done: 'forged' })),
    }
    const forgedPerEntity = perEntityDigests(forgedRows)
    const forgedExpectedDigest = expectedResultDigest({ perEntityDigest: forgedPerEntity })
    const forged = {
      ...resolved,
      expectedResult: forgedRows,
      perEntityDigest: forgedPerEntity,
      expectedResultDigest: forgedExpectedDigest,
      resolutionDigest: resolutionDigest({
        planDigest: resolved.plan.planDigest,
        decisions: resolved.decisions,
        expectedResultDigest: forgedExpectedDigest,
        idMap: resolved.idMap,
        operator: resolved.operator,
      }),
    }
    expect(verifyResolvedPlan(forged).map((issue) => issue.code)).toContain('E_RESOLVED_EXPECTED_RESULT_MISMATCH')
  })

  it('keeps the destination snapshot digest stable for identical state', () => {
    const rows = { timesheets: [timesheetRow()] }
    expect(deploymentSnapshotDigest(snapshot(rows))).toBe(deploymentSnapshotDigest(snapshot(rows)))
    expect(deploymentSnapshotDigest(snapshot(rows))).not.toBe(
      deploymentSnapshotDigest(snapshot({}, { namespace: 'native:other' }))
    )
  })

  it('binds destination provenance receipts into the snapshot digest', () => {
    const base = snapshot({ timesheets: [] })
    const withReceipt = snapshot(
      { timesheets: [] },
      { receipts: [receipt('timesheets', TIMESHEET_SOURCE_ID, TIMESHEET_TARGET_ID)] }
    )
    expect(deploymentSnapshotDigest(base)).not.toBe(deploymentSnapshotDigest(withReceipt))
  })

  it('binds destination provider and second-factor drift into the snapshot digest', () => {
    const identity = {
      id: PROFILE_TARGET_ID,
      email: 'alice@example.com',
      emailConfirmed: true,
      hasCredential: null,
      providerIdentities: ['email'],
      mfaFactors: 0,
    }
    const base = snapshot({}, { identities: [identity] })
    expect(deploymentSnapshotDigest(snapshot({}, { identities: [{ ...identity }] }))).toBe(
      deploymentSnapshotDigest(base)
    )
    expect(
      deploymentSnapshotDigest(snapshot({}, { identities: [{ ...identity, providerIdentities: ['email', 'google'] }] }))
    ).not.toBe(deploymentSnapshotDigest(base))
    expect(
      deploymentSnapshotDigest(snapshot({}, { identities: [{ ...identity, mfaFactors: 1 }] }))
    ).not.toBe(deploymentSnapshotDigest(base))
  })

  it('treats a plan whose unresolved list was emptied as tampered', () => {
    const plan = preview({
      source: { profiles: [profileRow({ id: PROFILE_SOURCE_ID })] },
      target: { profiles: [profileRow({ id: PROFILE_SOURCE_ID })] },
    })
    expect(plan.unresolved).toHaveLength(1)
    const withoutDigest = { ...plan, unresolved: [] } as Record<string, unknown>
    delete withoutDigest.planDigest
    const tampered = { ...withoutDigest, planDigest: sha256Hex(canonicalStringify(withoutDigest)) } as MergePlan
    const outcome = resolvePlan(tampered, decisionFile(tampered, []))
    expect(outcome.ok).toBe(false)
    expect(outcome.issues.map((issue) => issue.code)).toContain('E_CONFLICT_MISSING')
  })

  it('rejects a plan that drifts on schema fingerprint or application version', () => {
    const contextInput: ContextInput = {
      source: { timesheets: [] },
      target: { timesheets: [] },
    }
    const plan = preview(contextInput)
    const unchanged = context(contextInput)
    expect(() => assertPlanFresh(plan, unchanged.target, { schemaFingerprint: 'a'.repeat(64) })).not.toThrow()
    expect(() =>
      assertPlanFresh(plan, unchanged.target, { schemaFingerprint: 'b'.repeat(64) })
    ).toThrow(/schema fingerprint/)
    expect(() =>
      assertPlanFresh(plan, unchanged.target, { applicationVersion: '1.0.4' })
    ).toThrow(/application version/)
  })

  it('rejects duplicate telegram_no values in the merged result', () => {
    const plan = preview({
      source: {
        projects: [
          projectRow({ id: PROJECT_SOURCE_ID, name: 'Alpha', telegram_no: 94 }),
          projectRow({ id: '20000000-0000-4000-8000-000000000009', name: 'Beta', telegram_no: 94 }),
        ],
      },
      target: { projects: [] },
    })
    const resolved = resolvePlan(
      plan,
      decisionFile(plan, [
        { entity: 'projects', sourceId: PROJECT_SOURCE_ID, action: 'create' },
        { entity: 'projects', sourceId: '20000000-0000-4000-8000-000000000009', action: 'create' },
      ])
    )
    expect(resolved.issues.map((issue) => issue.code)).toContain('E_UNIQUE_VIOLATION')
  })

  it('allows the reference-row "create separately" choice when the unique value stays valid', () => {
    const plan = preview({
      source: { projects: [projectRow({ id: PROJECT_SOURCE_ID, name: 'support', telegram_no: null })] },
      target: { projects: [projectRow({ id: PROJECT_TARGET_ID, name: 'Support', telegram_no: 94 })] },
    })
    const conflict = plan.unresolved[0]
    expect(conflict.destinationId).toBe(PROJECT_TARGET_ID)
    expect(conflict.allowedActions).toContain('create')
    const resolved = mustResolve(
      plan,
      decisionFile(plan, [
        {
          entity: 'projects',
          sourceId: PROJECT_SOURCE_ID,
          action: 'create',
          reason: 'case-different names are distinct projects on this provider',
        },
      ])
    )
    expect(resolved.expectedResult.projects.map((row) => row.name).sort()).toEqual(['Support', 'support'])
  })

  it('allows a reviewed unique-name override for a distinct reference create', () => {
    const plan = preview({
      source: { projects: [projectRow({ id: PROJECT_SOURCE_ID, name: 'Support', telegram_no: null })] },
      target: { projects: [projectRow({ id: PROJECT_TARGET_ID, name: 'Support' })] },
    })
    const resolved = mustResolve(
      plan,
      decisionFile(plan, [
        {
          entity: 'projects',
          sourceId: PROJECT_SOURCE_ID,
          action: 'create',
          overrides: { name: 'Support (Imported)' },
          reason: 'separate project with an approved unique name',
        },
      ])
    )
    expect(resolved.expectedResult.projects.map((row) => row.name).sort()).toEqual(['Support', 'Support (Imported)'])
  })

  it('keeps a multi-row app_settings bundle resolvable through explicit exclusions', () => {
    const plan = preview({
      source: { app_settings: [appSettingsRow(), appSettingsRow({ id: 2 })] },
      target: { app_settings: [] },
    })
    expect(plan.unresolved).toHaveLength(1)
    expect(plan.unresolved[0].allowedActions).toEqual(['exclude'])
    const resolved = mustResolve(
      plan,
      decisionFile(plan, [{ entity: 'app_settings', sourceId: '2', action: 'exclude', reason: 'only the singleton is supported' }])
    )
    expect(resolved.expectedResult.app_settings).toHaveLength(1)
  })

  it('retains every untouched destination entity in the expected result', () => {
    const plan = preview({
      source: { projects: [projectRow({ id: PROJECT_SOURCE_ID, name: 'New' })] },
      target: {
        profiles: [profileRow({ id: PROFILE_TARGET_ID, email: 'existing@example.com' })],
        projects: [projectRow({ id: PROJECT_TARGET_ID, name: 'Existing', telegram_no: null })],
        activity_types: [activityTypeRow()],
        titles: [titleRow()],
        whitelisted_domains: [domainRow()],
        global_reminders: [globalReminderRow()],
        leaves: [leaveRow({ user_id: PROFILE_TARGET_ID })],
        reminders: [reminderRow({ user_id: PROFILE_TARGET_ID })],
        audit_logs: [auditLogRow({ actor_id: PROFILE_TARGET_ID })],
        global_reminder_dismissals: [dismissalRow({ user_id: PROFILE_TARGET_ID })],
        app_settings: [appSettingsRow()],
      },
    })
    const resolved = mustResolve(
      plan,
      decisionFile(plan, [{ entity: 'projects', sourceId: PROJECT_SOURCE_ID, action: 'create' }])
    )
    expect(resolved.expectedResult.projects).toHaveLength(2)
    expect(resolved.expectedResult.activity_types).toHaveLength(1)
    expect(resolved.expectedResult.titles).toHaveLength(1)
    expect(resolved.expectedResult.whitelisted_domains).toHaveLength(1)
    expect(resolved.expectedResult.global_reminders).toHaveLength(1)
    expect(resolved.expectedResult.leaves).toHaveLength(1)
    expect(resolved.expectedResult.reminders).toHaveLength(1)
    expect(resolved.expectedResult.global_reminder_dismissals).toHaveLength(1)
    expect(resolved.expectedResult.audit_logs).toHaveLength(1)
    expect(resolved.expectedResult.app_settings).toHaveLength(1)
  })
})

describe('C01M destination-claim uniqueness', () => {
  const SECOND_SOURCE_ID = '11111111-1111-4111-8111-222222222222'

  it('never proposes the same destination row for two distinct source records', () => {
    const plan = preview({
      source: {
        profiles: [
          profileRow({ id: PROFILE_SOURCE_ID, email: 'shared@example.com', name: 'First' }),
          profileRow({ id: SECOND_SOURCE_ID, email: 'shared@example.com', name: 'Second' }),
        ],
      },
      target: {
        profiles: [profileRow({ id: PROFILE_TARGET_ID, email: 'shared@example.com', name: 'Destination' })],
      },
    })
    const second = plan.entries.find((entry) => entry.entity === 'profiles' && entry.sourceId === SECOND_SOURCE_ID)
    expect(second?.status).toBe('unresolved')
    const conflict = plan.unresolved.find((candidate) => candidate.sourceId === SECOND_SOURCE_ID)
    expect(conflict?.kind).toBe('destination-claimed')
    expect(conflict?.allowedActions).toEqual(['exclude'])
    expect(conflict?.message).toContain(PROFILE_SOURCE_ID)
    // The first record still proposes the mapping; the destination row is not
    // emitted a second time as a retain entry.
    expect(plan.entries.filter((entry) => entry.entity === 'profiles' && entry.destinationId === PROFILE_TARGET_ID)).toHaveLength(2)
  })

  it('rejects reviewed mappings that coalesce two source records into one destination row', () => {
    const plan = preview({
      source: {
        profiles: [
          profileRow({ id: PROFILE_SOURCE_ID, email: 'shared@example.com' }),
          profileRow({ id: SECOND_SOURCE_ID, email: 'other@example.com' }),
        ],
      },
      target: {
        profiles: [
          profileRow({ id: PROFILE_TARGET_ID, email: 'shared@example.com' }),
          profileRow({ id: '10000000-0000-4000-8000-000000000002', email: 'unrelated@example.com' }),
        ],
      },
      receipts: [receipt('profiles', PROFILE_SOURCE_ID, PROFILE_TARGET_ID)],
    })
    const outcome = applyDecisions(resolutionContextOf(plan), plan, {
      records: [
        { entity: 'profiles', sourceId: SECOND_SOURCE_ID, action: 'map', destinationId: PROFILE_TARGET_ID },
      ],
      security: [],
      settings: null,
    })
    expect(outcome.issues.map((issue) => issue.code)).toContain('E_DESTINATION_CLAIMED')
  })

  it('requires a recorded reason when a mapping retargets away from the proposed destination', () => {
    const otherTarget = '10000000-0000-4000-8000-000000000002'
    const plan = preview({
      source: { profiles: [profileRow({ id: PROFILE_SOURCE_ID, email: 'shared@example.com' })] },
      target: {
        profiles: [
          profileRow({ id: PROFILE_TARGET_ID, email: 'shared@example.com' }),
          profileRow({ id: otherTarget, email: 'other@example.com' }),
        ],
      },
    })
    const outcome = applyDecisions(resolutionContextOf(plan), plan, {
      records: [
        { entity: 'profiles', sourceId: PROFILE_SOURCE_ID, action: 'map', destinationId: otherTarget },
      ],
      security: [],
      settings: null,
    })
    expect(outcome.issues.map((issue) => issue.code)).toContain('E_DECISION_REASON_REQUIRED')
    const reasoned = applyDecisions(resolutionContextOf(plan), plan, {
      records: [
        { entity: 'profiles', sourceId: PROFILE_SOURCE_ID, action: 'map', destinationId: otherTarget, reason: 'operator-confirmed identity evidence' },
      ],
      security: [],
      settings: null,
    })
    expect(reasoned.issues).toHaveLength(0)
  })

  it('resolves a claimed contender by explicit exclusion with a reason', () => {
    const plan = preview({
      source: {
        profiles: [
          profileRow({ id: PROFILE_SOURCE_ID, email: 'shared@example.com', name: 'First' }),
          profileRow({ id: SECOND_SOURCE_ID, email: 'shared@example.com', name: 'Second' }),
        ],
      },
      target: {
        profiles: [profileRow({ id: PROFILE_TARGET_ID, email: 'shared@example.com', name: 'Destination' })],
      },
    })
    const application = applyDecisions(resolutionContextOf(plan), plan, {
      records: [
        { entity: 'profiles', sourceId: PROFILE_SOURCE_ID, action: 'map', destinationId: PROFILE_TARGET_ID, reason: 'confirmed identity evidence' },
        { entity: 'profiles', sourceId: SECOND_SOURCE_ID, action: 'exclude', reason: 'confirmed duplicate of the first source record' },
      ],
      security: [],
      settings: null,
    })
    expect(application.issues).toHaveLength(0)
    expect(application.expected.exclusions).toEqual([
      { entity: 'profiles', sourceId: SECOND_SOURCE_ID, reason: 'confirmed duplicate of the first source record' },
    ])
    expect(application.expected.rows.profiles).toHaveLength(1)
  })
})

describe('C01M provider-aware merged-state invariants', () => {
  function expectedWithTitles(): ExpectedResult {
    return {
      rows: {
        ...Object.fromEntries(ENTITY_ORDER.map((entity) => [entity, []])),
        titles: [
          titleRow({ id: '20000000-0000-4000-8000-0000000000a1', name: 'Support' }),
          titleRow({ id: '20000000-0000-4000-8000-0000000000a2', name: 'support' }),
        ],
      } as ExpectedResult['rows'],
      idMap: {} as ExpectedResult['idMap'],
      exclusions: [],
      perEntityDigest: {} as ExpectedResult['perEntityDigest'],
      digest: '',
    }
  }

  it('enforces case-insensitive title uniqueness for native destinations', () => {
    const issues = validateMergedState(expectedWithTitles(), [], { provider: 'native' })
    expect(issues.map((issue) => issue.code)).toContain('E_UNIQUE_VIOLATION')
  })

  it('allows case-different title names for supabase destinations (exact-name unique only)', () => {
    const issues = validateMergedState(expectedWithTitles(), [], { provider: 'supabase' })
    expect(issues).toHaveLength(0)
  })
})

describe('C01M exact hour arithmetic', () => {
  it('sums merged hours across scales without float loss and rejects unsupported precision', () => {
    const userId = PROFILE_TARGET_ID
    const rows = {
      ...Object.fromEntries(ENTITY_ORDER.map((entity) => [entity, []])),
      timesheets: [
        timesheetRow({ id: 't-a', user_id: userId, hours_worked: '23.995' }),
        timesheetRow({ id: 't-b', user_id: userId, hours_worked: '0.006' }),
      ],
    } as ExpectedResult['rows']
    const exact = validateMergedState({
      rows,
      idMap: {},
      exclusions: [],
      perEntityDigest: {},
      digest: '',
    } as unknown as ExpectedResult)
    expect(exact.map((issue) => issue.code)).toContain('E_DAILY_HOURS_CAP')
    expect(exact.find((issue) => issue.code === 'E_DAILY_HOURS_CAP')?.message).toContain('24.001')

    const overScale = {
      ...rows,
      timesheets: [timesheetRow({ id: 't-c', user_id: userId, hours_worked: '7.0000001' })],
    } as ExpectedResult['rows']
    const invalid = validateMergedState({
      rows: overScale,
      idMap: {},
      exclusions: [],
      perEntityDigest: {},
      digest: '',
    } as unknown as ExpectedResult)
    expect(invalid.map((issue) => issue.code)).toContain('E_VALUE_INVALID')
  })
})

describe('C01M conflict-kind schema coverage', () => {
  // The regression guard for the `destination-claimed` defect: a plan the
  // planner produced failed its own resolution schema (E_PLAN_SCHEMA). The
  // schema enum is derived from CONFLICT_KINDS, and this type assertion fails
  // typecheck if the schema is ever narrowed back to a partial literal list.
  type SchemaConflictKind = z.infer<typeof unresolvedConflictSchema>['kind']
  const everyKindIsCovered: Exclude<ConflictKind, SchemaConflictKind> extends never ? true : never = true

  it('accepts every conflict kind the planner can emit, and rejects unknown ones', () => {
    expect(everyKindIsCovered).toBe(true)
    for (const kind of CONFLICT_KINDS) {
      const parsed = unresolvedConflictSchema.safeParse({
        entity: 'projects',
        sourceId: '00000000-0000-4000-8000-000000000001',
        destinationId: null,
        kind,
        message: 'review item',
        allowedActions: ['exclude'],
        evidence: ['uuid'],
      })
      expect(parsed.success, `${kind} must be accepted by the resolution schema`).toBe(true)
    }
    expect(
      unresolvedConflictSchema.safeParse({
        entity: 'projects',
        sourceId: '00000000-0000-4000-8000-000000000001',
        destinationId: null,
        kind: 'not-a-conflict-kind',
        message: 'review item',
        allowedActions: ['exclude'],
        evidence: ['uuid'],
      }).success
    ).toBe(false)
  })
})

describe('C01M artifact contract enforcement', () => {
  it('refuses a plan generated under an older matching-rules version', () => {
    const plan = preview({
      source: { projects: [projectRow({ id: PROJECT_SOURCE_ID, name: 'New Project' })] },
      target: {},
    })
    const older = { ...plan, matchingRulesVersion: plan.matchingRulesVersion - 1 }
    delete (older as Record<string, unknown>).planDigest
    const withDigest = { ...older, planDigest: sha256Hex(canonicalStringify(older)) } as MergePlan

    const outcome = resolvePlan(
      withDigest,
      decisionFile(withDigest, [{ entity: 'projects', sourceId: PROJECT_SOURCE_ID, action: 'create' }])
    )
    expect(outcome.ok).toBe(false)
    expect(outcome.issues.map((issue) => issue.code)).toContain('E_MATCHING_RULES_UNSUPPORTED')
  })

  it('binds the reviewed operator and timestamp into the resolution digest', () => {
    const plan = preview({
      source: { projects: [projectRow({ id: PROJECT_SOURCE_ID, name: 'New Project' })] },
      target: {},
    })
    const resolved = mustResolve(
      plan,
      decisionFile(plan, [{ entity: 'projects', sourceId: PROJECT_SOURCE_ID, action: 'create' }])
    )
    expect(verifyResolvedPlan(resolved).map((issue) => issue.code)).toEqual([])

    // Editing the recorded operator without recomputing the digest must fail.
    const edited = { ...resolved, operator: { ...resolved.operator, name: 'someone-else' } }
    expect(verifyResolvedPlan(edited).map((issue) => issue.code)).toContain('E_RESOLUTION_DIGEST_MISMATCH')

    // Recomputing the digest must not make a top-level operator swap valid;
    // the operator is reviewed in the decision file as well.
    const forgedOperator = { ...resolved.operator, name: 'someone-else' }
    const forged = {
      ...resolved,
      operator: forgedOperator,
      resolutionDigest: resolutionDigest({
        planDigest: resolved.plan.planDigest,
        decisions: resolved.decisions,
        expectedResultDigest: resolved.expectedResultDigest,
        idMap: resolved.idMap,
        operator: forgedOperator,
      }),
    }
    expect(verifyResolvedPlan(forged).map((issue) => issue.code)).toContain('E_RESOLVED_OPERATOR_MISMATCH')
  })

  it('rejects a plan whose embedded destination snapshot was edited', () => {
    const plan = preview({
      source: { projects: [projectRow({ id: PROJECT_SOURCE_ID, name: 'New Project' })] },
      target: {},
    })
    const edited = {
      ...plan,
      snapshot: {
        ...plan.snapshot,
        targetRows: {
          ...plan.snapshot.targetRows,
          projects: [canonicalizeRow('projects', projectRow({ id: PROJECT_TARGET_ID, name: 'Injected Row' }))],
        },
      },
    }
    delete (edited as Record<string, unknown>).planDigest
    const rehashed = { ...edited, planDigest: sha256Hex(canonicalStringify(edited)) } as MergePlan

    const outcome = resolvePlan(
      rehashed,
      decisionFile(rehashed, [{ entity: 'projects', sourceId: PROJECT_SOURCE_ID, action: 'create' }])
    )
    expect(outcome.ok).toBe(false)
    expect(outcome.issues.map((issue) => issue.code)).toContain('E_SNAPSHOT_DIGEST_MISMATCH')
  })

  it('flags a resolved plan whose embedded snapshot no longer matches its digest', () => {
    const plan = preview({
      source: { projects: [projectRow({ id: PROJECT_SOURCE_ID, name: 'New Project' })] },
      target: {},
    })
    const resolved = mustResolve(
      plan,
      decisionFile(plan, [{ entity: 'projects', sourceId: PROJECT_SOURCE_ID, action: 'create' }])
    )
    const tampered = {
      ...resolved,
      plan: {
        ...resolved.plan,
        snapshot: {
          ...resolved.plan.snapshot,
          targetRows: {
            ...resolved.plan.snapshot.targetRows,
            projects: [canonicalizeRow('projects', projectRow({ id: PROJECT_TARGET_ID, name: 'Injected Row' }))],
          },
        },
      },
    }
    expect(verifyResolvedPlan(tampered).map((issue) => issue.code)).toContain('E_SNAPSHOT_DIGEST_MISMATCH')
  })

  it('refuses settings selections when the source singleton is excluded', () => {
    const plan = preview({
      source: { app_settings: [appSettingsRow({ app_name: 'Source Name' })] },
      target: { app_settings: [appSettingsRow({ app_name: 'Destination Name' })] },
    })
    const outcome = resolvePlan(
      plan,
      decisionFile(plan, [{ entity: 'app_settings', sourceId: '1', action: 'exclude' }], {
        settings: { app_name: 'source' },
      })
    )
    expect(outcome.ok).toBe(false)
    expect(outcome.issues.map((issue) => issue.code)).toContain('E_SETTINGS_EXCLUDED')
  })

  it('proposes one create and one exclusion per extra app_settings row', () => {
    const plan = preview({
      source: {
        app_settings: [appSettingsRow({ id: 1 }), appSettingsRow({ id: 2, app_name: 'Second' })],
      },
      target: {},
    })
    const settingsEntries = plan.entries
      .filter((entry) => entry.entity === 'app_settings')
      .map((entry) => `${entry.sourceId}:${entry.action}`)
      .sort()
    expect(settingsEntries).toEqual(['1:create', '2:exclude'])
    expect(plan.counts.app_settings.create).toBe(1)
    expect(plan.counts.app_settings.unresolved).toBe(1)
  })

  it('rejects merged values that are not canonical under the bundle contract', () => {
    const rows = {
      ...Object.fromEntries(ENTITY_ORDER.map((entity) => [entity, []])),
      timesheets: [timesheetRow({ id: 't-bad-date', log_date: '2026-02-31' })],
    } as ExpectedResult['rows']
    const issues = validateMergedState({
      rows,
      idMap: {},
      exclusions: [],
      perEntityDigest: {},
      digest: '',
    } as unknown as ExpectedResult)
    expect(issues.map((issue) => issue.code)).toContain('E_VALUE_INVALID')
  })
})
// tools/migration/tests/migration-merge-plan.test.ts
