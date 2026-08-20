// tests/data-client-pagination.test.ts
// Tests for the pagination parameter mapping in the native data client.
// The client module is 'use client' and depends on React + fetch, so we test
// the URL-building logic by mocking the module's internal dependencies.
import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('@/lib/backend/client', () => ({ IS_NATIVE: true }))

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

vi.mock('react', () => ({
  useSyncExternalStore: vi.fn(),
}))

const mockAuthClient = {
  getSession: vi.fn().mockResolvedValue({ user: { id: 'u1', email: 'a@b.com' } }),
  onAuthStateChange: vi.fn().mockReturnValue(() => {}),
  signIn: vi.fn(),
  signUp: vi.fn(),
  signOut: vi.fn(),
  changePassword: vi.fn(),
}
vi.mock('@/lib/auth/client', () => ({ authClient: mockAuthClient }))

describe('data client pagination (native mode)', () => {
  beforeEach(() => {
    mockFetch.mockClear()
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [], count: 0 }),
    } as Response)
  })

  it('maps from/to/limit to query params', async () => {
    const { dataClient } = await import('../lib/data/client')
    await dataClient.getTimesheets({ from: 0, to: 49, limit: 50 })
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/data/timesheets?from=0&to=49&limit=50',
      expect.objectContaining({ credentials: 'same-origin' })
    )
  })

  it('omits pagination params when not provided', async () => {
    const { dataClient } = await import('../lib/data/client')
    await dataClient.getTimesheets({})
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/data/timesheets',
      expect.objectContaining({ credentials: 'same-origin' })
    )
  })

  it('includes only provided params', async () => {
    const { dataClient } = await import('../lib/data/client')
    await dataClient.getTimesheets({ from: 100 })
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/data/timesheets?from=100',
      expect.objectContaining({ credentials: 'same-origin' })
    )
  })
})
