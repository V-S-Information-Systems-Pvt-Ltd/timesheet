import { describe, it, expect } from 'vitest'
import { canonicalEffectPayload } from '@/lib/idempotency-effect'

const ACTOR = 'actor-1'

describe('canonicalEffectPayload classification parity', () => {
  it('keeps the legacy create payload byte-identical (no classification keys)', () => {
    const legacy = canonicalEffectPayload(
      'create_timesheet',
      { projectId: 'p1', activityTypeId: 'a1', hoursWorked: 3, workDone: 'x', logDate: '2026-01-02' },
      ACTOR
    )
    expect(legacy).toEqual({
      user_id: ACTOR,
      project_id: 'p1',
      activity_type_id: 'a1',
      hours_worked: 3,
      work_done: 'x',
      log_date: '2026-01-02',
    })
    // The object must not carry classification keys for a legacy op, or the
    // SQL legacy branch would fingerprint differently and reject valid retries.
    expect(Object.keys(legacy as object)).not.toContain('entry_type')
  })

  it('does not silently fingerprint an unknown nonnull classification as a legacy retry', () => {
    const legacy = { projectId: 'p1', activityTypeId: 'a1', hoursWorked: 1, workDone: 'w', logDate: '2026-01-04' }
    const a = canonicalEffectPayload('create_timesheet', legacy, ACTOR)
    const b = canonicalEffectPayload('create_timesheet', { ...legacy, entryType: 'unknown' }, ACTOR)
    expect(b).not.toEqual(a)
    expect(b).toMatchObject({ entry_type: 'unknown' })
  })

  it('adds classification keys for a new-format create', () => {
    const payload = canonicalEffectPayload(
      'create_timesheet',
      {
        entryType: 'support',
        activityCode: 'customers',
        projectId: null,
        ticketNumber: 'TCK-1',
        activityOther: null,
        activityTypeId: null,
        hoursWorked: 2,
        workDone: 'support work',
        logDate: '2026-01-03',
      },
      ACTOR
    ) as Record<string, unknown>
    expect(payload.entry_type).toBe('support')
    expect(payload.activity_code).toBe('customers')
    expect(payload.ticket_number).toBe('TCK-1')
    expect(payload.project_id).toBeNull()
  })

  it('changes the new-format payload when only the ticket number changes', () => {
    const base = {
      entryType: 'support' as const,
      activityCode: 'customers' as const,
      projectId: null,
      activityOther: null,
      activityTypeId: null,
      hoursWorked: 2,
      workDone: 'w',
      logDate: '2026-01-03',
    }
    const a = canonicalEffectPayload('update_timesheet', { id: 't1', ...base, ticketNumber: 'TCK-1' }, ACTOR)
    const b = canonicalEffectPayload('update_timesheet', { id: 't1', ...base, ticketNumber: 'TCK-2' }, ACTOR)
    expect(JSON.stringify(a)).not.toEqual(JSON.stringify(b))
  })

  it.each(['create_timesheet', 'update_timesheet'])('leaves historical %s retries matching with newly added null columns', (operation) => {
    const legacy = { id: 't1', projectId: 'p1', activityTypeId: 'a1', hoursWorked: 1, workDone: 'w', logDate: '2026-01-04' }
    const a = canonicalEffectPayload(operation, legacy, ACTOR)
    const b = canonicalEffectPayload(operation, { ...legacy, entryType: null, activityCode: null, ticketNumber: null, activityOther: null }, ACTOR)
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b))
  })

  it.each(['create_timesheet', 'update_timesheet'])('normalizes %s optional defaults and Unicode outer whitespace without changing ticket identity', (operation) => {
    const base = { id: 't1', entryType: 'support', activityCode: 'customers', hoursWorked: 1, workDone: 'w', logDate: '2026-01-04' }
    const a = canonicalEffectPayload(operation, { ...base, ticketNumber: '  001-a:B ﻿', activityOther: ' ' }, ACTOR)
    const b = canonicalEffectPayload(operation, { ...base, projectId: null, activityTypeId: null, ticketNumber: '001-a:B', activityOther: null }, ACTOR)
    expect(a).toEqual(b)
    expect(a).toMatchObject({ ticket_number: '001-a:B', activity_other: null, project_id: null, activity_type_id: null })
  })
})
