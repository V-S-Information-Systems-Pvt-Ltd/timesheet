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

  it('reads reference data over /api/data instead of the database client', async () => {
    mockFetch.mockResolvedValue(await jsonResponse({ data: [{ id: 'p1', name: 'Alpha' }] }))
    expect(await dataClient.getProjects()).toEqual({ data: [{ id: 'p1', name: 'Alpha' }], error: null })
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost/api/data/projects',
      expect.objectContaining({ credentials: 'same-origin' })
    )

    mockFetch.mockResolvedValue(await jsonResponse({ data: [{ id: 'a1', name: 'R&D' }] }))
    expect(await dataClient.getActivityTypes()).toEqual({ data: [{ id: 'a1', name: 'R&D' }], error: null })
    await dataClient.getAllActivityTypes()
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost/api/data/activity-types?all=1',
      expect.any(Object)
    )
  })

  it('reads profiles and the signed-in profile over /api/data', async () => {
    mockFetch.mockResolvedValue(await jsonResponse({ data: [{ id: 'u1', email: 'a@b.com' }] }))
    expect(await dataClient.getAllUsers()).toEqual({ data: [{ id: 'u1', email: 'a@b.com' }], error: null })
    expect(mockFetch).toHaveBeenCalledWith('http://localhost/api/data/profiles', expect.any(Object))

    mockFetch.mockResolvedValue(await jsonResponse({ data: { id: 'u1' } }))
    expect(await dataClient.getProfile('u1')).toEqual({ data: { id: 'u1' }, error: null })
    expect(mockFetch).toHaveBeenCalledWith('http://localhost/api/data/profile', expect.any(Object))
  })

  it('normalizes the backfill window over /api/data', async () => {
    mockFetch.mockResolvedValue(
      await jsonResponse({ data: { mode: 'month_start', windowDays: 30, extraDays: 2 } })
    )
    expect(await dataClient.getBackfillWindow()).toEqual({
      data: { mode: 'month_start', windowDays: 30, extraDays: 2 },
    })
    expect(mockFetch).toHaveBeenCalledWith('http://localhost/api/data/backfill-window', expect.any(Object))
  })

  it('leaves: read, insert, delete over /api/data', async () => {
    mockFetch.mockResolvedValue(await jsonResponse({ data: [{ id: 'l1', user_id: 'u1' }] }))
    expect(await dataClient.getLeaves({ userId: 'u1' })).toEqual({ data: [{ id: 'l1', user_id: 'u1' }], error: null })
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost/api/data/leaves?userId=u1',
      expect.any(Object)
    )

    mockFetch.mockResolvedValue(await jsonResponse({ error: null }))
    expect(await dataClient.insertLeaves([{ userId: 'u1', leaveDate: '2026-08-02', reason: 'r' }])).toEqual({
      error: null,
    })
    expect(await dataClient.deleteLeave('l1')).toEqual({ error: null })

    mockFetch.mockResolvedValue(await jsonResponse({ error: 'no' }, 403))
    expect(await dataClient.insertLeaves([])).toEqual({ error: 'no' })
  })

  it('reminders: read, insert, update, delete over /api/data', async () => {
    mockFetch.mockResolvedValue(await jsonResponse({ data: [{ id: 'r1', user_id: 'u1' }] }))
    expect(await dataClient.getReminders('u1')).toEqual({ data: [{ id: 'r1', user_id: 'u1' }], error: null })
    mockFetch.mockResolvedValue(await jsonResponse({ error: null }))
    expect(await dataClient.insertReminder({ userId: 'u1', message: 'm', remindAt: '2026-08-03' })).toEqual({
      error: null,
    })
    expect(await dataClient.updateReminder('r1', true)).toEqual({ error: null })
    expect(await dataClient.deleteReminder('r1')).toEqual({ error: null })
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost/api/data/reminders',
      expect.objectContaining({ method: 'PATCH' })
    )
  })

  it('global reminders: due list and all getter over /api/data', async () => {
    mockFetch.mockResolvedValue(await jsonResponse({ data: [{ id: 'g2' }] }))
    expect(await dataClient.getDueGlobalReminders()).toEqual({ data: [{ id: 'g2' }], error: null })
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost/api/data/global-reminders',
      expect.any(Object)
    )
    expect(await dataClient.getGlobalReminders()).toEqual({ data: [{ id: 'g2' }], error: null })
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost/api/data/global-reminders?all=1',
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
      'http://localhost/api/data/reports?project=p2&from=2026-08-01&to=2026-08-31&groupBy=project',
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
