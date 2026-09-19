// lib/migration/matching.ts
// Candidate discovery for a merge into a populated destination.
//
// Deliberately separate from confirmed mapping: a shared UUID, normalized email
// or display name is EVIDENCE, never an identity assertion. Only verified
// provenance aliases recorded by a prior reviewed run are treated as confirmed.
// Distinct records that merely look equal are never coalesced here.

import { primaryKeyOf, type CanonicalRow, type MigrationEntity, type ProvenanceAlias } from './format'

export const MATCHING_RULES_VERSION = 1

export type MatchEvidence =
  | 'prior-alias'
  | 'uuid'
  | 'normalized-email'
  | 'display-name'
  | 'unique-key'
  | 'unique-key-case-differs'
  | 'single-row'

export type MatchStatus = 'confirmed' | 'candidate' | 'collision' | 'none'

export interface RecordMatch {
  entity: MigrationEntity
  sourceId: string
  destinationId: string | null
  status: MatchStatus
  evidence: MatchEvidence[]
  detail: string | null
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

const UNIQUE_KEY: Partial<Record<MigrationEntity, string>> = {
  projects: 'name',
  activity_types: 'name',
  titles: 'name',
  whitelisted_domains: 'domain',
}

function aliasIndex(
  aliases: ProvenanceAlias[],
  entity: MigrationEntity,
  destinationNamespace: string
): Map<string, string> {
  const index = new Map<string, string>()
  for (const alias of aliases) {
    if (alias.entity !== entity) continue
    if (alias.instanceNamespace !== destinationNamespace) continue
    index.set(alias.sourceId, alias.destinationId)
  }
  return index
}

export interface MatchInput {
  entity: MigrationEntity
  sourceRows: CanonicalRow[]
  destinationRows: CanonicalRow[]
  aliases: ProvenanceAlias[]
  /** Namespace of the destination deployment the aliases must refer to. */
  destinationNamespace: string
}

export function matchRecords(input: MatchInput): RecordMatch[] {
  const { entity, sourceRows, destinationRows, aliases, destinationNamespace } = input
  const byKey = new Map(destinationRows.map((row) => [primaryKeyOf(entity, row), row]))
  const prior = aliasIndex(aliases, entity, destinationNamespace)

  if (entity === 'profiles') {
    const byEmail = new Map<string, CanonicalRow[]>()
    const byName = new Map<string, CanonicalRow[]>()
    for (const row of destinationRows) {
      const email = typeof row.email === 'string' ? normalizeEmail(row.email) : null
      if (email) byEmail.set(email, [...(byEmail.get(email) ?? []), row])
      const name = typeof row.name === 'string' ? row.name : null
      if (name) byName.set(name, [...(byName.get(name) ?? []), row])
    }
    return sourceRows.map((row) => {
      const sourceId = primaryKeyOf(entity, row)
      const email = typeof row.email === 'string' ? normalizeEmail(row.email) : null
      const aliasTarget = prior.get(sourceId)
      if (aliasTarget && byKey.has(aliasTarget)) return confirmed(entity, sourceId, aliasTarget)
      if (aliasTarget) return staleAlias(entity, sourceId, aliasTarget)
      const sameId = byKey.get(sourceId)
      if (sameId) {
        const destEmail = typeof sameId.email === 'string' ? normalizeEmail(sameId.email) : null
        if (email && destEmail && email === destEmail) {
          return {
            entity,
            sourceId,
            destinationId: sourceId,
            status: 'candidate',
            evidence: ['uuid', 'normalized-email'],
            detail: 'Same UUID and normalized email; identity mapping requires explicit confirmation.',
          }
        }
        return {
          entity,
          sourceId,
          destinationId: sourceId,
          status: 'collision',
          evidence: ['uuid'],
          detail: `Destination profile ${sourceId} has a different email (${destEmail ?? 'none'}).`,
        }
      }
      const emailMatches = email ? (byEmail.get(email) ?? []) : []
      if (emailMatches.length === 1) {
        return {
          entity,
          sourceId,
          destinationId: primaryKeyOf(entity, emailMatches[0]),
          status: 'candidate',
          evidence: ['normalized-email'],
          detail: 'Another destination account owns this normalized email; distinct people may share it.',
        }
      }
      if (emailMatches.length > 1) {
        return {
          entity,
          sourceId,
          destinationId: null,
          status: 'collision',
          evidence: ['normalized-email'],
          detail: `Multiple destination accounts share the normalized email (${emailMatches.length}); email alone cannot link an account here.`,
        }
      }
      const name = typeof row.name === 'string' ? row.name : null
      const nameMatches = name ? (byName.get(name) ?? []) : []
      if (nameMatches.length > 0) {
        return {
          entity,
          sourceId,
          destinationId: primaryKeyOf(entity, nameMatches[0]),
          status: 'candidate',
          evidence: ['display-name'],
          detail: 'Only a display name matches; names are not sufficient identity evidence.',
        }
      }
      return { entity, sourceId, destinationId: null, status: 'none', evidence: [], detail: null }
    })
  }

  if (entity === 'app_settings') {
    const destinationRow = destinationRows[0] ?? null
    return sourceRows.map((row) => ({
      entity,
      sourceId: primaryKeyOf(entity, row),
      destinationId: destinationRow ? primaryKeyOf(entity, destinationRow) : null,
      status: destinationRow ? ('candidate' as const) : ('none' as const),
      evidence: destinationRow ? (['single-row'] as MatchEvidence[]) : [],
      detail: destinationRow
        ? 'Destination singleton exists; per-field resolution decides whose values survive.'
        : null,
    }))
  }

  const uniqueColumn = UNIQUE_KEY[entity]
  if (uniqueColumn) {
    const byValue = new Map<string, CanonicalRow[]>()
    const byValueLower = new Map<string, CanonicalRow[]>()
    for (const row of destinationRows) {
      const value = row[uniqueColumn]
      if (typeof value !== 'string') continue
      byValue.set(value, [...(byValue.get(value) ?? []), row])
      const lower = value.toLowerCase()
      byValueLower.set(lower, [...(byValueLower.get(lower) ?? []), row])
    }
    return sourceRows.map((row) => {
      const sourceId = primaryKeyOf(entity, row)
      const aliasTarget = prior.get(sourceId)
      if (aliasTarget && byKey.has(aliasTarget)) return confirmed(entity, sourceId, aliasTarget)
      if (aliasTarget) return staleAlias(entity, sourceId, aliasTarget)
      const sameId = byKey.get(sourceId)
      if (sameId) {
        return {
          entity,
          sourceId,
          destinationId: sourceId,
          status: 'candidate',
          evidence: ['uuid'],
          detail: 'A destination row already uses this UUID.',
        }
      }
      const value = row[uniqueColumn]
      if (typeof value === 'string') {
        const exact = byValue.get(value) ?? []
        if (exact.length > 0) {
          return {
            entity,
            sourceId,
            destinationId: primaryKeyOf(entity, exact[0]),
            status: 'candidate',
            evidence: ['unique-key'],
            detail: `Destination already has ${uniqueColumn} "${value}"; a second row cannot keep the same unique value.`,
          }
        }
        const lower = byValueLower.get(value.toLowerCase()) ?? []
        if (lower.length > 0) {
          return {
            entity,
            sourceId,
            destinationId: primaryKeyOf(entity, lower[0]),
            status: 'candidate',
            evidence: ['unique-key-case-differs'],
            detail: `Destination has the case-different ${uniqueColumn} "${String(lower[0][uniqueColumn])}".`,
          }
        }
      }
      return { entity, sourceId, destinationId: null, status: 'none', evidence: [], detail: null }
    })
  }

  // Work data and history: only verified provenance or an existing UUID row can
  // say anything; equal displayed values are deliberately not evidence.
  return sourceRows.map((row) => {
    const sourceId = primaryKeyOf(entity, row)
    const aliasTarget = prior.get(sourceId)
    if (aliasTarget && byKey.has(aliasTarget)) return confirmed(entity, sourceId, aliasTarget)
    if (aliasTarget) return staleAlias(entity, sourceId, aliasTarget)
    if (byKey.has(sourceId)) {
      return {
        entity,
        sourceId,
        destinationId: sourceId,
        status: 'candidate',
        evidence: ['uuid'],
        detail: 'A destination row already uses this record identity; it may be the same record or a different one.',
      }
    }
    return { entity, sourceId, destinationId: null, status: 'none', evidence: [], detail: null }
  })
}

function confirmed(entity: MigrationEntity, sourceId: string, destinationId: string): RecordMatch {
  return {
    entity,
    sourceId,
    destinationId,
    status: 'confirmed',
    evidence: ['prior-alias'],
    detail: 'Verified provenance from a prior reviewed run.',
  }
}

function staleAlias(entity: MigrationEntity, sourceId: string, destinationId: string): RecordMatch {
  return {
    entity,
    sourceId,
    destinationId: null,
    status: 'collision',
    evidence: ['prior-alias'],
    detail: `Prior alias points at destination ${entity} ${destinationId}, which no longer exists.`,
  }
}
