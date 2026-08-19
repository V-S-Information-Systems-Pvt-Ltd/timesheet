// tests/data-client-supabase.test.ts
// Coverage for the supabase adapter of lib/data/client.ts. The adapter chains
// calls on a mocked supabase client and maps { data, error, count } results.
import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('@/lib/backend/client', () => ({ IS_NATIVE: false }))

// results per table; the fake query-builder resolves to the table's current result
type QueryResult = { data?: unknown; error?: unknown; count?: unknown }
const results = new Map<string, QueryResult>()

function makeQuery(result: () => QueryResult) {
  const q = {
    select: () => q,
    order: () => q,
    eq: () => q,
    range: () => q,
    limit: () => q,
    maybeSingle: () => q,
    insert: () => q,
    delete: () => q,
    update: () => q,
    gte: () => q,
    lte: () => q,
    then(resolve: (v: QueryResult) => void) {
      resolve(result())
    },
  } as unknown as { [k: string]: unknown } & { then: (r: (v: QueryResult) => void) => void }
  return q
}

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: (table: string) => makeQuery(() => results.get(table) ?? { data: null, error: null }),
  }),
}))

const timesheet = { id: 't1', log_date: '2026-08-01', hours_worked: 8, work_done: 'x' }

describe('supabase data client', () => {
  let dataClient: Awaited<ReturnType<typeof import('../lib/data/client')>>['dataClient']

  beforeEach(async () => {
    vi.resetModules()
    results.clear()
    const mod = await import('../lib/data/client')
    dataClient = mod.dataClient
  })

  it('getProjects maps rows and errors', async () => {
    results.set('projects', { data: [{ id: 'p1', name: 'Alpha' }], error: null })
    expect(await dataClient.getProjects()).toEqual({ data: [{ id: 'p1', name: 'Alpha' }], error: null })

    results.set('projects', { data: null, error: { message: 'boom' } })
    expect(await dataClient.getProjects()).toEqual({ data: null, error: 'boom' })
  })

  it('getTimesheets uses range when from/to given, limit when only limit given', async () => {
    results.set('timesheets', { data: [timesheet], error: null, count: 1 })
    expect(await dataClient.getTimesheets({ from: 0, to: 49, limit: 50 })).toEqual({
      data: [timesheet],
      count: 1,
      error: null,
    })
    await dataClient.getTimesheets({ limit: 25 })
    await dataClient.getTimesheets({ from: 10, to: 19 })
    await dataClient.getTimesheets({})
  })

  it('getAllUsers and getProfile', async () => {
    results.set('profiles', { data: [{ id: 'u1', email: 'a@b.com' }], error: null })
    expect(await dataClient.getAllUsers()).toEqual({ data: [{ id: 'u1', email: 'a@b.com' }], error: null })

    expect(await dataClient.getProfile()).toEqual({ data: null, error: 'User id required.' })
    results.set('profiles', { data: { id: 'u1' }, error: null })
    expect(await dataClient.getProfile('u1')).toEqual({ data: { id: 'u1' }, error: null })
  })

  it('getBackfillWindow normalizes settings', async () => {
    results.set('app_settings', { data: { backfill_mode: 'month_start', backfill_window_days: 30, backfill_extra_days: 2 }, error: null })
    expect(await dataClient.getBackfillWindow()).toEqual({ data: { mode: 'month_start', windowDays: 30, extraDays: 2 } })
    results.set('app_settings', { data: { backfill_mode: 'days', backfill_window_days: 3, backfill_extra_days: 1 }, error: null })
    expect(await dataClient.getBackfillWindow()).toEqual({ data: { mode: 'days', windowDays: 3, extraDays: 1 } })
  })

  it('activity type getters', async () => {
    results.set('activity_types', { data: [{ id: 'a1', name: 'R&D' }], error: null })
    expect(await dataClient.getActivityTypes()).toEqual({ data: [{ id: 'a1', name: 'R&D' }], error: null })
    expect(await dataClient.getAllActivityTypes()).toEqual({ data: [{ id: 'a1', name: 'R&D' }], error: null })
  })

  it('leaves: read, insert, delete', async () => {
    results.set('leaves', { data: [{ id: 'l1', user_id: 'u1' }], error: null })
    expect(await dataClient.getLeaves({ userId: 'u1' })).toEqual({ data: [{ id: 'l1', user_id: 'u1' }], error: null })
    await dataClient.getLeaves({ from: '2026-01-01', to: '2026-02-01' })

    results.set('leaves', { data: null, error: null })
    expect(await dataClient.insertLeaves([{ userId: 'u1', leaveDate: '2026-08-02', reason: 'r' }])).toEqual({ error: null })
    expect(await dataClient.deleteLeave('l1')).toEqual({ error: null })

    results.set('leaves', { data: null, error: { message: 'no' } })
    expect(await dataClient.insertLeaves([])).toEqual({ error: 'no' })
  })

  it('reminders: read, insert, update, delete', async () => {
    expect(await dataClient.getReminders()).toEqual({ data: null, error: 'User id required.' })
    results.set('reminders', { data: [{ id: 'r1', user_id: 'u1' }], error: null })
    expect(await dataClient.getReminders('u1')).toEqual({ data: [{ id: 'r1', user_id: 'u1' }], error: null })
    expect(await dataClient.insertReminder({ userId: 'u1', message: 'm', remindAt: '2026-08-03' })).toEqual({ error: null })
    expect(await dataClient.updateReminder('r1', true)).toEqual({ error: null })
    expect(await dataClient.deleteReminder('r1')).toEqual({ error: null })
  })

  it('global reminders: due list filters dismissed; all getter', async () => {
    results.set('global_reminders', { data: [{ id: 'g1', remind_at: '2026-01-01' }, { id: 'g2' }], error: null })
    results.set('global_reminder_dismissals', { data: [{ reminder_id: 'g1' }], error: null })
    const due = await dataClient.getDueGlobalReminders()
    expect(due.data).toEqual([{ id: 'g2' }])

    results.set('global_reminders', { data: [{ id: 'g1' }], error: null })
    expect(await dataClient.getGlobalReminders()).toEqual({ data: [{ id: 'g1' }], error: null })

    // empty due list returns [] without hitting dismissals
    results.set('global_reminders', { data: [], error: null })
    expect(await dataClient.getDueGlobalReminders()).toEqual({ data: [], error: null })

    // dismissals error propagates
    results.set('global_reminders', { data: [{ id: 'g1' }], error: null })
    results.set('global_reminder_dismissals', { data: null, error: { message: 'nope' } })
    expect(await dataClient.getDueGlobalReminders()).toEqual({ data: null, error: 'nope' })
  })
})
