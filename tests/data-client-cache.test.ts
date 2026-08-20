// tests/data-client-cache.test.ts
// Tests for the in-flight single-flight dedupe cache in lib/data/client.ts
// (native adapter): concurrent identical fetches share one request, and the
// cache clears once settled so the next call re-fetches.
import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { DataClient } from '../lib/data/client'

vi.mock('@/lib/backend/client', () => ({ IS_NATIVE: true }))
vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }))

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

async function jsonResponse(body: unknown): Promise<Response> {
  return { ok: true, status: 200, json: async () => body } as Response
}

describe('data client single-flight cache (native)', () => {
  let dataClient: DataClient

  beforeEach(async () => {
    mockFetch.mockReset()
    vi.resetModules()
    const mod = await import('../lib/data/client')
    dataClient = mod.dataClient
  })

  it('dedupes simultaneous identical fetches into one request', async () => {
    mockFetch.mockResolvedValue(await jsonResponse({ data: [{ id: 't1' }], count: 1, error: null }))
    const [a, b] = await Promise.all([
      dataClient.getTimesheets({ from: 0, to: 9, limit: 10 }),
      dataClient.getTimesheets({ from: 0, to: 9, limit: 10 }),
    ])
    expect(a).toEqual(b)
    const url = '/api/data/timesheets?from=0&to=9&limit=10'
    expect(mockFetch.mock.calls.filter(([u]) => u === url).length).toBe(1)
  })

  it('re-fetches once the in-flight promise has settled', async () => {
    mockFetch.mockResolvedValue(await jsonResponse({ data: [], count: 0, error: null }))
    await dataClient.getTimesheets({ limit: 50 })
    await dataClient.getTimesheets({ limit: 50 })
    const url = '/api/data/timesheets?limit=50'
    expect(mockFetch.mock.calls.filter(([u]) => u === url).length).toBe(2)
  })

  it('does not dedupe distinct requests', async () => {
    mockFetch.mockResolvedValue(await jsonResponse({ data: [], count: 0, error: null }))
    await Promise.all([dataClient.getProjects(), dataClient.getTimesheets()])
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })
})
