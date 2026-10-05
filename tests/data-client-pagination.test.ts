// tests/data-client-pagination.test.ts
// Tests for the pagination parameter mapping in the backend-neutral data
// facade. Timesheet reads always go through the versioned HTTP resource.
import { describe, expect, it, vi, beforeEach } from 'vitest'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

describe('data client pagination', () => {
  beforeEach(() => {
    mockFetch.mockClear()
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: { rows: [], count: 0 }, error: null }),
    } as Response)
  })

  it('maps from/to/limit to query params', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: { rows: [], count: 42 }, error: null }),
    } as Response)
    const { dataClient } = await import('../lib/data/client')
    const result = await dataClient.getTimesheets({ from: 0, to: 49, limit: 50 })
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost/api/v1/timesheets?from=0&to=49&limit=50',
      expect.any(Object)
    )
    // The paged response keeps the full match total so callers can page.
    expect(result.count).toBe(42)
  })

  it('omits pagination params when not provided', async () => {
    const { dataClient } = await import('../lib/data/client')
    await dataClient.getTimesheets({})
    expect(mockFetch).toHaveBeenCalledWith('http://localhost/api/v1/timesheets', expect.any(Object))
  })

  it.each([false, true])('forwards includeCount=%s over HTTP', async (includeCount) => {
    const { dataClient } = await import('../lib/data/client')
    const result = await dataClient.getTimesheets({ includeCount })
    expect(mockFetch).toHaveBeenCalledWith(
      `http://localhost/api/v1/timesheets?includeCount=${includeCount}`,
      expect.any(Object)
    )
    expect(result.error).toBeNull()
  })

  it('preserves HTTP failures for a count-free request', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ data: null, error: { code: 'VALIDATION_ERROR', message: 'Invalid query' } }),
    } as Response)
    const { dataClient } = await import('../lib/data/client')
    expect(await dataClient.getTimesheets({ includeCount: false })).toEqual({
      data: null, count: null, error: 'Invalid query',
    })
  })

  it('includes only provided params', async () => {
    const { dataClient } = await import('../lib/data/client')
    await dataClient.getTimesheets({ from: 100 })
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost/api/v1/timesheets?from=100',
      expect.any(Object)
    )
  })

  it('reads the personal Last preview without reusing shared flights and maps its DTO', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ data: { entry: { id: 'latest', user_id: 'alice', project_name: 'Project', hours_worked: 2 } }, error: null }) } as Response)
    const { dataClient } = await import('../lib/data/client')
    const [first, second] = await Promise.all([dataClient.getLastTimesheet(), dataClient.getLastTimesheet()])
    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(first).toEqual(second)
    expect(first.data).toMatchObject({ id: 'latest', user_id: 'alice', projects: { name: 'Project' } })
    expect(mockFetch).toHaveBeenCalledWith('http://localhost/api/v1/timesheets/last', expect.any(Object))
  })
})
