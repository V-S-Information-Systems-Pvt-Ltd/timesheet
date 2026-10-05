import { describe, expect, it, vi } from 'vitest'
import { createDashboardMonthTotals, dashboardMonthRange, type DashboardMonthTotalsState } from '@/lib/dashboard-month-totals'

type Result = { data: { totalHours: number; totalEntries: number } | null; error: string | null }
const success = (totalHours = 8000, totalEntries = 1500): Result => ({ data: { totalHours, totalEntries }, error: null })
function deferred() {
  let resolve!: (value: Result) => void
  let reject!: (error: Error) => void
  const promise = new Promise<Result>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
function setup(read = vi.fn<Parameters<typeof createDashboardMonthTotals>[0]>()) {
  const states: DashboardMonthTotalsState[] = []
  const controller = createDashboardMonthTotals(read, state => states.push(state))
  controller.reset('alice')
  return { controller, read, states, last: () => states.at(-1) }
}

describe('dashboard local month bounds', () => {
  it.each([
    [2024, 1, 29, '2024-02-01', '2024-02-29'],
    [2025, 1, 1, '2025-02-01', '2025-02-28'],
    [2026, 11, 31, '2026-12-01', '2026-12-31'],
    [2027, 0, 1, '2027-01-01', '2027-01-31'],
  ])('includes the complete local month for %i/%i/%i', (year, month, day, from, to) => {
    expect(dashboardMonthRange(new Date(year, month, day, 0, 5))).toEqual({ from, to, groupBy: 'user' })
  })

  it('uses local calendar fields even when the UTC month differs', () => {
    const localDate = new Date('2026-02-28T23:00:00Z')
    vi.spyOn(localDate, 'getFullYear').mockReturnValue(2026)
    vi.spyOn(localDate, 'getMonth').mockReturnValue(2)
    expect(dashboardMonthRange(localDate)).toEqual({ from: '2026-03-01', to: '2026-03-31', groupBy: 'user' })
  })
})

describe('dashboard aggregate request lifecycle', () => {
  it('uses server totals larger than a page, with no user filter and future month-end entries included', async () => {
    const { controller, read, last } = setup()
    read.mockResolvedValue(success())
    await controller.refresh()
    expect(read).toHaveBeenCalledWith(dashboardMonthRange())
    expect(last()).toEqual({ status: 'ready', totals: success().data, error: null })
  })

  it('represents confirmed zero as ready, distinct from unavailable totals', async () => {
    const { controller, read, last } = setup()
    read.mockResolvedValue(success(0, 0))
    await controller.refresh()
    expect(last()).toEqual({ status: 'ready', totals: { totalHours: 0, totalEntries: 0 }, error: null })
  })

  it.each(['error', 'missing', 'rejection', 'throw'])('clears old totals on refresh and exposes %s without a zero fallback', async (mode) => {
    const { controller, read, last } = setup()
    read.mockResolvedValueOnce(success())
    await controller.refresh()
    const pending = deferred()
    read.mockImplementationOnce(() => {
      if (mode === 'throw') throw new Error('offline')
      return pending.promise
    })
    const refresh = controller.refresh()
    if (mode !== 'throw') expect(last()).toEqual({ status: 'loading', totals: null, error: null })
    if (mode === 'rejection') pending.reject(new Error('offline'))
    else pending.resolve({ data: null, error: mode === 'error' ? 'Access denied' : null })
    await refresh
    expect(last()).toMatchObject({ status: 'error', totals: null })
    read.mockResolvedValueOnce(success(12, 3))
    await controller.refresh()
    expect(last()).toEqual({ status: 'ready', totals: { totalHours: 12, totalEntries: 3 }, error: null })
  })

  it.each(['success', 'error', 'rejection'])('discards a pre-write %s and issues a fresh read after its flight settles', async (mode) => {
    const { controller, read, states, last } = setup()
    const old = deferred()
    const fresh = deferred()
    read.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise)
    const preWrite = controller.refresh()
    const postWrite = controller.refresh()
    expect(read).toHaveBeenCalledTimes(1)
    if (mode === 'rejection') old.reject(new Error('old error'))
    else old.resolve(mode === 'success' ? success(1, 1) : { data: null, error: 'old error' })
    await preWrite
    await Promise.resolve()
    expect(read).toHaveBeenCalledTimes(2)
    expect(states.every(s => s.status !== 'ready' && s.status !== 'error')).toBe(true)
    fresh.resolve(success(20, 5))
    await postWrite
    expect(last()).toEqual({ status: 'ready', totals: { totalHours: 20, totalEntries: 5 }, error: null })
  })

  it('only issues the latest of multiple overlapping queued refreshes', async () => {
    const { controller, read, last } = setup()
    const old = deferred()
    read.mockReturnValueOnce(old.promise).mockResolvedValueOnce(success(9, 2))
    const first = controller.refresh()
    const second = controller.refresh()
    const third = controller.refresh()
    old.resolve(success(1, 1))
    await Promise.all([first, second, third])
    expect(read).toHaveBeenCalledTimes(2)
    expect(last()).toMatchObject({ totals: { totalHours: 9, totalEntries: 2 } })
  })

  it.each(['success', 'error'])('drops late %s after logout and does not read while signed out', async (mode) => {
    const { controller, read, last } = setup()
    const old = deferred()
    read.mockReturnValueOnce(old.promise)
    const first = controller.refresh()
    controller.reset(null)
    old.resolve(mode === 'success' ? success() : { data: null, error: 'old error' })
    await first
    await controller.refresh()
    expect(last()).toEqual({ status: 'idle', totals: null, error: null })
    expect(read).toHaveBeenCalledTimes(1)
  })

  it.each(['bob', 'alice'])('isolates a direct session reset to %s, including the same account', async (nextSession) => {
    const { controller, read, states, last } = setup()
    const old = deferred()
    read.mockReturnValueOnce(old.promise).mockResolvedValueOnce(success(8, 2))
    const first = controller.refresh()
    controller.reset(nextSession)
    const next = controller.refresh()
    expect(read).toHaveBeenCalledTimes(1)
    old.resolve(success(900, 200))
    await Promise.all([first, next])
    expect(states.some(s => s.totals?.totalHours === 900)).toBe(false)
    expect(last()).toMatchObject({ totals: { totalHours: 8, totalEntries: 2 } })
  })

  it('invalidates pre-write reads and defers refresh without blocking row callbacks while busy', async () => {
    const { controller, read, states, last } = setup()
    const old = deferred()
    const fresh = deferred()
    read.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise)
    const preWrite = controller.refresh()
    controller.setBusy(true)
    await controller.refresh()
    old.resolve(success(1, 1))
    await preWrite
    expect(read).toHaveBeenCalledTimes(1)
    expect(states.some(s => s.status === 'ready')).toBe(false)
    controller.setBusy(false)
    expect(read).toHaveBeenCalledTimes(2)
    fresh.resolve(success(2, 2))
    await fresh.promise
    expect(last()).toMatchObject({ status: 'ready', totals: { totalHours: 2, totalEntries: 2 } })
  })

  it('uses separate controllers for separately mounted dashboards', async () => {
    const a = setup()
    const b = setup()
    a.read.mockResolvedValue(success(1, 1))
    b.read.mockResolvedValue(success(2, 2))
    await Promise.all([a.controller.refresh(), b.controller.refresh()])
    a.controller.reset(null)
    expect(b.last()).toMatchObject({ status: 'ready', totals: { totalHours: 2, totalEntries: 2 } })
  })
})
