// tests/supabase-daily-totals.test.ts
// Regression coverage for scoped daily hour totals (T18.1). The old unscoped
// `get_timesheet_daily_totals` RPC was contracted (dropped by migration
// 20260917000000 after all callers moved to the scoped primitive); its former
// admin-gate tests were removed with the method. Remaining suites cover the
// scoped `sumHoursForUserDates` primitive and the RLS-scoped grouped totals.
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  getAdminClient: vi.fn(),
}))

import { getAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { supabaseRepository } from '@/lib/db/supabase'
import type { Actor } from '@/lib/db/repository'

const mockGetAdminClient = vi.mocked(getAdminClient)
const mockCreateClient = vi.mocked(createClient)

const admin: Actor = { id: 'admin-1', email: 'admin@x.com', role: 'admin', permission_role: 'admin', hierarchy_role: 'user', isActive: true }
const co: Actor = { id: 'co-1', email: 'co@x.com', role: 'co', permission_role: 'co', hierarchy_role: 'user', isActive: true }
const user: Actor = { id: 'user-1', email: 'user@x.com', role: 'user', permission_role: 'user', hierarchy_role: 'user', isActive: true }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('supabase repository getGroupedReportTotals (RLS-scoped RPC)', () => {
  it('calls the grouped-report RPC through the authenticated (RLS) client', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        { label: 'Alpha', hours: 4, entries: 1 },
        { label: 'Beta', hours: 6, entries: 1 },
      ],
      error: null,
    })
    mockCreateClient.mockResolvedValue({ rpc } as never)

    const result = await supabaseRepository.getGroupedReportTotals(user, { projectId: 'p1', from: '2026-01-01' }, 'project')
    expect(result).toEqual([
      { label: 'Alpha', hours: 4, entries: 1 },
      { label: 'Beta', hours: 6, entries: 1 },
    ])
    expect(rpc).toHaveBeenCalledWith('get_grouped_report_totals', {
      p_group_by: 'project',
      p_project_id: 'p1',
      p_from: '2026-01-01',
      p_to: null,
    })
    // Must NOT go through the service-role admin client (would bypass RLS).
    expect(mockGetAdminClient).not.toHaveBeenCalled()
  })

  it('throws when the RPC errors instead of silently returning', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'rpc failed' } })
    mockCreateClient.mockResolvedValue({ rpc } as never)

    await expect(supabaseRepository.getGroupedReportTotals(user, {}, 'user')).rejects.toThrow('rpc failed')
  })

  it('serves unfiltered admin mobile reads through the bearer principal, never service_role', async () => {
    const { runWithMobileSupabaseClient } = await import('@/lib/supabase/bearer')
    // The request-scoped bearer client must be selected before attempting to
    // create a cookie client, even if both credentials are present.
    mockCreateClient.mockResolvedValue({} as never)
    const rpc = vi.fn().mockResolvedValue({
      data: [{ label: 'Alpha', hours: 4, entries: 1 }],
      error: null,
    })
    const result = await runWithMobileSupabaseClient({ rpc } as never, () =>
      supabaseRepository.getGroupedReportTotals(admin, {}, 'project')
    )
    expect(result).toEqual([{ label: 'Alpha', hours: 4, entries: 1 }])
    expect(rpc).toHaveBeenCalledWith('get_grouped_report_totals', expect.objectContaining({ p_group_by: 'project' }))
    // Ordinary admin mobile reads must not traverse privileged credentials.
    expect(mockGetAdminClient).not.toHaveBeenCalled()
  })

  it('prefers the bearer client when cookie and bearer clients coexist', async () => {
    const { runWithMobileSupabaseClient } = await import('@/lib/supabase/bearer')
    const cookieRpc = vi.fn().mockResolvedValue({ data: [{ label: 'cookie', hours: 1, entries: 1 }], error: null })
    const bearerRpc = vi.fn().mockResolvedValue({ data: [{ label: 'bearer', hours: 2, entries: 1 }], error: null })
    mockCreateClient.mockResolvedValue({ rpc: cookieRpc } as never)

    const result = await runWithMobileSupabaseClient({ rpc: bearerRpc } as never, () =>
      supabaseRepository.getGroupedReportTotals(user, { projectId: 'p1' }, 'project')
    )

    expect(result).toEqual([{ label: 'bearer', hours: 2, entries: 1 }])
    expect(bearerRpc).toHaveBeenCalledTimes(1)
    expect(cookieRpc).not.toHaveBeenCalled()
    expect(mockCreateClient).not.toHaveBeenCalled()
  })

  it('propagates grouped-report RPC errors from the selected request client', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'rpc failed' } })
    mockCreateClient.mockResolvedValue({ rpc } as never)

    await expect(supabaseRepository.getGroupedReportTotals(co, { from: '2026-01-01' }, 'user')).rejects.toThrow('rpc failed')
    expect(mockGetAdminClient).not.toHaveBeenCalled()
  })

  it('preserves user, project, date filters and the grouped response contract', async () => {
    const listTimesheets = vi.spyOn(supabaseRepository, 'listTimesheets').mockResolvedValue({
      rows: [{
        project_id: 'p1',
        hours_worked: 3,
        projects: { name: 'Alpha' },
        profiles: null,
        activity_types: null,
      }],
      count: 1,
    } as never)

    try {
      const result = await supabaseRepository.getGroupedReportTotals(admin, {
        userId: 'u-1',
        projectId: 'p1',
        from: '2026-01-01',
        to: '2026-01-31',
      }, 'project')

      expect(result).toEqual([{ label: 'Alpha', hours: 3, entries: 1 }])
      expect(listTimesheets).toHaveBeenCalledWith(admin, {
        userId: 'u-1',
        projectId: 'p1',
        dateFrom: '2026-01-01',
        dateTo: '2026-01-31',
        from: 0,
        to: 999,
        includeCount: true,
      })
    } finally {
      listTimesheets.mockRestore()
    }
  })
})

describe('supabase repository bulkUpdateTimesheets (Phase 4.4 / F08)', () => {
  // The write path is the bulk_update_timesheets RPC. The mock's from('timesheets')
  // surface deliberately has no upsert(), so a regression back to a PostgREST
  // upsert (which would resurrect deleted rows) fails loudly.
  function makeAdminClient(owners: Array<{ id: string; user_id: string }>, rpcResult: { data?: Array<{ updated_id: string }>; error: unknown }) {
    const fromFn = vi.fn().mockResolvedValue({ data: owners, error: null })
    const rpcFn = vi.fn().mockResolvedValue(rpcResult)
    const client = {
      from: vi.fn((table: string) => {
        if (table === 'timesheets') {
          return {
            select: () => ({ in: fromFn }),
          }
        }
        throw new Error('unexpected table ' + table)
      }),
      rpc: rpcFn,
    }
    mockGetAdminClient.mockReturnValue(client as never)
    return { fromFn, rpcFn, client }
  }

  it('updates only rows the actor owns for a non-admin in a single RPC batch', async () => {
    const { rpcFn } = makeAdminClient(
      [
        { id: 'own', user_id: 'user-1' },
        { id: 'other', user_id: 'someone-else' },
      ],
      { data: [{ updated_id: 'own' }], error: null }
    )
    const result = await supabaseRepository.bulkUpdateTimesheets(user, [
      { id: 'own', projectId: 'p1', activityTypeId: 'a1', hoursWorked: 5, workDone: 'x', logDate: '2026-01-01' },
      { id: 'other', projectId: 'p1', activityTypeId: null, hoursWorked: 3, workDone: 'y', logDate: '2026-01-02' },
    ])
    expect(result.updated).toBe(1)
    expect(result.rowErrors).toHaveLength(1)
    expect(result.rowErrors[0].id).toBe('other')
    // A single RPC request is made, scoped to the actor's own rows only.
    expect(rpcFn).toHaveBeenCalledTimes(1)
    expect(rpcFn).toHaveBeenCalledWith('bulk_update_timesheets', {
      p_actor_id: 'user-1',
      p_can_edit_all: false,
      p_rows: [
        expect.objectContaining({ id: 'own', project_id: 'p1', activity_type_id: 'a1', hours_worked: 5, work_done: 'x', log_date: '2026-01-01' }),
      ],
    })
  })

  it('admins can update any row in a single RPC batch', async () => {
    const { rpcFn } = makeAdminClient(
      [
        { id: 'a', user_id: 'u1' },
        { id: 'b', user_id: 'u2' },
      ],
      { data: [{ updated_id: 'a' }, { updated_id: 'b' }], error: null }
    )
    const result = await supabaseRepository.bulkUpdateTimesheets(admin, [
      { id: 'a', projectId: 'p1', activityTypeId: null, hoursWorked: 1, workDone: 'x', logDate: '2026-01-01' },
      { id: 'b', projectId: 'p1', activityTypeId: null, hoursWorked: 2, workDone: 'y', logDate: '2026-01-02' },
    ])
    expect(result.updated).toBe(2)
    expect(result.rowErrors).toHaveLength(0)
    expect(rpcFn).toHaveBeenCalledTimes(1)
    expect(rpcFn).toHaveBeenCalledWith('bulk_update_timesheets', {
      p_actor_id: 'admin-1',
      p_can_edit_all: true,
      p_rows: [
        expect.objectContaining({ id: 'a' }),
        expect.objectContaining({ id: 'b' }),
      ],
    })
  })

  it('does not resurrect rows the RPC skipped (deleted concurrently)', async () => {
    // The owner pre-fetch found the row, but the RPC returns nothing for it
    // (the row no longer exists). A PostgREST upsert would re-insert it; the
    // RPC-based path must instead surface a per-row error.
    const { rpcFn } = makeAdminClient([{ id: 'gone', user_id: 'user-1' }], { data: [], error: null })
    const result = await supabaseRepository.bulkUpdateTimesheets(user, [
      { id: 'gone', projectId: 'p1', activityTypeId: null, hoursWorked: 3, workDone: 'x', logDate: '2026-01-01' },
    ])
    expect(result.updated).toBe(0)
    expect(result.rowErrors).toEqual([{ id: 'gone', error: 'you can only modify your own entries' }])
    expect(result.error).toBe('All edits failed.')
    expect(rpcFn).toHaveBeenCalledTimes(1)
  })

  it('surfaces rows the RPC skipped due to ownership change (admin)', async () => {
    // The owner pre-fetch is stale: the row now belongs to someone else, so the
    // RPC (which re-checks ownership atomically) does not write it.
    const { rpcFn } = makeAdminClient([{ id: 'stale', user_id: 'old-owner' }], { data: [], error: null })
    const result = await supabaseRepository.bulkUpdateTimesheets(admin, [
      { id: 'stale', projectId: 'p1', activityTypeId: null, hoursWorked: 3, workDone: 'x', logDate: '2026-01-01' },
    ])
    expect(result.updated).toBe(0)
    expect(result.rowErrors).toEqual([{ id: 'stale', error: 'not found' }])
    expect(result.error).toBe('All edits failed.')
    expect(rpcFn).toHaveBeenCalledTimes(1)
  })
})

type MockQueryBuilder = Promise<{ data: unknown; error: unknown; count?: number | null }> & {
  in: ReturnType<typeof vi.fn>
  eq: ReturnType<typeof vi.fn>
  neq: ReturnType<typeof vi.fn>
  order: ReturnType<typeof vi.fn>
  range: ReturnType<typeof vi.fn>
}

function createMockQuery(data: unknown, error: unknown = null, count?: number | null): MockQueryBuilder {
  const p = Promise.resolve({ data, error, count: count ?? (Array.isArray(data) ? data.length : undefined) }) as MockQueryBuilder
  p.in = vi.fn().mockReturnValue(p)
  p.eq = vi.fn().mockReturnValue(p)
  p.neq = vi.fn().mockReturnValue(p)
  p.order = vi.fn().mockReturnValue(p)
  p.range = vi.fn().mockReturnValue(p)
  return p
}

describe('supabase repository batch validation reads (F08)', () => {
  it('getTimesheetsByIds queries timesheets with in("id", ids) and scopes to user for non-admin', async () => {
    const fakeQuery = createMockQuery([
      {
        id: 't-1',
        user_id: 'user-1',
        project_id: 'p-1',
        activity_type_id: null,
        log_date: '2026-01-01',
        hours_worked: 4,
        work_done: 'Work',
        created_at: '2026-01-01T00:00:00Z',
      },
    ])

    const mockClient = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue(fakeQuery),
      }),
    }
    mockGetAdminClient.mockReturnValue(mockClient as never)
    mockCreateClient.mockResolvedValue(mockClient as never)

    const rows = await supabaseRepository.getTimesheetsByIds(user, ['t-1'])
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe('t-1')
    expect(fakeQuery.in).toHaveBeenCalledWith('id', ['t-1'])
    expect(fakeQuery.eq).toHaveBeenCalledWith('user_id', user.id)
  })

  it('sumHoursForUserDates batches user/date reads and maps aggregate sums', async () => {
    const fakeQuery = createMockQuery([
      { user_id: 'u-1', log_date: '2026-01-01', hours_worked: 5 },
      { user_id: 'u-1', log_date: '2026-01-01', hours_worked: 3 },
      { user_id: 'u-2', log_date: '2026-01-02', hours_worked: 7 },
    ])

    const mockClient = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue(fakeQuery),
      }),
    }
    mockGetAdminClient.mockReturnValue(mockClient as never)
    mockCreateClient.mockResolvedValue(mockClient as never)

    const totals = await supabaseRepository.sumHoursForUserDates(admin, [
      { userId: 'u-1', logDate: '2026-01-01' },
      { userId: 'u-2', logDate: '2026-01-02' },
      { userId: 'u-3', logDate: '2026-01-03' },
    ])

    expect(totals.get('u-1:2026-01-01')).toBe(8)
    expect(totals.get('u-2:2026-01-02')).toBe(7)
    expect(totals.get('u-3:2026-01-03')).toBe(0)
    expect(fakeQuery.in).toHaveBeenCalledWith('user_id', ['u-1', 'u-2', 'u-3'])
    expect(fakeQuery.in).toHaveBeenCalledWith('log_date', ['2026-01-01', '2026-01-02', '2026-01-03'])
  })

  it('counts a repeated (userId, logDate) pair once without duplicating queried hours', async () => {
    const fakeQuery = createMockQuery([
      { user_id: 'u-1', log_date: '2026-01-01', hours_worked: 5 },
    ])

    const mockClient = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue(fakeQuery),
      }),
    }
    mockGetAdminClient.mockReturnValue(mockClient as never)
    mockCreateClient.mockResolvedValue(mockClient as never)

    const totals = await supabaseRepository.sumHoursForUserDates(admin, [
      { userId: 'u-1', logDate: '2026-01-01' },
      { userId: 'u-1', logDate: '2026-01-01' },
    ])

    expect(totals.size).toBe(1)
    expect(totals.get('u-1:2026-01-01')).toBe(5)
    expect(fakeQuery.in).toHaveBeenCalledWith('user_id', ['u-1'])
    expect(fakeQuery.in).toHaveBeenCalledWith('log_date', ['2026-01-01'])
  })

  it('excludes cross-product rows that were not requested (sparse pairs)', async () => {
    const fakeQuery = createMockQuery([
      { user_id: 'u-1', log_date: '2026-01-02', hours_worked: 7 },
    ])

    const mockClient = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue(fakeQuery),
      }),
    }
    mockGetAdminClient.mockReturnValue(mockClient as never)
    mockCreateClient.mockResolvedValue(mockClient as never)

    const totals = await supabaseRepository.sumHoursForUserDates(admin, [
      { userId: 'u-1', logDate: '2026-01-01' },
      { userId: 'u-2', logDate: '2026-01-02' },
    ])
    expect(totals.get('u-1:2026-01-01')).toBe(0)
    expect(totals.get('u-2:2026-01-02')).toBe(0)
  })

  it('scopes non-admin reads to the actor', async () => {
    const fakeQuery = createMockQuery([
      { user_id: 'user-1', log_date: '2026-01-01', hours_worked: 4 },
    ])

    const mockClient = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue(fakeQuery),
      }),
    }
    mockGetAdminClient.mockReturnValue(mockClient as never)
    mockCreateClient.mockResolvedValue(mockClient as never)

    const totals = await supabaseRepository.sumHoursForUserDates(user, [
      { userId: 'user-1', logDate: '2026-01-01' },
    ])
    expect(totals.get('user-1:2026-01-01')).toBe(4)
    expect(fakeQuery.eq).toHaveBeenCalledWith('user_id', 'user-1')
  })

  it('uses the request-scoped bearer client for daily aggregate reads', async () => {
    const { runWithMobileSupabaseClient } = await import('@/lib/supabase/bearer')
    const fakeQuery = createMockQuery([
      { user_id: 'u-1', log_date: '2026-01-01', hours_worked: 4 },
    ])
    const bearerClient = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue(fakeQuery),
      }),
    }
    mockCreateClient.mockResolvedValue({ from: vi.fn() } as never)

    const totals = await runWithMobileSupabaseClient(bearerClient as never, () =>
      supabaseRepository.sumHoursForUserDates(admin, [
        { userId: 'u-1', logDate: '2026-01-01' },
      ])
    )

    expect(totals.get('u-1:2026-01-01')).toBe(4)
    expect(bearerClient.from).toHaveBeenCalledWith('timesheets')
    expect(mockCreateClient).not.toHaveBeenCalled()
    expect(mockGetAdminClient).not.toHaveBeenCalled()
  })

  it('pages past the 1000-row API limit and chunks past 200 pairs', async () => {
    type Row = { user_id: string; log_date: string; hours_worked: number }
    // 1005 rows cycling all 201 requested users: 5 rows each, split by the
    // mock into a 1000-row page and a 5-row page per pair-chunk. The mock
    // ignores in() filters (like the real API it returns the cross-product),
    // so the exact-key in-memory filter does the correctness work.
    const rows: Row[] = Array.from({ length: 1005 }, (_, i) => ({
      user_id: `u-${(i % 201) + 1}`,
      log_date: '2026-01-01',
      hours_worked: 1,
    }))
    let lastRange: [number, number] = [0, 999]
    const inCalls: Array<{ col: string; vals: string[] }> = []
    // Faithful cross-product filtering: each from() starts a fresh filter set
    // (like a fresh PostgREST query), in() narrows it, and the page slice
    // applies to the filtered rows.
    let currentFilter: { userIds: Set<string> | null; dates: Set<string> | null } = {
      userIds: null,
      dates: null,
    }
    const paged: Record<string, unknown> = {}
    const builder = {
      in: vi.fn((col: string, vals: string[]) => {
        inCalls.push({ col, vals })
        if (col === 'user_id') currentFilter.userIds = new Set(vals)
        if (col === 'log_date') currentFilter.dates = new Set(vals)
        return paged
      }),
      eq: vi.fn(() => paged),
      order: vi.fn(() => paged),
      range: vi.fn((from: number, to: number) => {
        lastRange = [from, to]
        return paged
      }),
      then: (resolve: (v: unknown) => void) => {
        const filtered = rows.filter(
          (r) =>
            (!currentFilter.userIds || currentFilter.userIds.has(r.user_id)) &&
            (!currentFilter.dates || currentFilter.dates.has(r.log_date))
        )
        resolve({ data: filtered.slice(lastRange[0], lastRange[1] + 1), error: null })
      },
    }
    Object.assign(paged, builder)

    const mockClient = {
      from: vi.fn().mockImplementation(() => {
        currentFilter = { userIds: null, dates: null }
        return {
          select: vi.fn().mockReturnValue(paged),
        }
      }),
    }
    mockGetAdminClient.mockReturnValue(mockClient as never)
    mockCreateClient.mockResolvedValue(mockClient as never)

    // 201 distinct pairs forces two pair-chunks (200 + 1).
    const pairs = Array.from({ length: 201 }, (_, i) => ({
      userId: `u-${i + 1}`,
      logDate: '2026-01-01',
    }))
    const totals = await supabaseRepository.sumHoursForUserDates(admin, pairs)

    expect(totals.size).toBe(201)
    for (const p of pairs) {
      expect(totals.get(`${p.userId}:${p.logDate}`)).toBe(5)
    }
    for (const call of inCalls.filter((c) => c.col === 'user_id')) {
      expect(call.vals.length).toBeLessThanOrEqual(200)
    }
  })

  it('does not double-count cross-product rows across pair chunks', async () => {
    type Row = { user_id: string; log_date: string; hours_worked: number }
    const dbRows: Row[] = [
      { user_id: 'u-1', log_date: '2026-01-01', hours_worked: 4 },
      { user_id: 'u-2', log_date: '2026-01-02', hours_worked: 6 },
      // Intersecting Cartesian row that belongs to chunk 2's requested pair:
      { user_id: 'u-1', log_date: '2026-01-02', hours_worked: 8 },
    ]

    let currentFilter: { userIds: Set<string> | null; dates: Set<string> | null } = {
      userIds: null,
      dates: null,
    }
    let lastRange: [number, number] = [0, 999]
    const paged: Record<string, unknown> = {}
    const builder = {
      in: vi.fn((col: string, vals: string[]) => {
        if (col === 'user_id') currentFilter.userIds = new Set(vals)
        if (col === 'log_date') currentFilter.dates = new Set(vals)
        return paged
      }),
      eq: vi.fn(() => paged),
      order: vi.fn(() => paged),
      range: vi.fn((from: number, to: number) => {
        lastRange = [from, to]
        return paged
      }),
      then: (resolve: (v: unknown) => void) => {
        const filtered = dbRows.filter(
          (r) =>
            (!currentFilter.userIds || currentFilter.userIds.has(r.user_id)) &&
            (!currentFilter.dates || currentFilter.dates.has(r.log_date))
        )
        resolve({ data: filtered.slice(lastRange[0], lastRange[1] + 1), error: null })
      },
    }
    Object.assign(paged, builder)

    const mockClient = {
      from: vi.fn().mockImplementation(() => {
        currentFilter = { userIds: null, dates: null }
        return {
          select: vi.fn().mockReturnValue(paged),
        }
      }),
    }
    mockGetAdminClient.mockReturnValue(mockClient as never)
    mockCreateClient.mockResolvedValue(mockClient as never)

    // Construct 201 pairs:
    // Chunk 1: (u-1, 2026-01-01), (u-2, 2026-01-02), and dummy pairs (u-3..u-200, 2026-01-01)
    // Chunk 2: (u-1, 2026-01-02)
    const pairs = [
      { userId: 'u-1', logDate: '2026-01-01' },
      { userId: 'u-2', logDate: '2026-01-02' },
      ...Array.from({ length: 198 }, (_, i) => ({
        userId: `u-${i + 3}`,
        logDate: '2026-01-01',
      })),
      { userId: 'u-1', logDate: '2026-01-02' }, // pair #201 -> chunk 2
    ]

    const totals = await supabaseRepository.sumHoursForUserDates(admin, pairs)

    // u-1:2026-01-02 should be exactly 8, NOT double-counted as 16
    expect(totals.get('u-1:2026-01-02')).toBe(8)
    expect(totals.get('u-1:2026-01-01')).toBe(4)
    expect(totals.get('u-2:2026-01-02')).toBe(6)
  })

  it('uses exact count and stable ordering when the server caps pages below 1000 rows', async () => {
    type Row = { user_id: string; log_date: string; hours_worked: number }
    const pageRows: Record<number, Row[]> = {
      0: [
        { user_id: 'u-1', log_date: '2026-01-01', hours_worked: 4 },
        { user_id: 'u-1', log_date: '2026-01-01', hours_worked: 5 },
      ],
      2: [{ user_id: 'u-1', log_date: '2026-01-01', hours_worked: 6 }],
    }
    const rangeStarts: number[] = []
    const selectCalls: Array<[string, unknown]> = []
    const orderCalls: Array<[string, unknown]> = []

    const client = {
      from: vi.fn(() => {
        let from = 0
        const builder: Record<string, unknown> = {
          in: vi.fn().mockReturnThis(),
          order: vi.fn((column: string, options: unknown) => {
            orderCalls.push([column, options])
            return builder
          }),
          range: vi.fn((start: number) => {
            from = start
            rangeStarts.push(start)
            return builder
          }),
          then: (resolve: (value: unknown) => unknown) =>
            Promise.resolve({ data: pageRows[from] ?? [], error: null, count: 3 }).then(resolve),
        }
        return {
          select: vi.fn((columns: string, options: unknown) => {
            selectCalls.push([columns, options])
            return builder
          }),
        }
      }),
    }
    mockCreateClient.mockResolvedValue(client as never)

    const totals = await supabaseRepository.sumHoursForUserDates(admin, [
      { userId: 'u-1', logDate: '2026-01-01' },
    ])

    expect(totals.get('u-1:2026-01-01')).toBe(15)
    expect(rangeStarts).toEqual([0, 2])
    expect(selectCalls).toEqual([
      ['user_id, log_date, hours_worked', { count: 'exact' }],
      ['user_id, log_date, hours_worked', { count: 'exact' }],
    ])
    expect(orderCalls).toEqual([
      ['id', { ascending: true }],
      ['id', { ascending: true }],
    ])
  })

  it('continues after a short page until range exhaustion', async () => {
    type Row = { user_id: string; log_date: string; hours_worked: number }
    const pageRows: Record<number, Row[]> = {
      0: [
        { user_id: 'u-1', log_date: '2026-01-01', hours_worked: 4 },
        { user_id: 'u-1', log_date: '2026-01-01', hours_worked: 5 },
      ],
      2: [{ user_id: 'u-1', log_date: '2026-01-01', hours_worked: 6 }],
    }
    const rangeStarts: number[] = []

    const client = {
      from: vi.fn(() => {
        let from = 0
        const builder: Record<string, unknown> = {
          in: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          range: vi.fn((start: number) => {
            from = start
            rangeStarts.push(start)
            return builder
          }),
          then: (resolve: (value: unknown) => unknown) =>
            Promise.resolve({ data: pageRows[from] ?? [], error: null }).then(resolve),
        }
        return { select: vi.fn().mockReturnValue(builder) }
      }),
    }
    mockCreateClient.mockResolvedValue(client as never)

    const totals = await supabaseRepository.sumHoursForUserDates(admin, [
      { userId: 'u-1', logDate: '2026-01-01' },
    ])

    expect(totals.get('u-1:2026-01-01')).toBe(15)
    expect(rangeStarts).toEqual([0, 2, 3])
  })

  it('pages sumHoursForUserDate and preserves the excluded entry filter', async () => {
    const pageRows: Record<number, Array<{ id: string; hours_worked: number }>> = {
      0: [
        { id: 'a', hours_worked: 2 },
        { id: 'd', hours_worked: 3 },
      ],
      2: [{ id: 'c', hours_worked: 4 }],
    }
    const rangeStarts: number[] = []
    const neq = vi.fn()

    const client = {
      from: vi.fn(() => {
        let from = 0
        const builder: Record<string, unknown> = {
          eq: vi.fn().mockReturnThis(),
          neq: vi.fn((...args: unknown[]) => {
            neq(...args)
            return builder
          }),
          order: vi.fn().mockReturnThis(),
          range: vi.fn((start: number) => {
            from = start
            rangeStarts.push(start)
            return builder
          }),
          then: (resolve: (value: unknown) => unknown) =>
            Promise.resolve({ data: pageRows[from] ?? [], error: null }).then(resolve),
        }
        return { select: vi.fn().mockReturnValue(builder) }
      }),
    }
    mockCreateClient.mockResolvedValue(client as never)

    const total = await supabaseRepository.sumHoursForUserDate(admin, 'u-1', '2026-01-01', 'b')

    expect(total).toBe(9)
    expect(neq).toHaveBeenCalledWith('id', 'b')
    expect(rangeStarts).toEqual([0, 2, 3])
  })

  it('propagates a transient error from a later paged totals request', async () => {
    const rangeStarts: number[] = []
    const client = {
      from: vi.fn(() => {
        let from = 0
        const builder: Record<string, unknown> = {
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          range: vi.fn((start: number) => {
            from = start
            rangeStarts.push(start)
            return builder
          }),
          then: (resolve: (value: unknown) => unknown) =>
            Promise.resolve(
              from === 0
                ? { data: [{ id: 'a', hours_worked: 2 }], error: null, count: 2 }
                : { data: null, error: { message: 'temporary PostgREST failure' }, count: 2 }
            ).then(resolve),
        }
        return { select: vi.fn().mockReturnValue(builder) }
      }),
    }
    mockCreateClient.mockResolvedValue(client as never)

    await expect(supabaseRepository.sumHoursForUserDate(admin, 'u-1', '2026-01-01')).rejects.toThrow(
      'temporary PostgREST failure'
    )
    expect(rangeStarts).toEqual([0, 1])
  })
})
