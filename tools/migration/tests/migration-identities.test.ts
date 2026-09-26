// tests/migration-identities.test.ts
// C04 identity disposition: every source account gets exactly one reviewed
// disposition, historical references never become logins, and the enrolment
// status is recorded separately from the data import.

import { describe, expect, it } from 'vitest'
import { ENTITY_ORDER, type CanonicalRow, type IdentityFact } from '@vsis/migration-tool/format'
import { buildIdentityDispositions } from '@vsis/migration-tool/identities'
import type { PreviewEntry, ResolvedPlan } from '@vsis/migration-tool/merge-plan'
import type { IdentityRecord } from '@vsis/migration-tool/providers/read'
import { profileRow, timesheetRow } from './helpers/migration-fixtures'

const ALICE = '11111111-1111-4111-8111-111111111111'
const BOB = '22222222-2222-4222-8222-222222222222'
const CAROL = '33333333-3333-4333-8333-333333333333'
const DELETED_ACTOR = '99999999-9999-4999-8999-999999999999'

interface Options {
  profiles?: Array<Record<string, unknown>>
  timesheets?: Array<Record<string, unknown>>
  /** Profiles present in the merged result; defaults to the source profiles. */
  mergedProfiles?: Array<Record<string, unknown>>
  entries?: Array<Partial<PreviewEntry> & { entity: string; sourceId: string | null; action: string }>
  idMap?: Record<string, string>
  exclusions?: Array<{ entity: string; sourceId: string; reason: string }>
  /** Source assurance facts captured by the export; the only facts C04 reads. */
  sourceIdentities?: IdentityFact[]
  /** Destination identity facts, kept separate on purpose. */
  destinationIdentities?: IdentityRecord[]
}

function sourceFact(over: Partial<IdentityFact> & { id: string }): IdentityFact {
  return {
    email: null,
    emailConfirmed: null,
    hasCredential: null,
    providerIdentities: ['email'],
    mfaFactors: 0,
    ...over,
  }
}

function resolved(options: Options = {}): ResolvedPlan {
  const sourceRows = {} as Record<string, CanonicalRow[]>
  for (const entity of ENTITY_ORDER) sourceRows[entity] = []
  sourceRows.profiles = (options.profiles ?? [profileRow()]) as unknown as CanonicalRow[]
  sourceRows.timesheets = (options.timesheets ?? []) as unknown as CanonicalRow[]
  const mergedRows = {
    ...sourceRows,
    profiles: (options.mergedProfiles ?? options.profiles ?? [profileRow()]) as unknown as CanonicalRow[],
  }
  const entries = (options.entries ?? [
    { entity: 'profiles', sourceId: ALICE, action: 'map', destinationId: ALICE },
  ]) as unknown as PreviewEntry[]
  return {
    plan: {
      snapshot: {
        sourceRows,
        targetRows: sourceRows,
        identities: options.destinationIdentities ?? [],
        sourceIdentities: options.sourceIdentities ?? [],
        receipts: [],
      },
    },
    entries,
    idMap: { profiles: options.idMap ?? { [ALICE]: ALICE } },
    exclusions: options.exclusions ?? [],
    expectedResult: mergedRows,
  } as unknown as ResolvedPlan
}

describe('C04 identity dispositions', () => {
  it('dispositions every source account and separates enrolment from the data import', () => {
    const plan = buildIdentityDispositions(
      resolved({
        profiles: [profileRow({ id: ALICE, is_active: true }), profileRow({ id: BOB, email: 'bob@example.com', is_active: false })],
        entries: [
          { entity: 'profiles', sourceId: ALICE, action: 'map', destinationId: ALICE },
          { entity: 'profiles', sourceId: BOB, action: 'create' },
        ],
        idMap: { [ALICE]: ALICE, [BOB]: BOB },
        sourceIdentities: [
          sourceFact({ id: ALICE, email: 'alice@example.com', emailConfirmed: true }),
          sourceFact({ id: BOB, email: 'bob@example.com', emailConfirmed: false }),
        ],
      })
    )

    expect(plan.blockers).toEqual([])
    expect(plan.counts).toEqual({ mapped: 1, provision: 1, historical: 0, excluded: 0 })
    expect(plan.enrollments).toEqual({ 'existing-account': 1, 'enroll-on-destination': 1, 'not-an-account': 0 })
    expect(plan.provisionIds).toEqual([BOB])

    const mapped = plan.dispositions.find((item) => item.sourceId === ALICE)
    expect(mapped?.enrollment).toBe('existing-account')
    // The source verification fact is recorded for review, never applied.
    expect(mapped?.sourceEmailConfirmed).toBe(true)

    // An inactive account is still an account: it is carried with its state.
    const provisioned = plan.dispositions.find((item) => item.sourceId === BOB)
    expect(provisioned?.sourceActive).toBe(false)
    expect(provisioned?.sourceEmailConfirmed).toBe(false)
  })

  const deletedActorPlan = (mergedProfiles?: Array<Record<string, unknown>>) =>
    resolved({
      timesheets: [
        timesheetRow({ id: '44444444-4444-4444-8444-444444444444', user_id: DELETED_ACTOR }),
      ],
      entries: [
        { entity: 'profiles', sourceId: ALICE, action: 'map', destinationId: ALICE },
        { entity: 'timesheets', sourceId: '44444444-4444-4444-8444-444444444444', action: 'create' },
      ],
      ...(mergedProfiles ? { mergedProfiles } : {}),
    })

  it('treats a retained referenced profile as historical, never a login', () => {
    const plan = buildIdentityDispositions(
      deletedActorPlan([
        profileRow(),
        profileRow({ id: DELETED_ACTOR, email: 'gone@example.com', is_active: false }),
      ])
    )

    expect(plan.blockers).toEqual([])
    expect(plan.historicalReferenceIds).toEqual([DELETED_ACTOR])
    const historical = plan.dispositions.find((item) => item.sourceId === DELETED_ACTOR)
    expect(historical?.kind).toBe('historical')
    expect(historical?.enrollment).toBe('not-an-account')
    expect(historical?.destinationId).toBeNull()
    // Nothing without a source account is ever handed to the Auth provider.
    expect(plan.provisionIds).toEqual([])
  })

  it('blocks a referenced id with no profile in the merged result instead of failing later as an orphan', () => {
    const plan = buildIdentityDispositions(deletedActorPlan())

    const blocker = plan.blockers.find((item) => item.code === 'E_HISTORICAL_UNRESOLVED')
    expect(blocker?.sourceId).toBe(DELETED_ACTOR)
    expect(blocker?.message).toContain('foreign key')
    expect(plan.historicalReferenceIds).toEqual([])
    expect(plan.provisionIds).toEqual([])
  })

  it('blocks an account with no reviewed disposition', () => {
    const plan = buildIdentityDispositions(
      resolved({
        profiles: [profileRow({ id: ALICE }), profileRow({ id: CAROL, email: 'carol@example.com' })],
      })
    )
    expect(plan.blockers.map((blocker) => blocker.code)).toContain('E_IDENTITY_UNDISPOSED')
    expect(plan.blockers.find((blocker) => blocker.code === 'E_IDENTITY_UNDISPOSED')?.sourceId).toBe(CAROL)
  })

  it('blocks an excluded account that imported rows still reference', () => {
    const plan = buildIdentityDispositions(
      resolved({
        profiles: [profileRow({ id: ALICE }), profileRow({ id: BOB, email: 'bob@example.com' })],
        timesheets: [timesheetRow({ id: '44444444-4444-4444-8444-444444444444', user_id: BOB, project_id: null })],
        entries: [
          { entity: 'profiles', sourceId: ALICE, action: 'map', destinationId: ALICE },
          { entity: 'profiles', sourceId: BOB, action: 'exclude' },
          { entity: 'timesheets', sourceId: '44444444-4444-4444-8444-444444444444', action: 'create' },
        ],
        exclusions: [{ entity: 'profiles', sourceId: BOB, reason: 'left the company' }],
      })
    )
    const blocker = plan.blockers.find((item) => item.code === 'E_EXCLUDED_WITH_DEPENDENTS')
    expect(blocker?.sourceId).toBe(BOB)
    expect(plan.dispositions.find((item) => item.sourceId === BOB)?.detail).toContain('left the company')
  })

  it('does not block an exclusion whose referencing rows are excluded too', () => {
    const plan = buildIdentityDispositions(
      resolved({
        profiles: [profileRow({ id: ALICE }), profileRow({ id: BOB, email: 'bob@example.com' })],
        timesheets: [timesheetRow({ id: '44444444-4444-4444-8444-444444444444', user_id: BOB })],
        entries: [
          { entity: 'profiles', sourceId: ALICE, action: 'map', destinationId: ALICE },
          { entity: 'profiles', sourceId: BOB, action: 'exclude' },
          { entity: 'timesheets', sourceId: '44444444-4444-4444-8444-444444444444', action: 'exclude' },
        ],
        exclusions: [
          { entity: 'profiles', sourceId: BOB, reason: 'left the company' },
          { entity: 'timesheets', sourceId: '44444444-4444-4444-8444-444444444444', reason: 'references an excluded account' },
        ],
      })
    )
    expect(plan.blockers).toEqual([])
    // Identity counts describe identities; the excluded timesheet is not one.
    expect(plan.counts).toEqual({ mapped: 1, provision: 0, historical: 0, excluded: 1 })
    expect(plan.historicalReferenceIds).toEqual([])
  })

  it('blocks a new account with no usable email and an incomplete mapped identity', () => {
    const noEmail = buildIdentityDispositions(
      resolved({
        profiles: [profileRow({ id: CAROL, email: '' })],
        entries: [{ entity: 'profiles', sourceId: CAROL, action: 'create' }],
        idMap: {},
      })
    )
    expect(noEmail.blockers.map((blocker) => blocker.code)).toContain('E_IDENTITY_NO_EMAIL')

    const unmapped = buildIdentityDispositions(
      resolved({
        entries: [{ entity: 'profiles', sourceId: ALICE, action: 'map', destinationId: null }],
        idMap: {},
      })
    )
    expect(unmapped.blockers.map((blocker) => blocker.code)).toContain('E_IDENTITY_UNMAPPED')
  })

  it('blocks provisioning an OAuth-only source account instead of downgrading its assurance', () => {
    const plan = buildIdentityDispositions(
      resolved({
        profiles: [profileRow({ id: CAROL, email: 'carol@example.com' })],
        entries: [{ entity: 'profiles', sourceId: CAROL, action: 'create' }],
        idMap: {},
        sourceIdentities: [
          sourceFact({ id: CAROL, email: 'carol@example.com', emailConfirmed: true, providerIdentities: ['google'] }),
        ],
      })
    )
    const blocker = plan.blockers.find((item) => item.code === 'E_IDENTITY_UNSUPPORTED_PROVIDER')
    expect(blocker?.sourceId).toBe(CAROL)
    expect(blocker?.message).toContain('google')
    expect(plan.provisionIds).toEqual([])
  })

  it('blocks a source account whose assurance record is duplicated', () => {
    const plan = buildIdentityDispositions(
      resolved({
        profiles: [profileRow({ id: CAROL, email: 'carol@example.com' })],
        entries: [{ entity: 'profiles', sourceId: CAROL, action: 'create' }],
        idMap: {},
        // The first record is OAuth-only; a last-write-wins index would take
        // the second, weaker record and license provisioning.
        sourceIdentities: [
          sourceFact({ id: CAROL, email: 'carol@example.com', providerIdentities: ['google'] }),
          sourceFact({ id: CAROL, email: 'carol@example.com', providerIdentities: ['email'] }),
        ],
      })
    )
    expect(plan.blockers.map((blocker) => blocker.code)).toContain('E_IDENTITY_DUPLICATE')
    expect(plan.blockers.map((blocker) => blocker.code)).not.toContain('E_IDENTITY_UNSUPPORTED_PROVIDER')
    expect(plan.provisionIds).toEqual([])
  })

  it('blocks an Auth account whose assurance email differs from its profile email', () => {
    const plan = buildIdentityDispositions(
      resolved({
        profiles: [profileRow({ id: CAROL, email: 'carol@example.com' })],
        entries: [{ entity: 'profiles', sourceId: CAROL, action: 'create' }],
        idMap: {},
        sourceIdentities: [
          sourceFact({ id: CAROL, email: 'someone-else@example.com', providerIdentities: ['email'] }),
        ],
      })
    )
    const blocker = plan.blockers.find((item) => item.code === 'E_IDENTITY_EMAIL_MISMATCH')
    expect(blocker?.sourceId).toBe(CAROL)
    expect(plan.provisionIds).toEqual([])
  })

  it('blocks an Auth account with a missing email when its profile claims an address', () => {
    const plan = buildIdentityDispositions(
      resolved({
        profiles: [profileRow({ id: CAROL, email: 'carol@example.com' })],
        entries: [{ entity: 'profiles', sourceId: CAROL, action: 'create' }],
        idMap: {},
        sourceIdentities: [
          sourceFact({ id: CAROL, email: null, providerIdentities: ['email'] }),
        ],
      })
    )
    const blocker = plan.blockers.find((item) => item.code === 'E_IDENTITY_EMAIL_MISMATCH')
    expect(blocker?.sourceId).toBe(CAROL)
    expect(blocker?.message).toContain('(missing)')
    expect(plan.provisionIds).toEqual([])
  })

  it('blocks a source Auth account that has no profile row', () => {
    const plan = buildIdentityDispositions(
      resolved({
        sourceIdentities: [
          sourceFact({ id: ALICE, email: 'alice@example.com' }),
          sourceFact({ id: DELETED_ACTOR, email: 'ghost@example.com', hasCredential: true }),
        ],
      })
    )
    const blocker = plan.blockers.find((item) => item.code === 'E_IDENTITY_WITHOUT_PROFILE')
    expect(blocker?.sourceId).toBe(DELETED_ACTOR)
    expect(plan.counts.mapped).toBe(1)
  })

  it('never reads destination identity facts as source assurance', () => {
    const plan = buildIdentityDispositions(
      resolved({
        profiles: [profileRow({ id: CAROL, email: 'carol@example.com' })],
        entries: [{ entity: 'profiles', sourceId: CAROL, action: 'create' }],
        idMap: {},
        // The destination account signs in through OAuth; that says nothing
        // about the source account and must not license provisioning it.
        destinationIdentities: [
          {
            id: CAROL,
            email: 'carol@example.com',
            emailConfirmed: true,
            hasCredential: null,
            providerIdentities: ['google'],
            mfaFactors: 2,
          },
        ],
      })
    )
    expect(plan.blockers.map((blocker) => blocker.code)).toContain('E_IDENTITY_INVENTORY_MISSING')
    expect(plan.blockers.map((blocker) => blocker.code)).not.toContain('E_IDENTITY_UNSUPPORTED_PROVIDER')
    expect(plan.provisionIds).toEqual([])
  })

  it('allows a password source account and a matched OAuth account', () => {
    const password = buildIdentityDispositions(
      resolved({
        profiles: [profileRow({ id: CAROL, email: 'carol@example.com' })],
        entries: [{ entity: 'profiles', sourceId: CAROL, action: 'create' }],
        idMap: {},
        sourceIdentities: [sourceFact({ id: CAROL, email: 'carol@example.com', emailConfirmed: false })],
      })
    )
    expect(password.blockers).toEqual([])
    expect(password.provisionIds).toEqual([CAROL])

    // A matched account keeps its own destination identity, so the source's
    // provider mix is irrelevant.
    const matched = buildIdentityDispositions(
      resolved({
        profiles: [profileRow({ id: ALICE })],
        sourceIdentities: [
          sourceFact({ id: ALICE, email: 'alice@example.com', emailConfirmed: true, providerIdentities: ['google'] }),
        ],
      })
    )
    expect(matched.blockers).toEqual([])
    expect(matched.counts.mapped).toBe(1)
  })

  it('blocks provisioning an account with a registered second factor', () => {
    const plan = buildIdentityDispositions(
      resolved({
        profiles: [profileRow({ id: CAROL, email: 'carol@example.com' })],
        entries: [{ entity: 'profiles', sourceId: CAROL, action: 'create' }],
        idMap: {},
        sourceIdentities: [
          sourceFact({
            id: CAROL,
            email: 'carol@example.com',
            emailConfirmed: true,
            mfaFactors: 2,
          }),
        ],
      })
    )
    const blocker = plan.blockers.find((item) => item.code === 'E_IDENTITY_MFA_UNSUPPORTED')
    expect(blocker?.sourceId).toBe(CAROL)
    expect(blocker?.message).toContain('2 registered second factor')
    expect(plan.provisionIds).toEqual([])
  })

  it('treats a reviewed update to a matched account as an existing credential holder', () => {
    const plan = buildIdentityDispositions(
      resolved({
        profiles: [profileRow({ id: ALICE })],
        entries: [{ entity: 'profiles', sourceId: ALICE, action: 'update', destinationId: ALICE }],
        idMap: { [ALICE]: ALICE },
      })
    )
    expect(plan.blockers).toEqual([])
    expect(plan.counts).toEqual({ mapped: 1, provision: 0, historical: 0, excluded: 0 })
    expect(plan.dispositions[0].enrollment).toBe('existing-account')
    expect(plan.dispositions[0].detail).toContain('reviewed field changes')
  })
})
// tools/migration/tests/migration-identities.test.ts
