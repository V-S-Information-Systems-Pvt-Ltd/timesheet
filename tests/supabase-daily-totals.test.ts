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

describe('supabase repository bulkUpdateTimesheets (Phase 4.4)', () => {
  function makeAdminClient(owners: Array<{ id: string; user_id: string }>, updateResult: { error: unknown }) {
    const fromFn = vi.fn().mockResolvedValue({ data: owners, error: null })
    const updateFn = vi.fn().mockResolvedValue(updateResult)
    const client = {
      from: vi.fn((table: string) => {
        if (table === 'timesheets') {
          return {
            select: () => ({ in: fromFn }),
            update: () => ({ eq: updateFn }),
          }
        }
        throw new Error('unexpected table ' + table)
      }),
    }
    mockGetAdminClient.mockReturnValue(client as never)
    return { fromFn, updateFn, client }
  }

  it('updates only rows the actor owns for a non-admin', async () => {
    const { updateFn } = makeAdminClient(
      [
        { id: 'own', user_id: 'user-1' },
        { id: 'other', user_id: 'someone-else' },
      ],
      { error: null }
    )
    const result = await supabaseRepository.bulkUpdateTimesheets(user, [
      { id: 'own', projectId: 'p1', activityTypeId: 'a1', hoursWorked: 5, workDone: 'x', logDate: '2026-01-01' },
      { id: 'other', projectId: 'p1', activityTypeId: null, hoursWorked: 3, workDone: 'y', logDate: '2026-01-02' },
    ])
    expect(result.updated).toBe(1)
    expect(result.rowErrors).toHaveLength(1)
    expect(result.rowErrors[0].id).toBe('other')
    // Only the owned row is sent to the update.
    expect(updateFn).toHaveBeenCalledTimes(1)
  })

  it('admins can update any row', async () => {
    const { updateFn } = makeAdminClient(
      [
        { id: 'a', user_id: 'u1' },
        { id: 'b', user_id: 'u2' },
      ],
      { error: null }
    )
    const result = await supabaseRepository.bulkUpdateTimesheets(admin, [
      { id: 'a', projectId: 'p1', activityTypeId: null, hoursWorked: 1, workDone: 'x', logDate: '2026-01-01' },
      { id: 'b', projectId: 'p1', activityTypeId: null, hoursWorked: 2, workDone: 'y', logDate: '2026-01-02' },
    ])
    expect(result.updated).toBe(2)
    expect(result.rowErrors).toHaveLength(0)
    expect(updateFn).toHaveBeenCalledTimes(2)
  })
})