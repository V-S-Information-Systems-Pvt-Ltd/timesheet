import { beforeEach, describe, expect, it, vi } from 'vitest'

// Focused unit tests for the WP-07 bounded cleanup of expired/revoked
// mobile sessions in both backend adapters.

vi.mock('server-only', () => ({}))

const { mockQuery, mockFrom, mockGetAdminClient } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockFrom: vi.fn(),
  mockGetAdminClient: vi.fn(),
}))

async function loadStore(isNative: boolean) {
  vi.resetModules()
  vi.doMock('@/lib/backend', () => ({ IS_NATIVE: isNative }))
  vi.doMock('@/lib/db/pool', () => ({
    query: mockQuery,
    transaction: vi.fn(),
    getPool: vi.fn(),
  }))
  vi.doMock('@/lib/supabase/admin', () => ({ getAdminClient: mockGetAdminClient }))
  const mod = await import('@/lib/auth/mobile-session-store')
  return mod.mobileSessionStore as typeof import('@/lib/auth/mobile-session-store')['mobileSessionStore']
}

describe('mobileSessionStore.purgeExpired', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('deletes expired/revoked rows with a bounded statement in native mode', async () => {
    mockQuery.mockResolvedValue([{ id: 'session-1' }, { id: 'session-2' }])
    const store = await loadStore(true)

    await expect(store.purgeExpired()).resolves.toBe(2)

    expect(mockQuery).toHaveBeenCalledTimes(1)
    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('revoked_at is not null or absolute_expires_at < now()')
    expect(sql).toContain('limit $1')
    expect(params).toEqual([500])
  })

  it('removes expired and revoked rows through PostgREST deletes in Supabase mode', async () => {
    const builders: Array<Record<string, unknown>> = []
    function builder(result: { data: unknown; error: null }) {
      const chain: Record<string, unknown> = {}
      chain.delete = vi.fn(() => chain)
      chain.lt = vi.fn(() => chain)
      chain.not = vi.fn(() => chain)
      chain.select = vi.fn(() => Promise.resolve(result))
      builders.push(chain)
      return chain
    }
    let call = 0
    mockFrom.mockImplementation(() => {
      call += 1
      // First delete removes expired rows, second removes revoked rows.
      return builder(call === 1 ? { data: [{ id: 'a' }, { id: 'b' }], error: null } : { data: [{ id: 'c' }], error: null })
    })
    mockGetAdminClient.mockReturnValue({ from: mockFrom })
    const store = await loadStore(false)

    await expect(store.purgeExpired()).resolves.toBe(3)

    const [expiredChain, revokedChain] = builders as unknown as [
      { lt: ReturnType<typeof vi.fn>; select: ReturnType<typeof vi.fn> },
      { not: ReturnType<typeof vi.fn>; select: ReturnType<typeof vi.fn> },
    ]
    expect(expiredChain.lt).toHaveBeenCalledWith('absolute_expires_at', expect.any(String))
    expect(revokedChain.not).toHaveBeenCalledWith('revoked_at', 'is', null)
  })

  it('propagates PostgREST errors instead of reporting success', async () => {
    function failingBuilder() {
      const chain: Record<string, unknown> = {}
      chain.delete = vi.fn(() => chain)
      chain.lt = vi.fn(() => chain)
      chain.not = vi.fn(() => chain)
      chain.select = vi.fn(() => Promise.resolve({ data: null, error: { message: 'permission denied' } }))
      return chain
    }
    mockFrom.mockImplementation(() => failingBuilder())
    mockGetAdminClient.mockReturnValue({ from: mockFrom })
    const store = await loadStore(false)

    await expect(store.purgeExpired()).rejects.toThrow('permission denied')
  })
})
