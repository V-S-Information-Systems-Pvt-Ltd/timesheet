import { describe, it, expect } from 'vitest'
import {
  newEntrySchema,
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
        if (requiresTicketNumber(type, code)) overrides.ticketNumber = 'TCK-1'
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

  it('requires Ticket Number only for Support/Customers', () => {
    expect(parse({ entryType: 'support', activityCode: 'customers' }).success).toBe(false)
    expect(parse({ entryType: 'support', activityCode: 'customers', ticketNumber: '  ' }).success).toBe(false)
    expect(parse({ entryType: 'support', activityCode: 'customers', ticketNumber: 'TCK-9' }).success).toBe(true)
    // not allowed outside the branch
    expect(parse({ entryType: 'support', activityCode: 'internal_it', ticketNumber: 'TCK-9' }).success).toBe(false)
  })

  it('round-trips ticket punctuation, case and leading zeros; enforces max length', () => {
    const ticket = ' 00Ab-City/#42 '
    const parsed = parse({ entryType: 'support', activityCode: 'customers', ticketNumber: ticket })
    expect(parsed.success).toBe(true)
    const norm = normalizeClassification(parsed.success ? parsed.data : ({} as never))
    expect(norm.ticketNumber).toBe('00Ab-City/#42')
    expect(
      parse({ entryType: 'support', activityCode: 'customers', ticketNumber: 'x'.repeat(TICKET_NUMBER_MAX + 1) }).success
    ).toBe(false)
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
