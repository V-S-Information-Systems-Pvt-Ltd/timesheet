import { describe, expect, it, vi } from 'vitest'
import { createDashboardAuthHandoff, dashboardPageScope, sameDashboardAuthorization } from '@/lib/dashboard-seed'
import { createTimesheetPageReader, type TimesheetPageState } from '@/lib/dashboard-timesheets'
import { createDashboardMonthTotals, dashboardMonthRange, type DashboardMonthTotalsState } from '@/lib/dashboard-month-totals'
import { runBulkEditMutation } from '@/app/dashboard/bulk-edit-modal'
import type { User } from '@/app/types'

const alice = { id: 'alice', email: 'alice@example.test' }
const bob = { id: 'bob', email: 'bob@example.test' }
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(accept => { resolve = accept })
  return { promise, resolve }
}
const payload = [{ id: 'one', projectId: 'p', activityTypeId: 'a', hoursWorked: 2, workDone: 'Original', logDate: '2020-01-01' }]

describe('seeded dashboard auth handoff and live mutation', () => {
  it.each(['INITIAL_SESSION', 'TOKEN_REFRESHED', 'SIGNED_IN', 'USER_UPDATED'] as const)('preserves generation and captured write through same-identity %s', async event => {
    const handoff = createDashboardAuthHandoff(alice)
    const generation = handoff.snapshot().generation
    const locks = new Set<string>()
    const gate = deferred<{ error: null; updated: number }>()
    const reconcile = vi.fn(async () => true)
    const isCurrent = () => generation === handoff.snapshot().generation
    const request = runBulkEditMutation(payload, {
      start: () => { locks.add('one'); return true },
      release: () => { if (isCurrent()) locks.delete('one') },
      isSessionCurrent: isCurrent, write: () => gate.promise, reconcile,
    })
    expect(handoff.receive(alice, event)).toBe(event === 'INITIAL_SESSION' ? 'confirm' : 'retain')
    expect(isCurrent()).toBe(true); expect(locks.has('one')).toBe(true)
    gate.resolve({ error: null, updated: 1 })
    expect((await request)?.refreshed).toBe(true)
    expect(reconcile).toHaveBeenCalledTimes(1); expect(locks.size).toBe(0)
  })
  it('new identity invalidates old reconciliation and prevents its release touching replacement locks', async () => {
    const handoff = createDashboardAuthHandoff(alice)
    const generation = handoff.snapshot().generation
    const locks = new Set<string>()
    const gate = deferred<{ error: null; updated: number }>()
    const reconcile = vi.fn(async () => true)
    const isCurrent = () => generation === handoff.snapshot().generation
    const request = runBulkEditMutation(payload, {
      start: () => { locks.add('one'); return true }, release: () => { if (isCurrent()) locks.delete('one') },
      isSessionCurrent: isCurrent, write: () => gate.promise, reconcile,
    })
    expect(handoff.receive(bob, 'SIGNED_IN')).toBe('replace')
    handoff.replace(bob)
    locks.clear(); locks.add('one') // A replacement session now owns the same row lock.
    gate.resolve({ error: null, updated: 1 })
    expect((await request)?.refreshed).toBe(false)
    expect(reconcile).not.toHaveBeenCalled(); expect(locks.has('one')).toBe(true)
  })
  it('ignores late initial identity after logout and callbacks after unmount', () => {
    const handoff = createDashboardAuthHandoff(alice)
    handoff.replace(null)
    expect(handoff.receive(alice, 'INITIAL_SESSION')).toBe('ignore')
    expect(handoff.snapshot().session).toBeNull()
    handoff.dispose()
    expect(handoff.receive(bob, 'SIGNED_IN')).toBe('ignore')
  })
  it('keeps a server identity outage on unknown/null initial client confirmation, but allows actual recovery', () => {
    const handoff = createDashboardAuthHandoff(null, 'Storage unavailable')
    expect(handoff.receive(null, 'INITIAL_SESSION')).toBe('ignore')
    expect(handoff.receive(alice, 'SIGNED_IN')).toBe('replace')
    handoff.replace(alice)
    expect(handoff.snapshot()).toEqual({ generation: 1, session: alice })
  })
  it('detects authorization changes while ordinary profile edits retain the session', () => {
    const profile = { id: 'alice', role: 'user', permission_role: 'user', hierarchy_role: 'engineer', is_active: true } as User
    expect(sameDashboardAuthorization(profile, { ...profile, name: 'Updated' })).toBe(true)
    for (const patch of [{ id: 'bob' }, { role: 'co' }, { permission_role: 'co' }, { hierarchy_role: 'manager' }, { is_active: false }]) {
      expect(sameDashboardAuthorization(profile, { ...profile, ...patch } as User)).toBe(false)
    }
  })
})

describe('seeded page and local month controllers', () => {
  it('publishes no initial spinner/read, then refreshes new URL scope and rejects stale old success/error', async () => {
    const scope = dashboardPageScope(0, 'alice', { user: '', page: 2, size: 25 })
    const initial: TimesheetPageState = { scope, rows: [], count: 1001, loading: false, error: null }
    const old = deferred<{ data: null; count: null; error: string }>()
    const read = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValueOnce({ data: [], count: 7, error: null })
    const publish = vi.fn()
    const controller = createTimesheetPageReader(read, publish, { state: initial, query: { from: 25, to: 49 } })
    expect(read).not.toHaveBeenCalled(); expect(publish).not.toHaveBeenCalled()
    const pending = controller.refresh()
    controller.reset('0:alice:bob:1:25', { from: 0, to: 24, userId: 'bob' })
    await controller.refresh()
    old.resolve({ data: null, count: null, error: 'Old Alice failure' }); await pending
    expect(publish.mock.lastCall?.[0]).toEqual({ scope: '0:alice:bob:1:25', rows: [], count: 7, loading: false, error: null })
  })
  it('keeps seeded page error recoverable by an explicit fresh read', async () => {
    const read = vi.fn().mockResolvedValue({ data: [], count: 0, error: null })
    const publish = vi.fn()
    const controller = createTimesheetPageReader(read, publish, { state: { scope: 'alice', rows: [], count: null, loading: false, error: 'Unavailable' }, query: { from: 0, to: 24 } })
    expect(read).not.toHaveBeenCalled()
    expect(await controller.refresh()).toBe(true)
    expect(publish.mock.lastCall?.[0].error).toBeNull()
  })
  it('hydrates only browser-confirmed month bounds without repeating the seeded aggregate', () => {
    const read = vi.fn()
    const publish = vi.fn()
    const controller = createDashboardMonthTotals(read, publish, 'alice')
    const now = new Date(2026, 9, 4)
    const state: DashboardMonthTotalsState = { status: 'ready', totals: { totalHours: 1000, totalEntries: 500 }, error: null }
    expect(controller.hydrate(state, dashboardMonthRange(now), now)).toBe(true)
    expect(publish).toHaveBeenCalledWith(state); expect(read).not.toHaveBeenCalled()
  })
  it('never displays server month totals across the local midnight boundary and refreshes only the aggregate', async () => {
    const read = vi.fn().mockResolvedValue({ data: { totalHours: 2, totalEntries: 1 }, error: null })
    const publish = vi.fn()
    const controller = createDashboardMonthTotals(read, publish, 'alice')
    const wrong: DashboardMonthTotalsState = { status: 'ready', totals: { totalHours: 9999, totalEntries: 9999 }, error: null }
    expect(controller.hydrate(wrong, dashboardMonthRange(new Date(2026, 8, 30, 23, 59)), new Date(2026, 9, 1, 0, 0))).toBe(false)
    await vi.waitFor(() => expect(publish.mock.lastCall?.[0].status).toBe('ready'))
    expect(publish.mock.calls.some(([state]) => state.totals?.totalHours === 9999)).toBe(false)
    expect(read).toHaveBeenCalledTimes(1)
  })
  it('does not hydrate old totals while locked or after session invalidation', () => {
    const read = vi.fn()
    const publish = vi.fn()
    const controller = createDashboardMonthTotals(read, publish, 'alice')
    const state: DashboardMonthTotalsState = { status: 'ready', totals: { totalHours: 10, totalEntries: 3 }, error: null }
    controller.setBusy(true)
    expect(controller.hydrate(state, dashboardMonthRange())).toBe(false)
    controller.reset(null)
    expect(controller.hydrate(state, dashboardMonthRange())).toBe(false)
    expect(read).not.toHaveBeenCalled()
  })
})
