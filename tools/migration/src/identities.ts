// tools/migration/src/identities.ts
// Identity disposition: the reviewed answer to "what happens to every account?".
//
// C02 provisioned whatever the resolved plan happened to create. That leaves a
// gap the plan calls out explicitly: an identity can also be *referenced* by
// historical rows without being an account (a deleted actor), or be excluded
// while imported rows still depend on it. Those are different dispositions, and
// none of them may silently become a login-enabled placeholder.
//
// This module is pure: it reads the reviewed plan snapshot and the resolution
// and returns one disposition per source account plus the blockers that must
// prevent an apply. It never calls a provider and never reads a database.

import { ENTITY_ORDER, entitySpec, type CanonicalRow, type MigrationEntity } from './format'
import { normalizeEmail } from './matching'
import type { ResolvedPlan } from './merge-plan'

export type IdentityDispositionKind = 'mapped' | 'provision' | 'historical' | 'excluded'

export type EnrollmentStatus =
  /** A matched destination account keeps the credential it already has. */
  | 'existing-account'
  /** A new account must enroll through the destination provider's own flow. */
  | 'enroll-on-destination'
  /** A historical reference is not an account and never gains a login. */
  | 'not-an-account'

export interface IdentityDisposition {
  sourceId: string
  email: string | null
  kind: IdentityDispositionKind
  destinationId: string | null
  enrollment: EnrollmentStatus
  /** Recorded from the source for review; never applied to the destination. */
  sourceEmailConfirmed: boolean | null
  /** Source active state; the reviewed plan carries it into the merged row. */
  sourceActive: boolean | null
  detail: string
}

export interface IdentityBlocker {
  code: string
  sourceId: string | null
  message: string
}

export interface IdentityDispositionPlan {
  dispositions: IdentityDisposition[]
  blockers: IdentityBlocker[]
  counts: Record<IdentityDispositionKind, number>
  enrollments: Record<EnrollmentStatus, number>
  /** Destination ids that must be created through the Auth provider. */
  provisionIds: string[]
  /** Ids referenced by imported rows that are not source accounts. */
  historicalReferenceIds: string[]
}

/** Profile id columns declared by the entity matrix. */
const ENTITY_PROFILE_REFERENCES: Array<{ entity: MigrationEntity; column: string }> = ENTITY_ORDER.flatMap(
  (entity) =>
    entitySpec(entity)
      .columns.filter(
        (column) => column.references?.entity === 'profiles' && column.references.column === 'id'
      )
      .map((column) => ({ entity, column: column.name }))
)

/**
 * Every source account is mapped, newly provisioned, historical/non-login or
 * explicitly excluded. Anything else — an undisposed account, an excluded
 * account that imported rows still reference, a new account with no usable
 * email — is a blocker that must prevent the apply.
 */
export function buildIdentityDispositions(
  resolved: Pick<ResolvedPlan, 'plan' | 'entries' | 'idMap' | 'exclusions' | 'expectedResult'>
): IdentityDispositionPlan {
  const sourceProfiles = resolved.plan.snapshot.sourceRows.profiles ?? []
  // Only the bundle's source inventory describes source assurance. The plan's
  // `identities` are destination facts used for matching and drift detection,
  // and reading them here would let an OAuth-only source account pass as a
  // password account.
  const sourceIdentities = resolved.plan.snapshot.sourceIdentities ?? []
  // A duplicate id must never be collapsed last-write-wins: the weaker record
  // could hide an OAuth-only or MFA-protected account.
  const identityById = new Map<string, (typeof sourceIdentities)[number]>()
  const duplicateIdentityIds = new Set<string>()
  for (const identity of sourceIdentities) {
    if (identityById.has(identity.id)) duplicateIdentityIds.add(identity.id)
    else identityById.set(identity.id, identity)
  }
  const sourceIds = new Set(sourceProfiles.map((row) => String(row.id)))
  const map = resolved.idMap.profiles ?? {}

  const entryBySourceId = new Map<string, { action: string; destinationId: string | null }>()
  for (const entry of resolved.entries) {
    if (entry.entity !== 'profiles' || entry.sourceId === null) continue
    entryBySourceId.set(entry.sourceId, { action: entry.action, destinationId: entry.destinationId })
  }

  const dispositions: IdentityDisposition[] = []
  const blockers: IdentityBlocker[] = []
  const provisionIds: string[] = []

  for (const row of sourceProfiles) {
    const sourceId = String(row.id)
    const email = typeof row.email === 'string' ? row.email : null
    const identity = identityById.get(sourceId)
    const entry = entryBySourceId.get(sourceId)
    const destinationId = map[sourceId] ?? entry?.destinationId ?? null
    const sourceActive = typeof row.is_active === 'boolean' ? row.is_active : null
    const sourceEmailConfirmed = identity?.emailConfirmed ?? null

    if (duplicateIdentityIds.has(sourceId)) {
      blockers.push({
        code: 'E_IDENTITY_DUPLICATE',
        sourceId,
        message:
          'The bundle carries more than one assurance record for this account; a weaker duplicate could replace the original. Re-export the bundle before applying.',
      })
      continue
    }
    // The profile row supplies the email the destination provisions with; the
    // Auth record supplies the assurance facts. They must describe the same
    // person, or the facts would be attached to a different address.
    if (
      identity &&
      (identity.email === null || email === null || normalizeEmail(identity.email) !== normalizeEmail(email))
    ) {
      blockers.push({
        code: 'E_IDENTITY_EMAIL_MISMATCH',
        sourceId,
        message: `Source profile email ${email ?? '(missing)'} does not match its Auth record email ${identity.email ?? '(missing)'}; re-export the bundle or correct the source before applying.`,
      })
      continue
    }

    // `map` adopts a matched account; `update` writes reviewed field changes
    // into an account that already exists. Both keep the destination identity.
    if (entry?.action === 'map' || entry?.action === 'update') {
      if (!destinationId) {
        blockers.push({
          code: 'E_IDENTITY_UNMAPPED',
          sourceId,
          message: 'The plan maps this account but records no destination identity; the mapping is incomplete.',
        })
        continue
      }
      dispositions.push({
        sourceId,
        email,
        kind: 'mapped',
        destinationId,
        enrollment: 'existing-account',
        sourceEmailConfirmed,
        sourceActive,
        detail:
          entry.action === 'update'
            ? 'existing destination account: reviewed field changes are applied, its credential is retained'
            : 'existing destination account: its credential, email ownership and assurances are retained',
      })
      continue
    }

    if (entry?.action === 'create') {
      if (!email) {
        blockers.push({
          code: 'E_IDENTITY_NO_EMAIL',
          sourceId,
          message: 'A new account without a usable email cannot enroll on the destination.',
        })
        continue
      }
      // Without the source assurance facts, a password provisioning decision
      // would be an assumption about a deployment nobody inspected. Fail closed
      // and ask for a bundle that carries the inventory.
      if (!identity) {
        blockers.push({
          code: 'E_IDENTITY_INVENTORY_MISSING',
          sourceId,
          message:
            'The reviewed plan carries no source assurance facts for this account; re-export the bundle so its sign-in providers and second factors can be reviewed before provisioning.',
        })
        continue
      }
      // A source account that signs in through OAuth cannot be re-created as a
      // password account without silently lowering its assurance: that needs an
      // explicit re-enrollment decision, not a default.
      const unsupported = (identity.providerIdentities ?? []).filter((provider) => provider !== 'email')
      if (unsupported.length > 0) {
        blockers.push({
          code: 'E_IDENTITY_UNSUPPORTED_PROVIDER',
          sourceId,
          message: `Source account uses ${unsupported.join(', ')}; provisioning it as a password account would downgrade its assurance. Record an explicit re-enrollment path or exclude it.`,
        })
        continue
      }
      // The same applies to a registered second factor: the provisioned account
      // would be a weaker identity than the one it replaces.
      if ((identity?.mfaFactors ?? 0) > 0) {
        blockers.push({
          code: 'E_IDENTITY_MFA_UNSUPPORTED',
          sourceId,
          message: `Source account has ${identity?.mfaFactors} registered second factor(s); a provisioned account would not carry them. Record an explicit re-enrollment path or exclude it.`,
        })
        continue
      }
      const allocated = destinationId ?? sourceId
      provisionIds.push(allocated)
      dispositions.push({
        sourceId,
        email,
        kind: 'provision',
        destinationId: allocated,
        enrollment: 'enroll-on-destination',
        sourceEmailConfirmed,
        sourceActive,
        detail: 'new account: enrolls through the destination provider; no password or verification is transferred',
      })
      continue
    }

    if (entry?.action === 'exclude') {
      const exclusion = resolved.exclusions.find(
        (item) => item.entity === 'profiles' && item.sourceId === sourceId
      )
      dispositions.push({
        sourceId,
        email,
        kind: 'excluded',
        destinationId: null,
        enrollment: 'not-an-account',
        sourceEmailConfirmed,
        sourceActive,
        detail: exclusion?.reason ? `excluded: ${exclusion.reason}` : 'excluded by the reviewed resolution',
      })
      continue
    }

    blockers.push({
      code: 'E_IDENTITY_UNDISPOSED',
      sourceId,
      message: 'This source account has no reviewed disposition (map, create or exclude).',
    })
  }

  // A source Auth account without a profile row has no reviewed disposition at
  // all: it is neither migrated nor excluded, so the run must stop and ask
  // instead of leaving a login unaccounted for.
  for (const identity of [...identityById.values()].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (sourceIds.has(identity.id)) continue
    blockers.push({
      code: 'E_IDENTITY_WITHOUT_PROFILE',
      sourceId: identity.id,
      message: `Source Auth account ${identity.id} has no profile row and therefore no reviewed disposition; remove it on the source or record an explicit decision before applying.`,
    })
  }

  // References held by rows that are actually being imported. A reference to an
  // id with no source account is a deleted actor: history stays readable and no
  // login is ever created for it — but only while the merged result still holds
  // the profile the imported rows point at. Without it the database's own
  // foreign key rejects the merge, so the disposition must demand a decision
  // instead of letting the merged-state validation fail later with an
  // unattributed orphan.
  const dispositionBySourceId = new Map(dispositions.map((item) => [item.sourceId, item]))
  const mergedProfileIds = new Set(
    (resolved.expectedResult.profiles ?? []).map((row) => String(row.id))
  )
  const historicalReferenceIds: string[] = []
  for (const sourceId of [...collectReferencedProfileIds(resolved)].sort()) {
    if (!sourceIds.has(sourceId) && !mergedProfileIds.has(sourceId)) {
      blockers.push({
        code: 'E_HISTORICAL_UNRESOLVED',
        sourceId,
        message: `Imported rows reference profile ${sourceId}, which is not a source account and has no profile in the merged result; the destination foreign key would reject the import. Exclude the referencing rows or correct the source reference before applying.`,
      })
      continue
    }
    if (sourceIds.has(sourceId)) {
      const disposition = dispositionBySourceId.get(sourceId)
      if (disposition?.kind === 'excluded') {
        blockers.push({
          code: 'E_EXCLUDED_WITH_DEPENDENTS',
          sourceId,
          message: 'Imported rows still reference this excluded account; resolve its dependents first.',
        })
      } else if (!disposition) {
        blockers.push({
          code: 'E_IDENTITY_UNDISPOSED',
          sourceId,
          message: 'Imported rows reference this account, which has no reviewed disposition.',
        })
      }
      continue
    }
    historicalReferenceIds.push(sourceId)
    dispositions.push({
      sourceId,
      email: null,
      kind: 'historical',
      destinationId: null,
      enrollment: 'not-an-account',
      sourceEmailConfirmed: null,
      sourceActive: null,
      detail: 'referenced by imported data but not a source account: history stays readable, no login is created',
    })
  }

  // Defense in depth: a historical reference must never appear among the ids
  // handed to the Auth provider.
  const historical = new Set(historicalReferenceIds)
  for (const id of provisionIds) {
    if (historical.has(id)) {
      blockers.push({
        code: 'E_HISTORICAL_PROVISIONED',
        sourceId: id,
        message: 'A historical reference must never be provisioned as a login-enabled account.',
      })
    }
  }

  const counts: Record<IdentityDispositionKind, number> = { mapped: 0, provision: 0, historical: 0, excluded: 0 }
  const enrollments: Record<EnrollmentStatus, number> = {
    'existing-account': 0,
    'enroll-on-destination': 0,
    'not-an-account': 0,
  }
  for (const disposition of dispositions) {
    counts[disposition.kind] += 1
    enrollments[disposition.enrollment] += 1
  }

  return {
    dispositions,
    blockers,
    counts,
    enrollments,
    provisionIds: [...new Set(provisionIds)].sort(),
    historicalReferenceIds,
  }
}

/** Profile ids referenced by source rows the resolution creates, maps or updates. */
function collectReferencedProfileIds(
  resolved: Pick<ResolvedPlan, 'plan' | 'entries' | 'exclusions'>
): Set<string> {
  const excludedKeys = new Set(resolved.exclusions.map((item) => `${item.entity}:${item.sourceId}`))
  const wanted = new Map<MigrationEntity, Set<string>>()
  for (const entry of resolved.entries) {
    if (entry.sourceId === null || entry.action === 'retain' || entry.action === 'exclude') continue
    if (excludedKeys.has(`${entry.entity}:${entry.sourceId}`)) continue
    const ids = wanted.get(entry.entity) ?? new Set<string>()
    ids.add(entry.sourceId)
    wanted.set(entry.entity, ids)
  }

  const referenced = new Set<string>()
  for (const [entity, ids] of wanted) {
    const columns = ENTITY_PROFILE_REFERENCES.filter((reference) => reference.entity === entity)
    if (columns.length === 0) continue
    const rows: CanonicalRow[] = resolved.plan.snapshot.sourceRows[entity] ?? []
    for (const row of rows) {
      if (!ids.has(String(row.id))) continue
      for (const column of columns) {
        const value = row[column.column]
        if (typeof value === 'string' && value.length > 0) referenced.add(value)
      }
    }
  }
  return referenced
}
