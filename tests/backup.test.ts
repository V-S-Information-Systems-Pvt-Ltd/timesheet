// tests/backup.test.ts
// Parser/validation tests for the admin Backup & Restore JSON format.
import { describe, expect, it } from 'vitest'
import { parseBackup } from '../lib/backup'
import type { BackupPayload } from '../app/types'

const validDoc = (): BackupPayload => ({
  version: 1,
  exportedAt: '2026-08-20T00:00:00.000Z',
  projects: [
    { name: 'Internal', so_number: null, telegram_no: 1000 },
    { name: 'Alpha', so_number: 'SO-1', telegram_no: null },
  ],
  activityTypes: [
    { name: 'R&D', is_active: true, telegram_no: 5 },
    { name: 'Meeting', is_active: true, telegram_no: null },
  ],
  timesheets: [
    { email: 'a@x.com', log_date: '2026-08-19', project: 'Alpha', activity_type: 'R&D', hours_worked: 8, work_done: 'built things' },
  ],
  leaves: [{ email: 'a@x.com', leave_date: '2026-08-20', reason: 'sick' }],
  reminders: [{ email: 'a@x.com', message: 'standup', remind_at: '2026-08-21T09:00:00Z', done: false }],
  globalReminders: [{ message: 'payroll', remind_at: '2026-08-25T09:00:00Z' }],
})

describe('parseBackup', () => {
  it('accepts a valid payload and normalizes emails/dates', () => {
    const res = parseBackup(validDoc())
    expect(res.ok).toBe(true)
    if (!res.ok || !res.payload) throw new Error('expected ok')
    expect(res.payload.projects).toHaveLength(2)
    expect(res.payload.timesheets[0].email).toBe('a@x.com')
    expect(res.payload.timesheets[0].hours_worked).toBe(8)
  })

  it('rejects non-object input and unsupported versions', () => {
    expect(parseBackup(null).ok).toBe(false)
    expect(parseBackup('nope').ok).toBe(false)
    expect(parseBackup({ ...validDoc(), version: 2 }).ok).toBe(false)
    expect(parseBackup({ ...validDoc(), version: 1 }).ok).toBe(true)
  })

  it('rejects a payload missing required sections', () => {
    const doc = validDoc() as unknown as Record<string, unknown>
    delete doc.timesheets
    expect(parseBackup(doc).ok).toBe(false)
  })

  it('rejects invalid hours', () => {
    const doc = validDoc()
    doc.timesheets[0].hours_worked = 25
    expect(parseBackup(doc).ok).toBe(false)
    doc.timesheets[0].hours_worked = 0
    expect(parseBackup(doc).ok).toBe(false)
  })

  it('rejects an invalid date on a timesheet row', () => {
    const doc = validDoc()
    doc.timesheets[0].log_date = '19-08-2026'
    expect(parseBackup(doc).ok).toBe(false)
  })

  it('rejects impossible calendar dates before restore', () => {
    const doc = validDoc()
    doc.timesheets[0].log_date = '2026-02-30'
    expect(parseBackup(doc).ok).toBe(false)

    const leaveDoc = validDoc()
    leaveDoc.leaves[0].leave_date = '2026-04-31'
    expect(parseBackup(leaveDoc).ok).toBe(false)
  })

  it('dedupes projects by name and timesheets by user/date/project/type/hours', () => {
    const doc = validDoc()
    doc.projects.push({ name: 'Internal', so_number: null, telegram_no: 999 })
    doc.timesheets.push({ ...doc.timesheets[0] }) // exact duplicate
    const res = parseBackup(doc)
    if (!res.ok || !res.payload) throw new Error('expected ok')
    expect(res.payload.projects).toHaveLength(2)
    expect(res.payload.timesheets).toHaveLength(1)
  })

  it('rejects oversized backups', () => {
    const doc = validDoc()
    for (let i = 0; i < 5001; i++) {
      doc.timesheets.push({
        email: `u${i}@x.com`,
        log_date: '2026-08-19',
        project: 'Alpha',
        activity_type: null,
        hours_worked: 1,
        work_done: 'x',
      })
    }
    expect(parseBackup(doc).ok).toBe(false)
  })

  it('truncates over-long leave reasons and reminder messages to the DB bounds', () => {
    // Legacy backups may hold values written before the leaves/reminders
    // CHECK constraints existed; restore must not fail the whole run on them.
    const doc = validDoc()
    doc.leaves[0].reason = 'r'.repeat(501)
    doc.reminders[0].message = 'm'.repeat(501)
    const res = parseBackup(doc)
    expect(res.ok).toBe(true)
    if (!res.ok || !res.payload) throw new Error('expected ok')
    expect(res.payload.leaves[0].reason).toHaveLength(500)
    expect(res.payload.reminders[0].message).toHaveLength(500)
  })
})
