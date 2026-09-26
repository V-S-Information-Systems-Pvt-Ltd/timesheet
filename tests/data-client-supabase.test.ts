// tests/data-client-supabase.test.ts
// The browser data facade must be backend-neutral: in the supabase build mode
// it still reads/writes over the cookie-authenticated HTTP routes and never
// constructs a database client. This test simulates supabase mode and fails
// loudly if the facade reaches for the browser Supabase client.
import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { DataClient } from '../lib/data/client'

vi.mock('@/lib/backend/config', () => ({ IS_NATIVE: false }))

// Any use of the browser database client throws, so a backend-selecting or
// direct-query regression fails this suite instead of silently passing.
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => {
    throw new Error('browser data facade must not create a database client')
  },
}))

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

async function jsonResponse(body: unknown, status = 200): Promise<Response> {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
}

describe('backend-neutral data client (supabase build mode)', () => {
  let dataClient: DataClient

  beforeEach(async () => {
    mockFetch.mockReset()
    vi.resetModules()
    const mod = await import('../lib/data/client')
    dataClient = mod.dataClient
  })

  it('reads timesheets from the versioned HTTP resource in supabase mode too', async () => {
    mockFetch.mockResolvedValue(
      await jsonResponse({
        data: {
          rows: [
            {
              id: 't1',
              user_id: 'u1',
              project_id: 'p1',
              activity_type_id: null,
              log_date: '2026-08-01',
              hours_worked: 8,
              work_done: 'x',
              created_at: '2026-08-01T10:00:00.000Z',
            },
          ],
          count: 1,
        },
        error: null,
      })
    )
    const result = await dataClient.getTimesheets({ from: 0, to: 49, limit: 50 })
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost/api/v1/timesheets?from=0&to=49&limit=50',
      expect.any(Object)
    )
    expect(result.count).toBe(1)
    expect(result.data?.[0]).toMatchObject({ id: 't1', hours_worked: 8 })
  })

  it('reads projects over /api/v1/reference instead of the database client', async () => {
    mockFetch.mockResolvedValue(await jsonResponse({
      data: {
        projects: [{
          id: 'p1',
          name: 'Alpha',
          so_number: null,
          telegram_no: null,
          created_at: '2026-09-26T00:00:00.000Z',
        }],
      },
    }))
    expect(await dataClient.getProjects()).toEqual({
      data: [{
        id: 'p1',
        name: 'Alpha',
        so_number: null,
        telegram_no: null,
        created_at: '2026-09-26T00:00:00.000Z',
      }],
      error: null,
    })
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost/api/v1/reference',
      expect.objectContaining({ credentials: 'same-origin' })
    )

    mockFetch.mockResolvedValue(await jsonResponse({
      data: {
        activityTypes: [{
          id: 'a1',
          name: 'R&D',
          is_active: true,
          telegram_no: null,
          created_at: '2026-09-26T00:00:00.000Z',
        }],
      },
    }))
    expect(await dataClient.getActivityTypes()).toEqual({
      data: [{
        id: 'a1',
        name: 'R&D',
        is_active: true,
        telegram_no: null,
        created_at: '2026-09-26T00:00:00.000Z',
      }],
      error: null,
    })

    mockFetch.mockResolvedValue(await jsonResponse({
      data: {
        activityTypes: [{
          id: 'a2',
          name: 'Retired',
          is_active: false,
          telegram_no: null,
          created_at: '2026-09-25T00:00:00.000Z',
        }],
      },
    }))
    expect(await dataClient.getAllActivityTypes()).toEqual({
      data: [{
        id: 'a2',
        name: 'Retired',
        is_active: false,
        telegram_no: null,
        created_at: '2026-09-25T00:00:00.000Z',
      }],
      error: null,
    })
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost/api/v1/reference?all=1',
      expect.any(Object)
    )
  })

  it('reads people and the signed-in profile over v1', async () => {
    mockFetch.mockResolvedValue(await jsonResponse({
      data: [{
        id: 'u1',
        email: 'a@b.com',
        name: 'A',
        role: 'co',
        permissionRole: 'co',
        hierarchyRole: 'user',
        department: 'Ops',
        title: 'Coordinator',
        managerId: 'mgr-1',
        isActive: false,
        dashboardLayout: null,
        adminLayout: [{ id: 'users', enabled: true }],
        mobileLayout: null,
        createdAt: '2026-09-25T00:00:00.000Z',
      }],
    }))
    expect(await dataClient.getAllUsers()).toEqual({
      data: [{
        id: 'u1',
        email: 'a@b.com',
        name: 'A',
        role: 'co',
        permission_role: 'co',
        hierarchy_role: 'user',
        department: 'Ops',
        title: 'Coordinator',
        manager_id: 'mgr-1',
        is_active: false,
        dashboard_layout: null,
        admin_layout: [{ id: 'users', enabled: true }],
        mobile_layout: null,
        created_at: '2026-09-25T00:00:00.000Z',
      }],
      error: null,
    })
    expect(mockFetch).toHaveBeenCalledWith('http://localhost/api/v1/people', expect.any(Object))

    mockFetch.mockResolvedValue(await jsonResponse({ data: { id: 'u1' } }))
    expect(await dataClient.getProfile('u1')).toEqual({ data: { id: 'u1' }, error: null })
    expect(mockFetch).toHaveBeenCalledWith('http://localhost/api/v1/profile', expect.any(Object))
  })

  it('normalizes the backfill window over v1', async () => {
    mockFetch.mockResolvedValue(
      await jsonResponse({ data: { mode: 'month_start', windowDays: 30, extraDays: 2 } })
    )
    expect(await dataClient.getBackfillWindow()).toEqual({
      data: { mode: 'month_start', windowDays: 30, extraDays: 2 },
    })
    expect(mockFetch).toHaveBeenCalledWith('http://localhost/api/v1/settings/backfill', expect.any(Object))
  })

  it('leaves: read, insert, delete over /api/v1', async () => {
    mockFetch.mockResolvedValue(await jsonResponse({ data: [{ id: 'l1', user_id: 'u1' }] }))
    expect(await dataClient.getLeaves({ userId: 'u1' })).toEqual({ data: [{ id: 'l1', user_id: 'u1' }], error: null })
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost/api/v1/leaves?userId=u1',
      expect.any(Object)
    )

    mockFetch.mockResolvedValue(await jsonResponse({ data: { success: true }, error: null }, 201))
    expect(await dataClient.insertLeaves([{ userId: 'u1', leaveDate: '2026-08-02', reason: 'r' }])).toEqual({
      error: null,
    })
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost/api/v1/leaves',
      expect.objectContaining({ method: 'POST' })
    )

    mockFetch.mockResolvedValue(await jsonResponse({ data: { success: true }, error: null }))
    expect(await dataClient.deleteLeave('l1')).toEqual({ error: null })
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost/api/v1/leaves/l1',
      expect.objectContaining({ method: 'DELETE' })
    )

    mockFetch.mockResolvedValue(await jsonResponse({
      data: null,
      error: { code: 'VALIDATION_ERROR', message: 'no', fieldErrors: { rows: ['Required'] } },
    }, 400))
    expect(await dataClient.insertLeaves([])).toEqual({ error: 'no' })
  })

  it('reminders: read, insert, update, delete over /api/v1', async () => {
    mockFetch.mockResolvedValue(await jsonResponse({ data: [{ id: 'r1', user_id: 'u1' }] }))
    expect(await dataClient.getReminders('u1')).toEqual({ data: [{ id: 'r1', user_id: 'u1' }], error: null })
    expect(mockFetch).toHaveBeenCalledWith('http://localhost/api/v1/reminders', expect.any(Object))

    mockFetch.mockResolvedValue(await jsonResponse({ data: { success: true }, error: null }, 201))
    expect(await dataClient.insertReminder({ userId: 'u1', message: 'm', remindAt: '2026-08-03' })).toEqual({
      error: null,
    })
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost/api/v1/reminders',
      expect.objectContaining({ method: 'POST' })
    )

    mockFetch.mockResolvedValue(await jsonResponse({ data: { success: true }, error: null }))
    expect(await dataClient.updateReminder('r1', true)).toEqual({ error: null })
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost/api/v1/reminders/r1',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ done: true }) })
    )

    expect(await dataClient.deleteReminder('r1')).toEqual({ error: null })
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost/api/v1/reminders/r1',
      expect.objectContaining({ method: 'DELETE' })
    )
  })

  it('global reminders: due list and all getter over /api/v1', async () => {
    mockFetch.mockResolvedValue(await jsonResponse({ data: [{ id: 'g2' }] }))
    expect(await dataClient.getDueGlobalReminders()).toEqual({ data: [{ id: 'g2' }], error: null })
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost/api/v1/reminders/global',
      expect.any(Object)
    )
    expect(await dataClient.getGlobalReminders()).toEqual({ data: [{ id: 'g2' }], error: null })
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost/api/v1/reminders/global?all=1',
      expect.any(Object)
    )
  })

  it('getReportTotals fetches /api/data/reports with query params', async () => {
    mockFetch.mockResolvedValue(
      await jsonResponse({ data: { totalHours: 12, totalEntries: 3, byGroup: [] } })
    )
    const res = await dataClient.getReportTotals({
      project: 'p2',
      from: '2026-08-01',
      to: '2026-08-31',
      groupBy: 'project',
    })
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost/api/v1/reports?project=p2&from=2026-08-01&to=2026-08-31&groupBy=project',
      expect.any(Object)
    )
    expect(res.data?.totalHours).toBe(12)

    mockFetch.mockResolvedValue(await jsonResponse({ error: 'Nope.' }, 403))
    expect(await dataClient.getReportTotals()).toEqual({ data: null, error: 'Nope.' })
  })

  it('does not turn a non-JSON compatibility failure into a successful write', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error('not JSON')
      },
    } as unknown as Response)

    await expect(
      dataClient.insertReminder({ userId: 'u1', message: 'm', remindAt: '2026-08-04' })
    ).resolves.toEqual({ error: 'Request failed with status 500.' })
  })

  it('rejects malformed successful compatibility payloads', async () => {
    mockFetch.mockResolvedValue(await jsonResponse(null))

    await expect(
      dataClient.insertReminder({ userId: 'u1', message: 'm', remindAt: '2026-08-05' })
    ).resolves.toEqual({ error: 'The server returned an invalid response.' })

    await expect(dataClient.getProjects()).resolves.toEqual({
      data: null,
      error: 'The server returned an invalid response.',
    })
  })
})
