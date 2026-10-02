import { describe, expect, it, vi } from 'vitest'
import { createTemporaryTimesheetId, insertOptimisticTimesheet, isTemporaryTimesheetId, mergePendingTimesheets } from '@/lib/optimistic-timesheets'
import type { Timesheet } from '@/app/types'

const row: Timesheet = {
  id: 'entry-1', user_id: 'user-1', project_id: 'p1', activity_type_id: null,
  log_date: '2026-10-02', hours_worked: 4, work_done: 'Original', created_at: '2026-10-02T08:00:00Z',
}

describe('optimistic row identity and ordering', () => {
  it('generates distinct temporary IDs without crypto, even in the same millisecond', () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000)
    try {
      const ids = Array.from({ length: 100 }, createTemporaryTimesheetId)
      expect(new Set(ids).size).toBe(100)
      expect(ids.every(isTemporaryTimesheetId)).toBe(true)
    } finally {
      clock.mockRestore()
    }
  })

  it('restores older rows in authoritative order while keeping pending inserts first', () => {
    const old = { ...row, id: 'old-entry', log_date: '2026-10-01' }
    const temp = { ...row, id: 'temp-copy' }
    const order = [row.id, old.id]
    expect(insertOptimisticTimesheet([temp, row], old, order)).toEqual([temp, row, old])
    expect(insertOptimisticTimesheet([row, old], temp, order)).toEqual([temp, row, old])
    expect(insertOptimisticTimesheet([row, old], row, order)).toEqual([row, old])
  })
})

describe('mergePendingTimesheets', () => {
  it('keeps pending inserts, edits, and deletes across another mutation refresh', () => {
    const edited = { ...row, work_done: 'Edited' }
    const deleted = { ...row, id: 'entry-2' }
    const temp = { ...row, id: 'temp-copy' }
    const other = { ...row, id: 'entry-3' }
    const pending = new Map<string, Timesheet | null>([
      [row.id, edited], [deleted.id, null], [temp.id, temp],
    ])
    expect(mergePendingTimesheets([row, deleted, other], pending)).toEqual([temp, edited, other])
  })

  it('retains a pending edit missing from a stale server response', () => {
    const edited = { ...row, work_done: 'Edited' }
    expect(mergePendingTimesheets([], new Map([[row.id, edited]]))).toEqual([edited])
  })

  it('uses server truth once a write settles, without duplicating real IDs', () => {
    const edited = { ...row, work_done: 'Edited' }
    const pending = new Map<string, Timesheet | null>([[row.id, edited]])
    expect(mergePendingTimesheets([row], pending)).toEqual([edited])
    pending.delete(row.id)
    expect(mergePendingTimesheets([row], pending)).toEqual([row])
  })

  it('handles an already-deleted row without altering other rows or its inputs', () => {
    const rows = [row]
    const pending = new Map<string, Timesheet | null>([['missing', null]])
    expect(mergePendingTimesheets(rows, pending)).toEqual(rows)
    expect(rows).toEqual([row])
    expect(pending.size).toBe(1)
  })
})
