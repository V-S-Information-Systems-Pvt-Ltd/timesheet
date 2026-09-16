// tests/data-client-native.test.ts
// Coverage for the native (fetch-based) adapter of lib/data/client.ts:
// verifies the URL path/method/body each method produces.
import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { DataClient } from '../lib/data/client'

vi.mock('@/lib/backend/config', () => ({ IS_NATIVE: true }))
vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }))

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

async function jsonResponse(body: unknown, status = 200): Promise<Response> {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
}

describe('native data client', () => {
  let dataClient: DataClient

  beforeEach(async () => {
    mockFetch.mockReset()
    vi.resetModules()
    const mod = await import('../lib/data/client')
    dataClient = mod.dataClient
  })

  it('getProjects GETs /api/data/projects', async () => {
    mockFetch.mockResolvedValue(await jsonResponse({ data: [{ id: 'p1' }], error: null }))
    expect(await dataClient.getProjects()).toEqual({ data: [{ id: 'p1' }], error: null })
    expect(mockFetch).toHaveBeenCalledWith('/api/data/projects', expect.objectContaining({ credentials: 'same-origin' }))
  })

  it('getTimesheets builds from/to/limit query params on the versioned resource', async () => {
    mockFetch.mockResolvedValue(await jsonResponse({ data: { rows: [], count: 0 }, error: null }))
    await dataClient.getTimesheets({ from: 0, to: 49, limit: 50 })
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost/api/v1/timesheets?from=0&to=49&limit=50',
      expect.any(Object)
    )
    await dataClient.getTimesheets({})
    expect(mockFetch).toHaveBeenCalledWith('http://localhost/api/v1/timesheets', expect.any(Object))
  })

  it('getTimesheets maps the flat wire DTO back to the row shape consumers use', async () => {
    mockFetch.mockResolvedValue(
      await jsonResponse({
        data: {
          rows: [
            {
              id: 't1',
              user_id: 'u1',
              user_email: 'u@example.com',
              project_id: 'p1',
              project_name: 'Alpha',
              activity_type_id: 'a1',
              activity_name: 'Development',
              log_date: '2026-09-12',
              hours_worked: 7.5,
              work_done: 'Work',
              created_at: '2026-09-12T10:00:00.000Z',
            },
          ],
          count: 1,
        },
        error: null,
      })
    )
    const result = await dataClient.getTimesheets()
    expect(result.count).toBe(1)
    expect(result.error).toBeNull()
    expect(result.data?.[0]).toMatchObject({
      id: 't1',
      hours_worked: 7.5,
      projects: { name: 'Alpha' },
      activity_types: { name: 'Development' },
      profiles: { email: 'u@example.com' },
    })
  })

  it('getTimesheets surfaces transport errors without throwing', async () => {
    mockFetch.mockResolvedValue(
      await jsonResponse({ data: null, error: { code: 'FORBIDDEN', message: 'Nope.' } }, 403)
    )
    const result = await dataClient.getTimesheets()
    expect(result.data).toBeNull()
    expect(result.error).toBe('Nope.')
  })

  it('profile + backfill + activity-type getters', async () => {
    mockFetch.mockResolvedValue(await jsonResponse({ data: { id: 'u1' }, error: null }))
    await dataClient.getAllUsers()
    expect(mockFetch).toHaveBeenCalledWith('/api/data/profiles', expect.any(Object))
    await dataClient.getProfile()
    expect(mockFetch).toHaveBeenCalledWith('/api/data/profile', expect.any(Object))
    await dataClient.getBackfillWindow()
    expect(mockFetch).toHaveBeenCalledWith('/api/data/backfill-window', expect.any(Object))
  })

  it('activity types (all vs active)', async () => {
    mockFetch.mockResolvedValue(await jsonResponse({ data: [], error: null }))
    await dataClient.getActivityTypes()
    expect(mockFetch).toHaveBeenCalledWith('/api/data/activity-types', expect.any(Object))
    await dataClient.getAllActivityTypes()
    expect(mockFetch).toHaveBeenCalledWith('/api/data/activity-types?all=1', expect.any(Object))
  })

  it('leaves: read (with filters), insert, delete', async () => {
    mockFetch.mockResolvedValue(await jsonResponse({ data: [], error: null }))
    await dataClient.getLeaves({ userId: 'u1', from: '2026-01-01', to: '2026-02-01' })
    expect(mockFetch).toHaveBeenCalledWith('/api/data/leaves?userId=u1&from=2026-01-01&to=2026-02-01', expect.any(Object))
    await dataClient.insertLeaves([{ userId: 'u1', leaveDate: 'd', reason: 'r' }])
    expect(mockFetch).toHaveBeenCalledWith('/api/data/leaves', expect.objectContaining({ method: 'POST' }))
    await dataClient.deleteLeave('l1')
    expect(mockFetch).toHaveBeenCalledWith('/api/data/leaves?id=l1', expect.objectContaining({ method: 'DELETE' }))
  })

  it('reminders: read, insert, update, delete', async () => {
    mockFetch.mockResolvedValue(await jsonResponse({ data: [], error: null }))
    await dataClient.getReminders()
    expect(mockFetch).toHaveBeenCalledWith('/api/data/reminders', expect.any(Object))
    await dataClient.insertReminder({ userId: 'u1', message: 'm', remindAt: 'd' })
    expect(mockFetch).toHaveBeenCalledWith('/api/data/reminders', expect.objectContaining({ method: 'POST' }))
    await dataClient.updateReminder('r1', true)
    expect(mockFetch).toHaveBeenCalledWith('/api/data/reminders', expect.objectContaining({ method: 'PATCH' }))
    await dataClient.deleteReminder('r1')
    expect(mockFetch).toHaveBeenCalledWith('/api/data/reminders?id=r1', expect.objectContaining({ method: 'DELETE' }))
  })

  it('global reminders: due vs all', async () => {
    mockFetch.mockResolvedValue(await jsonResponse({ data: [], error: null }))
    await dataClient.getDueGlobalReminders()
    expect(mockFetch).toHaveBeenCalledWith('/api/data/global-reminders', expect.any(Object))
    await dataClient.getGlobalReminders()
    expect(mockFetch).toHaveBeenCalledWith('/api/data/global-reminders?all=1', expect.any(Object))
  })

  it('getReportTotals queries /api/data/reports with query params', async () => {
    mockFetch.mockResolvedValue(await jsonResponse({ data: { totalHours: 10, totalEntries: 2, byGroup: [] }, error: null }))
    const res = await dataClient.getReportTotals({ project: 'p1', from: '2026-08-01', to: '2026-08-31', groupBy: 'user' })
    expect(mockFetch).toHaveBeenCalledWith('/api/data/reports?project=p1&from=2026-08-01&to=2026-08-31&groupBy=user', expect.any(Object))
    expect(res.data?.totalHours).toBe(10)
  })
})
