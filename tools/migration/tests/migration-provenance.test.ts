// Provenance trust boundary tests for C01M matching.
//
// These tests intentionally exercise matchRecords directly. Bundle aliases
// are attacker controlled input; only a destination-local receipt joined to a
// committed migration run may produce a confirmed mapping.

import { describe, expect, it } from 'vitest'
import {
  canonicalizeRow,
  type CanonicalRow,
  type MigrationEntity,
  type ProvenanceAlias,
} from '@vsis/migration-tool/format'
import {
  matchRecords,
  type DestinationProvenanceReceipt,
} from '@vsis/migration-tool/matching'
import {
  profileRow,
  projectRow,
  timesheetRow,
} from './helpers/migration-fixtures'

const SOURCE_NAMESPACE = 'native:source'
const TARGET_NAMESPACE = 'native:target'
const OTHER_NAMESPACE = 'native:other'
const PROFILE_SOURCE_ID = '11111111-1111-4111-8111-111111111111'
const PROFILE_TARGET_ID = '10000000-0000-4000-8000-000000000001'
const PROJECT_SOURCE_ID = '22222222-2222-4222-8222-222222222222'
const PROJECT_TARGET_ID = '20000000-0000-4000-8000-000000000001'
const TIMESHEET_SOURCE_ID = '33333333-3333-4333-8333-333333333333'
const TIMESHEET_TARGET_ID = '30000000-0000-4000-8000-000000000001'

const NOW = '2026-09-19T10:00:00.000000Z'

function canonical(entity: MigrationEntity, row: Record<string, unknown>): CanonicalRow {
  return canonicalizeRow(entity, row)
}

function alias(
  entity: MigrationEntity,
  sourceId: string,
  destinationId: string,
  instanceNamespace = TARGET_NAMESPACE,
): ProvenanceAlias {
  return { entity, sourceId, destinationId, instanceNamespace, recordedAt: NOW }
}

function receipt(
  entity: MigrationEntity,
  sourceId: string,
  destinationId: string,
  over: Partial<DestinationProvenanceReceipt> = {},
): DestinationProvenanceReceipt {
  return {
    kind: 'destination-receipt',
    sourceNamespace: SOURCE_NAMESPACE,
    targetNamespace: TARGET_NAMESPACE,
    entity,
    sourceId,
    destinationId,
    runId: 'run-1',
    state: 'verified',
    ...over,
  }
}

function match(
  entity: MigrationEntity,
  sourceRows: CanonicalRow[],
  destinationRows: CanonicalRow[],
  options: {
    aliases?: ProvenanceAlias[]
    sourceNamespace?: string
    destinationNamespace?: string
    trustedReceipts?: DestinationProvenanceReceipt[]
  } = {},
) {
  return matchRecords({
    entity,
    sourceRows,
    destinationRows,
    aliases: options.aliases ?? [],
    sourceNamespace: options.sourceNamespace ?? SOURCE_NAMESPACE,
    destinationNamespace: options.destinationNamespace ?? TARGET_NAMESPACE,
    trustedReceipts: options.trustedReceipts ?? [],
  })
}

describe('migration provenance trust boundary', () => {
  it('does not auto map an account from a bundle alias without a destination receipt', () => {
    const [result] = match(
      'profiles',
      [canonical('profiles', profileRow({ id: PROFILE_SOURCE_ID, email: 'alice@example.com' }))],
      [canonical('profiles', profileRow({ id: PROFILE_TARGET_ID, email: 'alice@example.com' }))],
      { aliases: [alias('profiles', PROFILE_SOURCE_ID, PROFILE_TARGET_ID)] },
    )

    expect(result.status).toBe('collision')
    expect(result.destinationId).toBe(PROFILE_TARGET_ID)
    expect(result.evidence).toEqual(['untrusted-provenance'])
    expect(result.detail).toMatch(/no matching committed receipt/)
  })

  it('does not auto map work data from a forged matching alias', () => {
    const [result] = match(
      'timesheets',
      [canonical('timesheets', timesheetRow({ id: TIMESHEET_SOURCE_ID }))],
      [canonical('timesheets', timesheetRow({ id: TIMESHEET_TARGET_ID }))],
      { aliases: [alias('timesheets', TIMESHEET_SOURCE_ID, TIMESHEET_TARGET_ID)] },
    )

    expect(result.status).toBe('collision')
    expect(result.destinationId).toBe(TIMESHEET_TARGET_ID)
    expect(result.evidence).toEqual(['untrusted-provenance'])
  })

  it('confirms a mapping only when the receipt is bound to both source and target namespaces', () => {
    const [result] = match(
      'timesheets',
      [canonical('timesheets', timesheetRow({ id: TIMESHEET_SOURCE_ID }))],
      [canonical('timesheets', timesheetRow({ id: TIMESHEET_TARGET_ID }))],
      {
        aliases: [alias('timesheets', TIMESHEET_SOURCE_ID, TIMESHEET_TARGET_ID)],
        trustedReceipts: [receipt('timesheets', TIMESHEET_SOURCE_ID, TIMESHEET_TARGET_ID)],
      },
    )

    expect(result).toMatchObject({
      status: 'confirmed',
      destinationId: TIMESHEET_TARGET_ID,
      evidence: ['prior-alias'],
    })
  })

  it('retains committed provenance after publication intent is recorded', () => {
    const [result] = match(
      'timesheets',
      [canonical('timesheets', timesheetRow({ id: TIMESHEET_SOURCE_ID }))],
      [canonical('timesheets', timesheetRow({ id: TIMESHEET_TARGET_ID }))],
      {
        trustedReceipts: [receipt('timesheets', TIMESHEET_SOURCE_ID, TIMESHEET_TARGET_ID, { state: 'publication-intent' })],
      },
    )

    expect(result).toMatchObject({ status: 'confirmed', destinationId: TIMESHEET_TARGET_ID })
  })

  it('keeps a same-UUID account with changed email in explicit identity review', () => {
    const [result] = match(
      'profiles',
      [canonical('profiles', profileRow({ id: PROFILE_SOURCE_ID, email: 'alice@example.com' }))],
      [canonical('profiles', profileRow({ id: PROFILE_SOURCE_ID, email: 'different@example.com' }))],
      {
        trustedReceipts: [receipt('profiles', PROFILE_SOURCE_ID, PROFILE_SOURCE_ID)],
      },
    )

    expect(result.status).toBe('collision')
    expect(result.destinationId).toBe(PROFILE_SOURCE_ID)
    expect(result.evidence).toEqual(['prior-alias', 'uuid'])
    expect(result.detail).toMatch(/identity review/)
  })

  it('does not reuse a receipt from another source or destination namespace', () => {
    const [result] = match(
      'timesheets',
      [canonical('timesheets', timesheetRow({ id: TIMESHEET_SOURCE_ID }))],
      [canonical('timesheets', timesheetRow({ id: TIMESHEET_TARGET_ID }))],
      {
        aliases: [alias('timesheets', TIMESHEET_SOURCE_ID, TIMESHEET_TARGET_ID)],
        trustedReceipts: [
          receipt('timesheets', TIMESHEET_SOURCE_ID, TIMESHEET_TARGET_ID, {
            sourceNamespace: OTHER_NAMESPACE,
          }),
        ],
      },
    )

    expect(result.status).toBe('collision')
    expect(result.evidence).toEqual(['untrusted-provenance'])

    const [wrongTarget] = match(
      'timesheets',
      [canonical('timesheets', timesheetRow({ id: TIMESHEET_SOURCE_ID }))],
      [canonical('timesheets', timesheetRow({ id: TIMESHEET_TARGET_ID }))],
      {
        aliases: [alias('timesheets', TIMESHEET_SOURCE_ID, TIMESHEET_TARGET_ID)],
        trustedReceipts: [
          receipt('timesheets', TIMESHEET_SOURCE_ID, TIMESHEET_TARGET_ID, {
            targetNamespace: OTHER_NAMESPACE,
          }),
        ],
      },
    )
    expect(wrongTarget.status).toBe('collision')
    expect(wrongTarget.evidence).toEqual(['untrusted-provenance'])
  })

  it('rejects duplicate bundle aliases instead of last-wins matching', () => {
    const secondDestinationId = '30000000-0000-4000-8000-000000000002'
    const [result] = match(
      'timesheets',
      [canonical('timesheets', timesheetRow({ id: TIMESHEET_SOURCE_ID }))],
      [
        canonical('timesheets', timesheetRow({ id: TIMESHEET_TARGET_ID })),
        canonical('timesheets', timesheetRow({ id: secondDestinationId })),
      ],
      {
        aliases: [
          alias('timesheets', TIMESHEET_SOURCE_ID, TIMESHEET_TARGET_ID),
          alias('timesheets', TIMESHEET_SOURCE_ID, secondDestinationId),
        ],
        trustedReceipts: [receipt('timesheets', TIMESHEET_SOURCE_ID, TIMESHEET_TARGET_ID)],
      },
    )

    expect(result.status).toBe('collision')
    expect(result.evidence).toEqual(['ambiguous-provenance'])
    expect(result.detail).toMatch(/2 aliases/)
  })

  it('rejects a receipt with duplicate source mappings or a noncommitted run state', () => {
    const duplicateReceipts = match(
      'projects',
      [canonical('projects', projectRow({ id: PROJECT_SOURCE_ID, name: 'Support' }))],
      [
        canonical('projects', projectRow({ id: PROJECT_TARGET_ID, name: 'Support' })),
        canonical('projects', projectRow({ id: '20000000-0000-4000-8000-000000000002', name: 'Other' })),
      ],
      {
        trustedReceipts: [
          receipt('projects', PROJECT_SOURCE_ID, PROJECT_TARGET_ID),
          receipt('projects', PROJECT_SOURCE_ID, '20000000-0000-4000-8000-000000000002', { runId: 'run-2' }),
        ],
      },
    )
    expect(duplicateReceipts[0].status).toBe('collision')
    expect(duplicateReceipts[0].evidence).toEqual(['ambiguous-provenance'])

    const failed = match(
      'projects',
      [canonical('projects', projectRow({ id: PROJECT_SOURCE_ID, name: 'Support' }))],
      [canonical('projects', projectRow({ id: PROJECT_TARGET_ID, name: 'Support' }))],
      {
        aliases: [alias('projects', PROJECT_SOURCE_ID, PROJECT_TARGET_ID)],
        trustedReceipts: [
          receipt('projects', PROJECT_SOURCE_ID, PROJECT_TARGET_ID, {
            state: 'failed' as DestinationProvenanceReceipt['state'],
          }),
        ],
      },
    )
    expect(failed[0].status).toBe('collision')
    expect(failed[0].evidence).toEqual(['ambiguous-provenance'])
  })

  it('accepts distinct trusted receipts for an explicitly coalesced destination row', () => {
    const secondSourceId = '22222222-2222-4222-8222-222222222223'
    const destination = canonical('projects', projectRow({ id: PROJECT_TARGET_ID, name: 'Support' }))
    const results = match(
      'projects',
      [
        canonical('projects', projectRow({ id: PROJECT_SOURCE_ID, name: 'Support A' })),
        canonical('projects', projectRow({ id: secondSourceId, name: 'Support B' })),
      ],
      [destination],
      {
        trustedReceipts: [
          receipt('projects', PROJECT_SOURCE_ID, PROJECT_TARGET_ID),
          receipt('projects', secondSourceId, PROJECT_TARGET_ID, { runId: 'run-2' }),
        ],
      },
    )

    expect(results).toHaveLength(2)
    expect(results.every((item) => item.status === 'confirmed')).toBe(true)
    expect(results.map((item) => item.destinationId)).toEqual([PROJECT_TARGET_ID, PROJECT_TARGET_ID])
  })

  it('supports repeated and reverse runs only with the matching direction receipt', () => {
    const forward = match(
      'timesheets',
      [canonical('timesheets', timesheetRow({ id: TIMESHEET_SOURCE_ID }))],
      [canonical('timesheets', timesheetRow({ id: TIMESHEET_TARGET_ID }))],
      {
        trustedReceipts: [receipt('timesheets', TIMESHEET_SOURCE_ID, TIMESHEET_TARGET_ID)],
      },
    )
    expect(forward[0].status).toBe('confirmed')

    const reverseReceipt = receipt('timesheets', TIMESHEET_TARGET_ID, TIMESHEET_SOURCE_ID, {
      sourceNamespace: TARGET_NAMESPACE,
      targetNamespace: SOURCE_NAMESPACE,
      runId: 'run-reverse',
    })
    const reverse = match(
      'timesheets',
      [canonical('timesheets', timesheetRow({ id: TIMESHEET_TARGET_ID }))],
      [canonical('timesheets', timesheetRow({ id: TIMESHEET_SOURCE_ID }))],
      {
        sourceNamespace: TARGET_NAMESPACE,
        destinationNamespace: SOURCE_NAMESPACE,
        aliases: [alias('timesheets', TIMESHEET_TARGET_ID, TIMESHEET_SOURCE_ID, SOURCE_NAMESPACE)],
        trustedReceipts: [reverseReceipt],
      },
    )
    expect(reverse[0].status).toBe('confirmed')
    expect(reverse[0].destinationId).toBe(TIMESHEET_SOURCE_ID)
  })

  it('keeps a trusted mapping unresolved when its destination row is gone', () => {
    const [result] = match(
      'timesheets',
      [canonical('timesheets', timesheetRow({ id: TIMESHEET_SOURCE_ID }))],
      [],
      { trustedReceipts: [receipt('timesheets', TIMESHEET_SOURCE_ID, TIMESHEET_TARGET_ID)] },
    )

    expect(result.status).toBe('collision')
    expect(result.destinationId).toBeNull()
    expect(result.evidence).toEqual(['prior-alias'])
    expect(result.detail).toMatch(/no longer exists/)
  })
})
// tools/migration/tests/migration-provenance.test.ts
