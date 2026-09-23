// tests/migration-portable-classification.test.ts
// C06A §1a: the adopted rule for a queued payload that reached no source
// history. The decision is pure, so it is tested directly: what resolves decides
// whether the payload is translated, executed unchanged, or sent to review.

import { describe, expect, it } from 'vitest'
import { applyPortableTranslation, decidePortablePayload } from '@/lib/idempotency'

function row(entity: string, sourceId: string, destinationId: string) {
  return { entity, source_id: sourceId, destination_id: destinationId }
}

describe('C06A portable payload classification', () => {
  it('treats a destination-era payload as unchanged', () => {
    const decision = decidePortablePayload(
      [{ entity: 'projects', id: 'dest-project' }],
      [row('projects', 'source-project', 'dest-project')],
      [],
      1
    )
    expect(decision.outcome).toBe('destination-era')
    expect(decision.translation).toEqual({})
  })

  it('translates when every referenced id is a remapped source id', () => {
    const decision = decidePortablePayload(
      [
        { entity: 'timesheets', id: 'source-sheet' },
        { entity: 'projects', id: 'source-project' },
      ],
      [row('timesheets', 'source-sheet', 'dest-sheet'), row('projects', 'source-project', 'dest-project')],
      [row('timesheets', 'source-sheet', 'dest-sheet'), row('projects', 'source-project', 'dest-project')],
      1
    )
    expect(decision.outcome).toBe('translate')
    expect(decision.translation).toEqual({
      'timesheets:source-sheet': 'dest-sheet',
      'projects:source-project': 'dest-project',
    })
  })

  it('keeps an id that survived the merge unchanged', () => {
    // source_id === destination_id means the record kept its identity, so the
    // payload already names the right row and must not be rewritten.
    const decision = decidePortablePayload(
      [{ entity: 'projects', id: 'stable-project' }],
      [row('projects', 'stable-project', 'stable-project')],
      [],
      1
    )
    expect(decision.outcome).toBe('destination-era')
  })

  it('sends a mixed payload to review instead of guessing', () => {
    const decision = decidePortablePayload(
      [
        { entity: 'timesheets', id: 'source-sheet' },
        { entity: 'projects', id: 'dest-project' },
      ],
      [row('timesheets', 'source-sheet', 'dest-sheet')],
      [row('timesheets', 'source-sheet', 'dest-sheet')],
      1
    )
    expect(decision.outcome).toBe('review')
    expect(decision.reason).toContain('mixes source-era and destination-era')
  })

  it('sends an id that exists on both sides of the mapping to review', () => {
    const decision = decidePortablePayload(
      [{ entity: 'timesheets', id: 'colliding' }],
      [row('timesheets', 'colliding', 'moved-elsewhere')],
      [row('timesheets', 'another-source', 'colliding')],
      1
    )
    expect(decision.outcome).toBe('review')
    expect(decision.reason).toContain('both sides')
  })

  it('refuses an actor mapped from more than one deployment', () => {
    const decision = decidePortablePayload([{ entity: 'projects', id: 'source-project' }], [], [], 2)
    expect(decision.outcome).toBe('review')
    expect(decision.reason).toContain('more than one deployment')
  })

  it('does not confuse ids of different entities', () => {
    // The same string names a timesheet on the source side and a different
    // entity's record on the destination side: only the field's own entity may
    // decide, so the project reference is untouched and the timesheet is not
    // claimed as a collision.
    const decision = decidePortablePayload(
      [{ entity: 'projects', id: 'shared-id' }],
      [row('timesheets', 'shared-id', 'other')],
      [],
      1
    )
    expect(decision.outcome).toBe('destination-era')
  })

  it('rewrites only the fields the operation defines, in place', () => {
    const payload: Record<string, unknown> = {
      userId: 'source-user',
      projectId: 'source-project',
      hoursWorked: 7.5,
      workDone: 'unchanged text',
    }
    applyPortableTranslation('create_timesheet', payload, {
      'profiles:source-user': 'dest-user',
      'projects:source-project': 'dest-project',
    })
    expect(payload).toEqual({
      userId: 'dest-user',
      projectId: 'dest-project',
      hoursWorked: 7.5,
      workDone: 'unchanged text',
    })
  })

  it('rewrites leave rows without touching the rest of the batch', () => {
    const payload = { rows: [{ userId: 'source-user', note: 'keep me' }, { note: 'no user' }] }
    applyPortableTranslation('create_leave', payload, { 'profiles:source-user': 'dest-user' })
    expect(payload.rows[0]).toEqual({ userId: 'dest-user', note: 'keep me' })
    expect(payload.rows[1]).toEqual({ note: 'no user' })
  })
})
