import { ENTITY_ORDER, canonicalizeRow, type CanonicalRow, type MigrationEntity } from '@vsis/migration-tool/format'
import { buildPreview, type RecordDecision, type SecurityDecision } from '@vsis/migration-tool/merge-plan'
import type { DeploymentSnapshot } from '@vsis/migration-tool/providers/read'
import { RESOLUTIONS_FORMAT, RESOLUTIONS_FORMAT_VERSION, resolvePlan } from '@vsis/migration-tool/resolutions'
import { computeSchemaFingerprint, type CatalogInspection } from '@vsis/migration-tool/schema'
import { activityTypeRow, makeManifest, projectRow } from './migration-fixtures'

export const REFERENCE_RUN = 'reference-merge-run'
export const REFERENCE_NOW = '2026-09-19T10:00:00.000000Z'
export const referenceId = (n: number) => `c0800000-0000-4000-8000-${String(n).padStart(12, '0')}`
export type ReferenceEntity = 'projects' | 'activity_types'

export function referenceRow(entity: ReferenceEntity, n: number, telegram: number | null): CanonicalRow {
  const make = entity === 'projects' ? projectRow : activityTypeRow
  return canonicalizeRow(entity, make({ id: referenceId(n), name: `Reference ${n}`, telegram_no: telegram }))
}

export function emptyRows(): Record<MigrationEntity, CanonicalRow[]> {
  const rows = {} as Record<MigrationEntity, CanonicalRow[]>
  for (const entity of ENTITY_ORDER) rows[entity] = []
  return rows
}

export function referenceCase(entity: ReferenceEntity, mode: 'reuse' | 'swap' | 'duplicate') {
  const baseline = [referenceRow(entity, 1, 10), referenceRow(entity, 2, 20), referenceRow(entity, 3, 30), referenceRow(entity, 4, 40)]
  const source = [referenceRow(entity, 11, mode === 'reuse' ? 50 : 20), referenceRow(entity, 13, 30)]
  source[0].name = 'Reviewed name'
  const decisions: RecordDecision[] = [
    { entity, sourceId: referenceId(11), action: 'map', destinationId: referenceId(1), fields: { name: 'source', telegram_no: 'source' } },
    { entity, sourceId: referenceId(13), action: 'map', destinationId: referenceId(3) },
  ]
  if (mode === 'reuse') {
    source.push(referenceRow(entity, 12, 10))
    decisions.push({ entity, sourceId: referenceId(12), action: 'create' })
  } else if (mode === 'swap') {
    source.push(referenceRow(entity, 12, 10))
    decisions.push({ entity, sourceId: referenceId(12), action: 'map', destinationId: referenceId(2), fields: { telegram_no: 'source' } })
  }
  return { baseline, source, decisions }
}

export function resolveReference(
  target: DeploymentSnapshot,
  catalog: CatalogInspection,
  sourceRows: Record<MigrationEntity, CanonicalRow[]>,
  decisions: RecordDecision[],
  security: SecurityDecision[] = []
) {
  const plan = buildPreview({
    manifest: makeManifest(),
    provenance: decisions.filter((decision) => decision.destinationId).map((decision) => ({
      entity: decision.entity, sourceId: decision.sourceId, destinationId: decision.destinationId!,
      instanceNamespace: target.namespace, recordedAt: REFERENCE_NOW,
    })),
    sourceRows, target,
    targetApplicationVersion: '1.0.3',
    targetSchemaFingerprint: computeSchemaFingerprint(catalog, 'native'),
  }, { runId: 'reference-planning-run', createdAt: REFERENCE_NOW })
  return resolvePlan(plan, {
    format: RESOLUTIONS_FORMAT, formatVersion: RESOLUTIONS_FORMAT_VERSION,
    planDigest: plan.planDigest, operator: { name: 'Test operator', at: REFERENCE_NOW },
    decisions: decisions.map((decision) => ({ reason: 'reviewed test choice', ...decision })), security,
  })
}
