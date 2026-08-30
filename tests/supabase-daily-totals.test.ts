// tests/supabase-daily-totals.test.ts
// Regression coverage for the Phase 4.3 security fix: the daily hour-totals
// RPC exposes EVERY user's hours, so the adapter must be admin-gated (matching
// the native adapter) and must call the RPC only through the service-role
// client. A non-admin actor gets [] without any client call; an admin call
// goes through the service-role client's typed rpc().
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
const user: Actor = { id: 'user-1', email: 'user@x.com', role: 'user', permission_role: 'user', hierarchy_role: 'user', isActive: true }

function makeAdminClient(rpcResult: unknown) {
  mockGetAdminClient.mockReturnValue({
    rpc: vi.fn().mockResolvedValue(rpcResult),
  } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('supabase repository getTimesheetDailyTotals (admin gate)', () => {
  it('returns [] for non-admin actors without calling any client', async () => {
    const result = await supabaseRepository.getTimesheetDailyTotals(user)
    expect(result).toEqual([])
    expect(mockGetAdminClient).not.toHaveBeenCalled()
    expect(mockCreateClient).not.toHaveBeenCalled()
  })

  it('calls the grouped RPC through the service-role client for admins', async () => {
    makeAdminClient({
      data: [
        { user_id: 'user-1', log_date: '2024-01-01', hours: 7.5 },
        { user_id: 'user-2', log_date: '2024-01-02', hours: 4 },
      ],
      error: null,
    })

    const result = await supabaseRepository.getTimesheetDailyTotals(admin)
    expect(result).toEqual([
      { userId: 'user-1', logDate: '2024-01-01', hours: 7.5 },
      { userId: 'user-2', logDate: '2024-01-02', hours: 4 },
    ])
    const adminClient = mockGetAdminClient.mock.results[0].value
    expect(adminClient.rpc).toHaveBeenCalledWith('get_timesheet_daily_totals')
    expect(mockCreateClient).not.toHaveBeenCalled()
  })

  it('does not silently fall back when the RPC errors — it throws', async () => {
    makeAdminClient({ data: null, error: { message: 'permission denied for function get_timesheet_daily_totals' } })

    await expect(supabaseRepository.getTimesheetDailyTotals(admin)).rejects.toThrow(
      /permission denied for function/
    )
  })

  it('coerces a non-string log_date and non-number hours defensively', async () => {
    makeAdminClient({
      data: [{ user_id: 'user-1', log_date: '2024-03-05T00:00:00', hours: '6.25' }],
      error: null,
    })

    const result = await supabaseRepository.getTimesheetDailyTotals(admin)
    expect(result).toEqual([{ userId: 'user-1', logDate: '2024-03-05T00:00:00', hours: 6.25 }])
  })
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

type MockQueryBuilder = Promise<{ data: unknown; error: unknown }> & {
  in: ReturnType<typeof vi.fn>
  eq: ReturnType<typeof vi.fn>
}

function createMockQuery(data: unknown, error: unknown = null): MockQueryBuilder {
  const p = Promise.resolve({ data, error }) as MockQueryBuilder
  p.in = vi.fn().mockReturnValue(p)
  p.eq = vi.fn().mockReturnValue(p)
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
})