// migrations/tool/src/matching.ts
// Candidate discovery for a merge into a populated destination.
//
// Bundle provenance is operator input. Its shape and digest are useful for
// detecting malformed artifacts, but they do not prove that the destination
// ever accepted the mapping. Only destination-local receipt rows, joined to a
// committed migration run by the caller, can produce a confirmed match.
//
// Deliberately separate pure candidate discovery from confirmed mapping:
// shared UUIDs, normalized emails and display names are evidence, never an
// identity assertion. Distinct records that merely look equal are never
// coalesced here.

import { primaryKeyOf, type CanonicalRow, type MigrationEntity, type ProvenanceAlias } from './format'

/** Bump whenever provenance trust or candidate semantics change. */
export const MATCHING_RULES_VERSION = 2

export type MatchEvidence =
  | 'prior-alias'
  | 'uuid'
  | 'normalized-email'
  | 'display-name'
  | 'unique-key'
  | 'unique-key-case-differs'
  | 'single-row'
  | 'untrusted-provenance'
  | 'ambiguous-provenance'
  | 'destination-claimed'

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

/**
 * The only provenance records accepted as confirmation by this module.
 *
 * A caller must obtain these values from the destination's
 * `migration_record_map` joined to `migration_runs` and must not construct
 * them from `provenance.json`. The literal kind makes the trust boundary
 * explicit in code and prevents a `ProvenanceAlias` from being passed by
 * accident. Runtime checks below still fail closed if a caller supplies an
 * incomplete or ineligible row.
 */
export interface DestinationProvenanceReceipt {
  readonly kind: 'destination-receipt'
  readonly sourceNamespace: string
  readonly targetNamespace: string
  readonly entity: MigrationEntity
  readonly sourceId: string
  readonly destinationId: string
  readonly runId: string
  readonly state: 'data-committed' | 'verified' | 'publication-intent' | 'writable'
}

interface AliasIndex {
  /** A unique, destination-scoped bundle alias for a source row. */
  readonly bySource: Map<string, ProvenanceAlias>
  /** Source IDs whose bundle aliases are duplicated. */
  readonly rejectedSources: Map<string, string>
}

interface ReceiptIndex {
  /** A unique, source/target-scoped destination receipt for a source row. */
  readonly bySource: Map<string, DestinationProvenanceReceipt>
  /** Source IDs whose receipt input is malformed or ambiguous. */
  readonly rejectedSources: Map<string, string>
}

function sourceKey(entity: MigrationEntity, sourceId: string): string {
  return `${entity}\u0000${sourceId}`
}

function aliasIndex(
  aliases: readonly ProvenanceAlias[],
  entity: MigrationEntity,
  destinationNamespace: string
): AliasIndex {
  const bySourceCandidates = new Map<string, ProvenanceAlias[]>()
  for (const alias of aliases) {
    if (alias.entity !== entity) continue
    if (alias.instanceNamespace !== destinationNamespace) continue
    const key = sourceKey(entity, alias.sourceId)
    bySourceCandidates.set(key, [...(bySourceCandidates.get(key) ?? []), alias])
  }

  const bySource = new Map<string, ProvenanceAlias>()
  const rejectedSources = new Map<string, string>()
  for (const [key, candidates] of bySourceCandidates) {
    if (candidates.length !== 1) {
      rejectedSources.set(
        key,
        `Bundle provenance contains ${candidates.length} aliases for ${entity} ${candidates[0]?.sourceId ?? 'unknown'}; the mapping is ambiguous.`,
      )
      continue
    }
    bySource.set(key, candidates[0])
  }

  return { bySource, rejectedSources }
}

function receiptIndex(
  receipts: readonly DestinationProvenanceReceipt[] | undefined,
  entity: MigrationEntity,
  sourceNamespace: string,
  destinationNamespace: string
): ReceiptIndex {
  const bySourceCandidates = new Map<string, DestinationProvenanceReceipt[]>()
  const rejectedSources = new Map<string, string>()

  for (const receipt of receipts ?? []) {
    // Rows for another source instance or another target are valid data for a
    // different plan. They must not affect this plan's mapping decisions.
    if (!receipt || receipt.entity !== entity) continue
    if (receipt.sourceNamespace !== sourceNamespace || receipt.targetNamespace !== destinationNamespace) continue

    const key = sourceKey(entity, receipt.sourceId)
    const malformed =
      receipt.kind !== 'destination-receipt' ||
      typeof receipt.sourceId !== 'string' ||
      receipt.sourceId.length === 0 ||
      typeof receipt.destinationId !== 'string' ||
      receipt.destinationId.length === 0 ||
      typeof receipt.runId !== 'string' ||
      receipt.runId.length === 0 ||
      (receipt.state !== 'data-committed' && receipt.state !== 'verified' && receipt.state !== 'publication-intent' && receipt.state !== 'writable')
    if (malformed) {
      rejectedSources.set(key, `Destination provenance receipt for ${entity} ${receipt.sourceId || 'unknown'} is incomplete or not committed.`)
      continue
    }
    bySourceCandidates.set(key, [...(bySourceCandidates.get(key) ?? []), receipt])
  }

  const bySource = new Map<string, DestinationProvenanceReceipt>()
  for (const [key, candidates] of bySourceCandidates) {
    if (candidates.length !== 1) {
      rejectedSources.set(
        key,
        `Destination provenance contains ${candidates.length} receipts for ${entity} ${candidates[0]?.sourceId ?? 'unknown'}; the mapping is ambiguous.`,
      )
      continue
    }
    bySource.set(key, candidates[0])
  }

  return { bySource, rejectedSources }
}

export interface MatchInput {
  entity: MigrationEntity
  sourceRows: CanonicalRow[]
  destinationRows: CanonicalRow[]
  /** Self-reported bundle aliases. They are advisory and never trusted. */
  aliases: readonly ProvenanceAlias[]
  /** Stable namespace of the source bundle's database instance. */
  sourceNamespace: string
  /** Namespace of the destination deployment the aliases/receipts refer to. */
  destinationNamespace: string
  /** Destination-local receipts joined to a committed migration run. */
  trustedReceipts: readonly DestinationProvenanceReceipt[]
}

type ProvenanceDecision =
  | { status: 'none' }
  | { status: 'confirmed'; destinationId: string; detail: string }
  | { status: 'collision'; destinationId: string | null; evidence: MatchEvidence[]; detail: string }

function provenanceDecision(
  entity: MigrationEntity,
  sourceId: string,
  sourceRow: CanonicalRow,
  destinationRowsById: Map<string, CanonicalRow>,
  aliases: AliasIndex,
  receipts: ReceiptIndex,
): ProvenanceDecision {
  const key = sourceKey(entity, sourceId)
  const bundleAlias = aliases.bySource.get(key)
  const rejectedAlias = aliases.rejectedSources.get(key)
  const receipt = receipts.bySource.get(key)
  const rejectedReceipt = receipts.rejectedSources.get(key)

  if (rejectedAlias || rejectedReceipt) {
    const destinationId = bundleAlias?.destinationId ?? receipt?.destinationId ?? null
    return {
      status: 'collision',
      destinationId,
      evidence: ['ambiguous-provenance'],
      detail: rejectedAlias ?? rejectedReceipt ?? 'Provenance mapping was rejected.',
    }
  }

  // A bundle alias is only a claim. Without a matching destination receipt it
  // must remain visible to the operator as a review item and can never map.
  if (bundleAlias && !receipt) {
    const destinationExists = destinationRowsById.has(bundleAlias.destinationId)
    return {
      status: 'collision',
      destinationId: destinationExists ? bundleAlias.destinationId : null,
      evidence: ['untrusted-provenance'],
      detail: destinationExists
        ? `Bundle provenance points to destination ${entity} ${bundleAlias.destinationId}, but the destination has no matching committed receipt.`
        : `Bundle provenance points to destination ${entity} ${bundleAlias.destinationId}, which no longer exists and has no matching committed receipt.`,
    }
  }

  if (receipt && bundleAlias && receipt.destinationId !== bundleAlias.destinationId) {
    return {
      status: 'collision',
      destinationId: destinationRowsById.has(receipt.destinationId) ? receipt.destinationId : null,
      evidence: ['ambiguous-provenance'],
      detail: `Bundle provenance points to ${bundleAlias.destinationId}, while the destination receipt points to ${receipt.destinationId}; the mapping is inconsistent.`,
    }
  }

  if (!receipt) return { status: 'none' }
  if (!destinationRowsById.has(receipt.destinationId)) {
    return {
      status: 'collision',
      destinationId: null,
      evidence: ['prior-alias'],
      detail: `Destination receipt points at ${entity} ${receipt.destinationId}, which no longer exists.`,
    }
  }

  // A receipt mapping to a different destination UUID while the source UUID
  // is already present is a same-UUID collision, not an automatic remap.
  if (destinationRowsById.has(sourceId) && receipt.destinationId !== sourceId) {
    return {
      status: 'collision',
      destinationId: receipt.destinationId,
      evidence: ['prior-alias', 'uuid'],
      detail: `Destination already contains ${entity} ${sourceId}, while the receipt maps it to ${receipt.destinationId}; this requires review.`,
    }
  }

  // A prior mapping does not erase a current same-UUID identity collision.
  // Email ownership is security-sensitive and must be reviewed when either
  // side is missing or differs, even if the old run used the same UUID.
  if (entity === 'profiles' && receipt.destinationId === sourceId) {
    const destinationRow = destinationRowsById.get(sourceId)
    const sourceEmail = typeof sourceRow.email === 'string' ? normalizeEmail(sourceRow.email) : null
    const destinationEmail =
      typeof destinationRow?.email === 'string' ? normalizeEmail(destinationRow.email) : null
    if (!sourceEmail || !destinationEmail || sourceEmail !== destinationEmail) {
      return {
        status: 'collision',
        destinationId: sourceId,
        evidence: ['prior-alias', 'uuid'],
        detail: `Destination profile ${sourceId} has a different email (${destinationEmail ?? 'none'}); a prior receipt does not bypass identity review.`,
      }
    }
  }

  return {
    status: 'confirmed',
    destinationId: receipt.destinationId,
    detail: 'Verified destination provenance from a committed prior run.',
  }
}

export function matchRecords(input: MatchInput): RecordMatch[] {
  const {
    entity,
    sourceRows,
    destinationRows,
    aliases,
    sourceNamespace,
    destinationNamespace,
    trustedReceipts,
  } = input
  const byKey = new Map(destinationRows.map((row) => [primaryKeyOf(entity, row), row]))
  const bundleAliases = aliasIndex(aliases, entity, destinationNamespace)
  const receipts = receiptIndex(trustedReceipts, entity, sourceNamespace, destinationNamespace)

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
      const prior = provenanceDecision(entity, sourceId, row, byKey, bundleAliases, receipts)
      if (prior.status === 'confirmed') {
        return confirmed(entity, sourceId, prior.destinationId, prior.detail)
      }
      if (prior.status === 'collision') {
        return {
          entity,
          sourceId,
          destinationId: prior.destinationId,
          status: prior.status,
          evidence: prior.evidence,
          detail: prior.detail,
        }
      }

      const email = typeof row.email === 'string' ? normalizeEmail(row.email) : null
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
      const prior = provenanceDecision(entity, sourceId, row, byKey, bundleAliases, receipts)
      if (prior.status === 'confirmed') {
        return confirmed(entity, sourceId, prior.destinationId, prior.detail)
      }
      if (prior.status === 'collision') {
        return {
          entity,
          sourceId,
          destinationId: prior.destinationId,
          status: prior.status,
          evidence: prior.evidence,
          detail: prior.detail,
        }
      }

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

  // Work data and history: only a verified destination receipt or an existing
  // UUID row can say anything; equal displayed values are deliberately not
  // evidence.
  return sourceRows.map((row) => {
    const sourceId = primaryKeyOf(entity, row)
    const prior = provenanceDecision(entity, sourceId, row, byKey, bundleAliases, receipts)
    if (prior.status === 'confirmed') {
      return confirmed(entity, sourceId, prior.destinationId, prior.detail)
    }
    if (prior.status === 'collision') {
      return {
        entity,
        sourceId,
        destinationId: prior.destinationId,
        status: prior.status,
        evidence: prior.evidence,
        detail: prior.detail,
      }
    }
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

function confirmed(
  entity: MigrationEntity,
  sourceId: string,
  destinationId: string,
  detail = 'Verified destination provenance from a committed prior run.',
): RecordMatch {
  return {
    entity,
    sourceId,
    destinationId,
    status: 'confirmed',
    evidence: ['prior-alias'],
    detail,
  }
}
