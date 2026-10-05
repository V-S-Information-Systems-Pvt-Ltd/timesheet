import { describe, expect, it, vi } from 'vitest'
import type { Timesheet } from '@/app/types'
import type { TimesheetQuery, TimesheetResult } from '@/lib/data/client'
import { buildCsv, parseCsv } from '@/lib/csv'
import { TIMESHEET_CSV_HEADERS, timesheetCsvRows } from '@/lib/reports'
import { createTimesheetPageReader, entriesPageFromSearch, entriesPageQuery, mergePageOverlays, readTimesheetHistory, selectedSnapshotRows, type TimesheetPageState } from '@/lib/dashboard-timesheets'
import { timesheetQuerySchema, batchUpdateTimesheetsSchema } from '@vsis/contracts'

function row(id: number, user = 'alice'): Timesheet {
  return { id: String(id), user_id: user, project_id: 'project', activity_type_id: 'activity', log_date: id === 0 ? '2099-01-01' : '2020-01-01', hours_worked: 1, work_done: `Entry ${id}`, created_at: '2020-01-01T00:00:00Z' }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(accept => { resolve = accept })
  return { promise, resolve }
}

describe('bounded HTTP pagination contract', () => {
  it.each([
    [{}, { from: 0, to: 49, limit: 50 }],
    [{ from: '100' }, { from: 100, to: 149, limit: 50 }],
    [{ to: '9' }, { from: 0, to: 9, limit: 10 }],
    [{ limit: '100000' }, { from: 0, to: 999, limit: 1000 }],
    [{ from: '500', to: '100000', limit: '1' }, { from: 500, to: 1499, limit: 1000 }],
    [{ from: '1000', to: '1999' }, { from: 1000, to: 1999, limit: 1000 }],
  ])('bounds the effective range for %j', (query, expected) => {
    const parsed = timesheetQuerySchema.parse(query)
    expect(parsed).toEqual(expected)
    expect(parsed.includeCount).toBeUndefined()
  })
  it.each([{ from: '10', to: '9' }, { from: '-1' }, { limit: '0' }, { from: '1.5' }, { to: 'Infinity' }])('rejects malformed/reversed %j', query => {
    expect(timesheetQuerySchema.safeParse(query).success).toBe(false)
  })
  it('preserves count defaults, filters and the unrelated edit payload contract', () => {
    expect(timesheetQuerySchema.parse({ userId: 'alice', dateFrom: '2020-01-01', includeCount: 'false' })).toMatchObject({ userId: 'alice', dateFrom: '2020-01-01', includeCount: false })
    const entries = [{ id: '1', projectId: 'p', activityTypeId: 'a', hoursWorked: 1, workDone: 'Edited', logDate: '2020-01-01' }]
    expect(batchUpdateTimesheetsSchema.parse({ entries })).toEqual({ entries })
    expect(batchUpdateTimesheetsSchema.safeParse({ entries: Array(501).fill(entries[0]) }).success).toBe(false)
  })
  it('reads all-date URL paging state and clamps malformed values', () => {
    const page = entriesPageFromSearch(new URLSearchParams('user=alice&page=3&size=25&tab=admin'))
    expect(page).toEqual({ user: 'alice', page: 3, size: 25 })
    expect(entriesPageQuery(page)).toEqual({ from: 50, to: 74, userId: 'alice' })
    expect(entriesPageFromSearch(new URLSearchParams('page=-1&size=1000'))).toEqual({ user: '', page: 1, size: 50 })
  })
})

describe('complete bounded history snapshots', () => {
  const history = Array.from({ length: 1003 }, (_, id) => row(id))
  it('exports every page including future and old rows; passes filters server-side', async () => {
    const read = vi.fn(async (query: TimesheetQuery) => ({ data: history.slice(query.from, (query.to ?? 0) + 1), count: history.length, error: null }))
    const rows = await readTimesheetHistory(read, { userId: 'alice' })
    expect(read).toHaveBeenCalledTimes(2)
    expect(read.mock.calls[1][0]).toEqual({ userId: 'alice', from: 1000, to: 1999, includeCount: true })
    const csv = parseCsv(buildCsv([...TIMESHEET_CSV_HEADERS], timesheetCsvRows(rows)))
    expect(csv).toHaveLength(history.length + 1)
    expect(csv[1].join(',')).toContain('2099-01-01')
    expect(csv.at(-1)?.join(',')).toContain('Entry 1002')
    const snapshot = new Map(rows.map(row => [row.id, row]))
    expect(selectedSnapshotRows(snapshot, new Set(rows.map(row => row.id)))).toHaveLength(1003)
  })
  it.each(['failure', 'count drift', 'duplicate', 'short page', 'missing count'])('never returns a partial snapshot on %s', async mode => {
    const read = vi.fn().mockResolvedValueOnce({ data: history.slice(0, 1000), count: 1003, error: null })
    read.mockResolvedValueOnce(mode === 'failure' ? { data: null, count: null, error: 'Page failed' } : {
      data: mode === 'duplicate' ? [history[0], ...history.slice(1001)] : mode === 'short page' ? [] : history.slice(1000),
      count: mode === 'count drift' ? 1004 : mode === 'missing count' ? null : 1003, error: null,
    })
    await expect(readTimesheetHistory(read)).rejects.toThrow()
  })
  it('cancels a session/unmount/mutation between pages without starting the next page', async () => {
    const pending = deferred<TimesheetResult>()
    let current = true
    const read = vi.fn(() => pending.promise)
    const request = readTimesheetHistory(read, {}, () => current)
    current = false
    pending.resolve({ data: history.slice(0, 1000), count: 1003, error: null })
    await expect(request).rejects.toThrow('cancelled')
    expect(read).toHaveBeenCalledTimes(1)
  })
  it('returns an empty confirmed history and supports date filters', async () => {
    const read = vi.fn().mockResolvedValue({ data: [], count: 0, error: null })
    expect(await readTimesheetHistory(read, { dateFrom: '2020-01-01', dateTo: '2021-01-01' })).toEqual([])
    expect(read).toHaveBeenCalledWith(expect.objectContaining({ dateFrom: '2020-01-01', dateTo: '2021-01-01' }))
  })
})

describe('scoped page readers and optimistic overlays', () => {
  it.each(['old success', 'old failure'])('clears page/user/session state and ignores %s', async mode => {
    const old = deferred<TimesheetResult>()
    const states: TimesheetPageState[] = []
    const read = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValueOnce({ data: [row(2, 'bob')], count: 120, error: null })
    const reader = createTimesheetPageReader(read, state => states.push(state))
    reader.reset('alice:page1', { from: 0, to: 49 })
    const pending = reader.refresh()
    reader.reset('bob:page2', { userId: 'bob', from: 50, to: 99 })
    expect(states.at(-1)).toMatchObject({ rows: [], count: null, error: null })
    await reader.refresh()
    old.resolve(mode === 'old success' ? { data: [row(1)], count: 999, error: null } : { data: null, count: null, error: 'Alice failed' })
    expect(await pending).toBe(false)
    expect(states.at(-1)).toMatchObject({ scope: 'bob:page2', rows: [row(2, 'bob')], count: 120, error: null })
  })
  it('invalidates a pre-write read and retains confirmed counts on a failed refresh', async () => {
    const old = deferred<TimesheetResult>()
    const states: TimesheetPageState[] = []
    const read = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValueOnce({ data: [row(2)], count: 75, error: null }).mockRejectedValueOnce(new Error('Failed'))
    const reader = createTimesheetPageReader(read, state => states.push(state))
    reader.reset('alice', { from: 0, to: 49 })
    const pending = reader.refresh()
    reader.invalidate()
    await reader.refresh()
    old.resolve({ data: [row(1)], count: 100, error: null })
    expect(await pending).toBe(false)
    expect(await reader.refresh()).toBe(false)
    expect(states.at(-1)).toMatchObject({ rows: [row(2)], count: 75, error: 'Could not refresh entries.', loading: false })
  })
  it('never pulls real off-page or other-user overlays into a page and blocks temporary selection', () => {
    const temporary = { ...row(5), id: 'temp-5' }
    const pending = new Map<string, Timesheet | null>([['1', null], ['99', row(99)], ['temp-5', temporary]])
    expect(mergePageOverlays([row(1), row(2)], pending, 'alice')).toEqual([temporary, row(2)])
    expect(mergePageOverlays([row(3, 'bob')], pending, 'bob')).toEqual([row(3, 'bob')])
    expect(selectedSnapshotRows(new Map([['temp-5', temporary], ['2', row(2)]]), new Set(['temp-5', '2']))).toEqual([row(2)])
  })
})
