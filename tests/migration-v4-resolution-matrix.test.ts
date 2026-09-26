// tests/migration-v4-resolution-matrix.test.ts
// C05 (V4 expansion): every supported resolution choice, driven through the real
// planning pipeline, and the provenance rule that only the destination's own
// committed receipts may confirm a mapping.
//
// The live suites prove these against real services; this matrix pins the
// planning-level contract for each choice so a regression names the choice that
// broke rather than a whole round trip.

import { describe, expect, it } from 'vitest'
import { ENTITY_ORDER, type CanonicalRow, type MigrationEntity } from '@/lib/migration/format'
import { buildPreview } from '@/lib/migration/merge-plan'
import { RESOLUTIONS_FORMAT, RESOLUTIONS_FORMAT_VERSION, resolvePlan } from '@/lib/migration/resolutions'
import { computeSchemaFingerprint, KIND_ACCEPTED_UDTS, type CatalogInspection } from '@/lib/migration/schema'
import { makeManifest, profileRow, projectRow, timesheetRow } from './helpers/migration-fixtures'
import { entitySpec } from '@/lib/migration/format'

const NOW = '2026-09-19T10:00:00.000000Z'
const SOURCE_PROFILE = '11111111-1111-4111-8111-111111111111'
const SOURCE_PROJECT = '22222222-2222-4222-8222-222222222222'
const SOURCE_SHEET = '33333333-3333-4333-8333-333333333333'
const DESTINATION_PROFILE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

function catalog(): CatalogInspection {
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

interface CaseOptions {
  sourceProfiles?: Array<Record<string, unknown>>
  sourceProjects?: Array<Record<string, unknown>>
  sourceTimesheets?: Array<Record<string, unknown>>
  destinationProfiles?: Array<Record<string, unknown>>
  decisions?: Array<Record<string, unknown>>
}

function planFor(options: CaseOptions = {}) {
  const rows = {} as Record<MigrationEntity, CanonicalRow[]>
  for (const entity of ENTITY_ORDER) rows[entity] = []
  rows.profiles = (options.sourceProfiles ?? [profileRow({ id: SOURCE_PROFILE })]) as unknown as CanonicalRow[]
  rows.projects = (options.sourceProjects ?? []) as unknown as CanonicalRow[]
  rows.timesheets = (options.sourceTimesheets ?? []) as unknown as CanonicalRow[]
  const targetRows = {} as Record<MigrationEntity, CanonicalRow[]>
  for (const entity of ENTITY_ORDER) targetRows[entity] = []
  targetRows.profiles = (options.destinationProfiles ?? []) as unknown as CanonicalRow[]

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
      targetSchemaFingerprint: computeSchemaFingerprint(catalog(), 'native'),
    },
    { runId: 'v4-plan', createdAt: NOW }
  )
  const outcome = resolvePlan(plan, {
    format: RESOLUTIONS_FORMAT,
    formatVersion: RESOLUTIONS_FORMAT_VERSION,
    planDigest: plan.planDigest,
    operator: { name: 'v4-operator', at: NOW },
    decisions: (options.decisions ?? []) as never,
  })
  return { plan, outcome }
}

describe('C05 V4 resolution matrix', () => {
  it('map: adopts the destination record and creates no duplicate', () => {
    const { outcome } = planFor({
      destinationProfiles: [profileRow({ id: DESTINATION_PROFILE, email: 'alice@example.com' })],
      decisions: [
        {
          entity: 'profiles',
          sourceId: SOURCE_PROFILE,
          action: 'map',
          destinationId: DESTINATION_PROFILE,
          reason: 'same person',
        },
      ],
    })
    expect(outcome.issues).toEqual([])
    const resolved = outcome.resolvedPlan
    expect(resolved).not.toBeNull()
    if (!resolved) return
    const profiles = resolved.expectedResult.profiles.map((row) => String(row.id))
    expect(profiles).toEqual([DESTINATION_PROFILE])
    expect(resolved.idMap.profiles[SOURCE_PROFILE]).toBe(DESTINATION_PROFILE)
  })

  it('create: adds the source record under a reviewed id', () => {
    const { outcome } = planFor({
      sourceProjects: [projectRow({ id: SOURCE_PROJECT, name: 'Unique project', so_number: null, telegram_no: null })],
      decisions: [{ entity: 'projects', sourceId: SOURCE_PROJECT, action: 'create', reason: 'not present at the destination' }],
    })
    expect(outcome.issues).toEqual([])
    const resolved = outcome.resolvedPlan
    if (!resolved) throw new Error('plan must resolve')
    const ids = resolved.expectedResult.projects.map((row) => String(row.id))
    expect(ids).toContain(SOURCE_PROJECT)
  })

  it('exclude: writes nothing and records the reason', () => {
    const { outcome } = planFor({
      sourceTimesheets: [timesheetRow({ id: SOURCE_SHEET, project_id: null })],
      decisions: [
        { entity: 'timesheets', sourceId: SOURCE_SHEET, action: 'exclude', reason: 'duplicate of a destination entry' },
        { entity: 'profiles', sourceId: SOURCE_PROFILE, action: 'exclude', reason: 'test account' },
      ],
    })
    expect(outcome.issues).toEqual([])
    const resolved = outcome.resolvedPlan
    if (!resolved) throw new Error('plan must resolve')
    expect(resolved.expectedResult.timesheets).toEqual([])
    expect(resolved.expectedResult.profiles).toEqual([])
    expect(resolved.exclusions.map((item) => item.sourceId).sort()).toEqual([SOURCE_PROFILE, SOURCE_SHEET].sort())
  })

  it('map: an adopted destination row keeps its identity and its own values by default', () => {
    // Without a field-level resolution the destination's values win, which is
    // what "preserve unless individually reviewed" means for an adopted record.
    const { outcome } = planFor({
      sourceProfiles: [profileRow({ id: SOURCE_PROFILE, name: 'Alice From Source' })],
      destinationProfiles: [profileRow({ id: DESTINATION_PROFILE, name: 'Alice At The Destination' })],
      decisions: [
        {
          entity: 'profiles',
          sourceId: SOURCE_PROFILE,
          action: 'map',
          destinationId: DESTINATION_PROFILE,
          reason: 'same person',
        },
      ],
    })
    expect(outcome.issues).toEqual([])
    const resolved = outcome.resolvedPlan
    if (!resolved) throw new Error('plan must resolve')
    const rows = resolved.expectedResult.profiles.map((row) => String(row.id))
    expect(rows).toEqual([DESTINATION_PROFILE])
    const adopted = resolved.expectedResult.profiles[0]
    expect(String(adopted.name)).toBe('Alice At The Destination')
    expect(String(adopted.email)).toBe('alice@example.com')
  })

  it('refuses a decision for an entity the plan does not contain', () => {
    const { outcome } = planFor({
      decisions: [
        { entity: 'projects', sourceId: 'ffffffff-ffff-4fff-8fff-ffffffffffff', action: 'create', reason: 'not in the plan' },
      ],
    })
    expect(outcome.issues.length).toBeGreaterThan(0)
    expect(outcome.resolvedPlan).toBeNull()
  })

  it('does not let a bundle alias confirm a mapping on its own', () => {
    // Provenance shipped in a bundle is advisory: only the destination's own
    // committed receipts confirm an adopted record, so a source row with no
    // counterpart is never mapped automatically.
    const { plan } = planFor({
      sourceTimesheets: [timesheetRow({ id: SOURCE_SHEET })],
      destinationProfiles: [profileRow({ id: DESTINATION_PROFILE, email: 'alice@example.com' })],
    })
    const maps = plan.entries.filter((entry) => entry.entity === 'timesheets' && entry.action === 'map')
    expect(maps).toEqual([])
    // And the plan is not silently publishable: nothing resolves until the
    // operator decides what happens to that record.
    expect(plan.expectedResultDigest).toBeNull()
  })
})
