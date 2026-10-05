// tests/data-client-cache.test.ts
// Tests for the in-flight single-flight dedupe cache in lib/data/client.ts:
// concurrent identical fetches share one request, and the cache clears once
// settled so the next call re-fetches. The facade is backend-neutral, so the
// same behavior applies in both build modes.
import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { DataClient, ReportReadOptions } from '../lib/data/client'
import { createDashboardMonthTotals, type DashboardMonthTotalsState } from '@/lib/dashboard-month-totals'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

async function jsonResponse(body: unknown): Promise<Response> {
  return { ok: true, status: 200, json: async () => body } as Response
}

describe('data client single-flight cache', () => {
  let dataClient: DataClient

  beforeEach(async () => {
    mockFetch.mockReset()
    vi.resetModules()
    const mod = await import('../lib/data/client')
    dataClient = mod.dataClient
  })

  it('dedupes simultaneous identical fetches into one request', async () => {
    mockFetch.mockResolvedValue(await jsonResponse({ data: { rows: [{ id: 't1' }], count: 1 }, error: null }))
    const [a, b] = await Promise.all([
      dataClient.getTimesheets({ from: 0, to: 9, limit: 10 }),
      dataClient.getTimesheets({ from: 0, to: 9, limit: 10 }),
    ])
    expect(a).toEqual(b)
    const url = 'http://localhost/api/v1/timesheets?from=0&to=9&limit=10'
    expect(mockFetch.mock.calls.filter(([u]) => u === url).length).toBe(1)
  })

  const sessionReads: Array<{
    name: string
    call: (client: DataClient, options?: ReportReadOptions) => Promise<{ data: unknown; error?: string | null }>
    alice: unknown
    bob: unknown
  }> = [
    { name: 'profile', call: (c, o) => c.getProfile(undefined, o), alice: { id: 'alice' }, bob: { id: 'bob' } },
    { name: 'people', call: (c, o) => c.getAllUsers(o), alice: [{ id: 'alice', email: 'alice@example.test' }], bob: [{ id: 'bob', email: 'bob@example.test' }] },
    { name: 'projects', call: (c, o) => c.getProjects(o), alice: { projects: [{ id: 'alice', name: 'Alice project' }] }, bob: { projects: [{ id: 'bob', name: 'Bob project' }] } },
    { name: 'activities', call: (c, o) => c.getActivityTypes(o), alice: { activityTypes: [{ id: 'alice', name: 'Alice activity' }] }, bob: { activityTypes: [{ id: 'bob', name: 'Bob activity' }] } },
    { name: 'layouts', call: (c, o) => c.getDefaultLayouts(o), alice: { dashboard: { tiles: [{ id: 'alice' }] } }, bob: { dashboard: { tiles: [{ id: 'bob' }] } } },
    { name: 'backfill', call: (c, o) => c.getBackfillWindow(o), alice: { mode: 'days', windowDays: 111, extraDays: 0 }, bob: { mode: 'days', windowDays: 2, extraDays: 0 } },
    { name: 'capabilities', call: (c, o) => c.getCapabilities(o), alice: { isSuperAdmin: true }, bob: { isSuperAdmin: false } },
  ]
  for (const mode of ['success', 'failure'] as const) {
    it.each(sessionReads)('Bob $name bypasses delayed Alice ' + mode + ' through the actual HTTP facade', async ({ name, call, alice, bob }) => {
      let resolveAlice!: (response: Response) => void
      mockFetch.mockReturnValueOnce(new Promise<Response>(resolve => { resolveAlice = resolve }))
        .mockResolvedValueOnce(await jsonResponse({ data: bob, error: null }))
      const old = call(dataClient)
      const fresh = await call(dataClient, { deduplicate: false })
      expect(mockFetch).toHaveBeenCalledTimes(2)
      expect(fresh.error).toBeFalsy()
      const before = JSON.stringify(fresh)
      if (mode === 'success') resolveAlice(await jsonResponse({ data: alice, error: null }))
      else resolveAlice({ ok: false, status: 403, json: async () => ({ error: { message: 'Old Alice denied' } }) } as Response)
      const result = await old
      if (mode === 'failure' && name !== 'backfill') expect(result.error).toBe('Old Alice denied')
      if (mode === 'failure') expect(result.data).toBeNull()
      expect(JSON.stringify(fresh)).toBe(before)
      expect(fresh.data).not.toEqual(result.data)
    })
  }

  it('re-fetches once the in-flight promise has settled', async () => {
    mockFetch.mockResolvedValue(await jsonResponse({ data: { rows: [], count: 0 }, error: null }))
    await dataClient.getTimesheets({ limit: 50 })
    await dataClient.getTimesheets({ limit: 50 })
    const url = 'http://localhost/api/v1/timesheets?limit=50'
    expect(mockFetch.mock.calls.filter(([u]) => u === url).length).toBe(2)
  })

  it('does not dedupe distinct requests', async () => {
    mockFetch.mockImplementation(async (url: string) => jsonResponse({
      data: url.endsWith('/reference') ? { projects: [] } : { rows: [], count: 0 },
      error: null,
    }))
    await Promise.all([dataClient.getProjects(), dataClient.getTimesheets()])
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('keeps count-free and default-count requests separate', async () => {
    mockFetch.mockImplementation(async (url: string) => jsonResponse({
      data: { rows: [], count: url.includes('includeCount=false') ? 0 : 42 },
      error: null,
    }))
    const [counted, uncounted] = await Promise.all([
      dataClient.getTimesheets(),
      dataClient.getTimesheets({ includeCount: false }),
    ])
    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(counted.count).toBe(42)
    expect(uncounted.count).toBe(0)
  })

  it('preserves default report singleflight behavior', async () => {
    mockFetch.mockResolvedValue(await jsonResponse({ data: { totalHours: 8, totalEntries: 2, byGroup: [] }, error: null }))
    const [a, b] = await Promise.all([
      dataClient.getReportTotals({ groupBy: 'user' }),
      dataClient.getReportTotals({ groupBy: 'user' }),
    ])
    expect(a).toEqual(b)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('isolates a new session/page read from an existing same-URL timesheet flight', async () => {
    let resolveOld!: (response: Response) => void
    mockFetch.mockReturnValueOnce(new Promise<Response>(resolve => { resolveOld = resolve }))
      .mockResolvedValueOnce(await jsonResponse({ data: { rows: [{ id: 'bob' }], count: 2 }, error: null }))
    const old = dataClient.getTimesheets({ from: 0, to: 49 })
    const fresh = await dataClient.getTimesheets({ from: 0, to: 49 }, { deduplicate: false })
    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(fresh.data?.[0].id).toBe('bob')
    resolveOld(await jsonResponse({ data: { rows: [{ id: 'alice' }], count: 999 }, error: null }))
    expect((await old).data?.[0].id).toBe('alice')
  })

  it('bypasses an existing shared report flight and preserves direct HTTP failures', async () => {
    let resolveOld!: (response: Response) => void
    mockFetch.mockReturnValueOnce(new Promise<Response>(resolve => { resolveOld = resolve }))
      .mockResolvedValueOnce({
        ok: false, status: 403,
        json: async () => ({ data: null, error: { message: 'Access denied' } }),
      } as Response)
    const old = dataClient.getReportTotals({ groupBy: 'user' })
    const direct = await dataClient.getReportTotals({ groupBy: 'user' }, { deduplicate: false })
    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(direct).toEqual({ data: null, error: 'Access denied' })
    resolveOld(await jsonResponse({ data: { totalHours: 900, totalEntries: 200, byGroup: [] }, error: null }))
    await old
  })

  it.each(['success', 'error'])('isolates a remounted Bob controller from Alice’s pending %s through the actual facade', async (mode) => {
    let resolveAlice!: (response: Response) => void
    let resolveBob!: (response: Response) => void
    mockFetch.mockReturnValueOnce(new Promise<Response>(resolve => { resolveAlice = resolve }))
      .mockReturnValueOnce(new Promise<Response>(resolve => { resolveBob = resolve }))
    const aliceStates: DashboardMonthTotalsState[] = []
    const bobStates: DashboardMonthTotalsState[] = []
    const read = (query: Parameters<typeof dataClient.getReportTotals>[0]) => dataClient.getReportTotals(query, { deduplicate: false })
    const alice = createDashboardMonthTotals(read, state => aliceStates.push(state))
    alice.reset('alice')
    const old = alice.refresh()
    alice.reset(null)
    const bob = createDashboardMonthTotals(read, state => bobStates.push(state))
    bob.reset('bob')
    const fresh = bob.refresh()
    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2))
    expect(mockFetch.mock.calls[0][0]).toBe(mockFetch.mock.calls[1][0])
    expect(mockFetch.mock.calls[1][1]).toMatchObject({ credentials: 'same-origin' })
    resolveBob(await jsonResponse({ data: { totalHours: 8, totalEntries: 2, byGroup: [] }, error: null }))
    await fresh
    resolveAlice(await jsonResponse(mode === 'success'
      ? { data: { totalHours: 900, totalEntries: 200, byGroup: [] }, error: null }
      : { data: null, error: 'Alice failure' }))
    await old
    expect(aliceStates.at(-1)).toEqual({ status: 'idle', totals: null, error: null })
    expect(bobStates.at(-1)).toEqual({ status: 'ready', totals: { totalHours: 8, totalEntries: 2 }, error: null })
    expect(bobStates.some(state => state.totals?.totalHours === 900 || state.status === 'error')).toBe(false)
  })
})
