import { describe, it, expect } from 'vitest'
import {
  newEntrySchema,
  storedEntrySchema,
  splitTicketHours,
  normalizeClassification,
  ACTIVITIES_BY_TYPE,
  ACTIVITY_CODES,
  ENTRY_TYPES,
  activityDisplayLabel,
  requiresProject,
  requiresTicketNumber,
  requiresActivityOther,
  TICKET_NUMBER_MAX,
  ACTIVITY_OTHER_MAX,
  type EntryType,
  type ActivityCode,
} from '@vsis/contracts'

const base = { hoursWorked: 3, workDone: 'did work', logDate: '2026-01-05' }

function parse(overrides: Record<string, unknown>) {
  return newEntrySchema.safeParse({ ...base, ...overrides })
}

describe('newEntrySchema branch rules', () => {
  it('accepts every allowed Type/Activity branch', () => {
    for (const type of ENTRY_TYPES) {
      for (const code of ACTIVITIES_BY_TYPE[type]) {
        const overrides: Record<string, unknown> = { entryType: type, activityCode: code }
        if (requiresProject(type)) overrides.projectId = 'p1'
        if (requiresTicketNumber(type, code)) Object.assign(overrides, { ticketNumber: 'INC00089159', customer: 'Acme' })
        if (requiresActivityOther(type, code)) overrides.activityOther = 'some other work'
        expect(parse(overrides).success, `${type}/${code}`).toBe(true)
      }
    }
  })

  it('rejects an activity that does not belong to the type', () => {
    expect(parse({ entryType: 'support', activityCode: 'planning' }).success).toBe(false)
    expect(parse({ entryType: 'project', activityCode: 'customers', projectId: 'p1' }).success).toBe(false)
    expect(parse({ entryType: 'internal', activityCode: 'internal_it' }).success).toBe(false)
  })

  it('requires a project only for Project and rejects it elsewhere', () => {
    expect(parse({ entryType: 'project', activityCode: 'planning' }).success).toBe(false)
    expect(parse({ entryType: 'project', activityCode: 'planning', projectId: 'p1' }).success).toBe(true)
    expect(parse({ entryType: 'support', activityCode: 'internal_it', projectId: 'p1' }).success).toBe(false)
    expect(parse({ entryType: 'internal', activityCode: 'meetings', projectId: 'p1' }).success).toBe(false)
  })

  it('requires Ticket Number and Customer only for Support/Customers', () => {
    const support = { entryType: 'support', activityCode: 'customers', customer: 'Acme' }
    expect(parse(support).success).toBe(false)
    expect(parse({ ...support, ticketNumber: '  ' }).success).toBe(false)
    expect(parse({ ...support, ticketNumber: 'INC 00089159' }).success).toBe(true)
    expect(parse({ ...support, ticketNumber: 'INC 00089159', customer: ' ' }).success).toBe(false)
    // not allowed outside the branch
    expect(parse({ entryType: 'support', activityCode: 'internal_it', ticketNumber: 'INC00089159' }).success).toBe(false)
    expect(parse({ entryType: 'support', activityCode: 'internal_it', customer: 'Acme' }).success).toBe(false)
  })

  it('accepts only INC/SVR + 8 digit tickets and stores them without the space', () => {
    const ticket = (t: string) => parse({ entryType: 'support', activityCode: 'customers', customer: 'Acme', ticketNumber: t })
    for (const ok of ['INC 00089159', 'INC00089103', 'SVR 00089156', 'svr00089103']) expect(ticket(ok).success, ok).toBe(true)
    for (const bad of ['TCK-9', 'INC 0008915', 'INC000891590', 'REQ00089159', 'INC  00089159']) expect(ticket(bad).success, bad).toBe(false)
    const parsed = ticket(' svr 00089156 ')
    expect(parsed.success && parsed.data.ticketNumber).toBe('SVR00089156')
  })

  it('restores historical free-text tickets and missing customers leniently', () => {
    const stored = storedEntrySchema.safeParse({ ...base, entryType: 'support', activityCode: 'customers', ticketNumber: ' 00Ab-City/#42 ' })
    expect(stored.success).toBe(true)
    expect(stored.success && stored.data.ticketNumber).toBe('00Ab-City/#42')
    expect(storedEntrySchema.safeParse({ ...base, entryType: 'support', activityCode: 'customers', ticketNumber: 'x'.repeat(TICKET_NUMBER_MAX + 1) }).success).toBe(false)
  })

  it('splits ticket hours in 0.25h steps, spreading the remainder', () => {
    expect(splitTicketHours(1, 3)).toEqual([0.5, 0.25, 0.25])
    expect(splitTicketHours(2, 2)).toEqual([1, 1])
    expect(splitTicketHours(0.75, 3)).toEqual([0.25, 0.25, 0.25])
    expect(splitTicketHours(0.5, 3)).toBeNull()
    expect(splitTicketHours(1.1, 2)).toBeNull()
  })

  it('requires Other Activity only for Internal/Other; enforces max length', () => {
    expect(parse({ entryType: 'internal', activityCode: 'other' }).success).toBe(false)
    expect(parse({ entryType: 'internal', activityCode: 'other', activityOther: '   ' }).success).toBe(false)
    expect(parse({ entryType: 'internal', activityCode: 'other', activityOther: 'ad-hoc fix' }).success).toBe(true)
    expect(parse({ entryType: 'internal', activityCode: 'meetings', activityOther: 'nope' }).success).toBe(false)
    expect(
      parse({ entryType: 'internal', activityCode: 'other', activityOther: 'x'.repeat(ACTIVITY_OTHER_MAX + 1) }).success
    ).toBe(false)
  })

  it('normalizes out-of-branch optional fields to null', () => {
    const norm = normalizeClassification({
      entryType: 'project',
      activityCode: 'implementation',
      projectId: 'p1',
      ticketNumber: 'leftover',
      activityOther: 'leftover',
    })
    expect(norm).toEqual({
      entryType: 'project',
      activityCode: 'implementation',
      projectId: 'p1',
      ticketNumber: null,
      customer: null,
      activityOther: null,
    })
  })

  it('keeps the two R&D activities distinct by type', () => {
    expect(activityDisplayLabel('project', 'research_development')).toBe('Project · R&D')
    expect(activityDisplayLabel('internal', 'research_development')).toBe('Internal · R&D')
  })

  it('covers all activity codes in the taxonomy map', () => {
    const mapped = new Set<ActivityCode>()
    for (const t of ENTRY_TYPES) for (const c of ACTIVITIES_BY_TYPE[t as EntryType]) mapped.add(c)
    expect([...mapped].sort()).toEqual([...ACTIVITY_CODES].sort())
  })
})
