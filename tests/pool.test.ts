import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockPoolInstance = {
  totalCount: 5,
  idleCount: 3,
  waitingCount: 0,
  query: vi.fn(),
  connect: vi.fn(),
}

const mockPoolConstructor = vi.fn(function (_opts?: unknown) {
  return mockPoolInstance
})

vi.mock('pg', () => {
  return {
    Pool: mockPoolConstructor,
    types: {
      setTypeParser: vi.fn(),
    },
  }
})

vi.mock('../lib/db/migrate', () => ({
  runMigrations: vi.fn(async () => ({ applied: [] })),
}))

describe('lib/db/pool', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.resetModules()
    mockPoolConstructor.mockClear()
    process.env = { ...originalEnv, DATABASE_URL: 'postgres://user:pass@localhost:5432/testdb' }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('initializes pool with default options (max=10, idle=10s, conn=5s)', async () => {
    const { getPool, getPoolMetrics } = await import('../lib/db/pool')
    expect(getPoolMetrics()).toBeNull()

    const p = getPool()
    expect(p).toBe(mockPoolInstance)
    expect(mockPoolConstructor).toHaveBeenCalledWith({
      connectionString: 'postgres://user:pass@localhost:5432/testdb',
      max: 10,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 5000,
    })

    const metrics = getPoolMetrics()
    expect(metrics).toEqual({
      totalCount: 5,
      idleCount: 3,
      waitingCount: 0,
    })
  })

  it('respects custom pool environment variables', async () => {
    process.env.DB_POOL_MAX = '25'
    process.env.DB_POOL_IDLE_TIMEOUT_MS = '30000'
    process.env.DB_POOL_CONNECTION_TIMEOUT_MS = '8000'

    const { getPool } = await import('../lib/db/pool')
    getPool()

    expect(mockPoolConstructor).toHaveBeenCalledWith({
      connectionString: 'postgres://user:pass@localhost:5432/testdb',
      max: 25,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 8000,
    })
  })

  it('throws error when DATABASE_URL is missing', async () => {
    delete process.env.DATABASE_URL
    const { getPool } = await import('../lib/db/pool')
    expect(() => getPool()).toThrowError(/DATABASE_URL is not set/)
  })
})
