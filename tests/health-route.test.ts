// tests/health-route.test.ts
// Unit tests for health endpoints: process-level liveness probe (/api/health/live)
// and dependency-aware readiness probe (/api/health).
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

const { mockPoolQuery } = vi.hoisted(() => ({
  mockPoolQuery: vi.fn(),
}))

vi.mock('@/lib/db/pool', () => ({
  getPool: () => ({
    query: mockPoolQuery,
  }),
  getPoolMetrics: () => ({
    totalCount: 1,
    idleCount: 1,
    waitingCount: 0,
  }),
}))

const originalEnv = { ...process.env }

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  process.env = { ...originalEnv }
})

afterEach(() => {
  vi.restoreAllMocks()
  process.env = originalEnv
})

describe('GET /api/health/live', () => {
  it('returns 200 with status ok and uptime without touching database', async () => {
    const { GET: getLive } = await import('@/app/api/health/live/route')
    const res = await getLive()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('ok')
    expect(typeof body.uptime).toBe('number')
    expect(body.timestamp).toBeDefined()
    expect(mockPoolQuery).not.toHaveBeenCalled()
  })
})

describe('GET /api/health (readiness)', () => {
  describe('native mode', () => {
    beforeEach(() => {
      process.env.DATABASE_URL = 'postgres://vsis:vsis@localhost:5432/vsis'
      process.env.AUTH_SECRET = 'super-secret-auth-key-12345-32-chars!'
      // The verbose body (backend/db/authConfigured) only exists under
      // HEALTH_DEBUG=true; the default minimal body is asserted below.
      process.env.HEALTH_DEBUG = 'true'
    })

    it('returns 200 when database and auth are configured and reachable', async () => {
      mockPoolQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })
      const { GET: getReady } = await import('@/app/api/health/route')

      const res = await getReady()
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.status).toBe('ok')
      expect(body.backend).toBe('native')
      expect(body.db.reachable).toBe(true)
      expect(body.authConfigured).toBe(true)
      expect(mockPoolQuery).toHaveBeenCalledWith(expect.objectContaining({ text: 'select 1' }))
    })

    it('returns 503 when database query throws', async () => {
      mockPoolQuery.mockRejectedValueOnce(new Error('Connection terminated unexpectedly'))
      const { GET: getReady } = await import('@/app/api/health/route')

      const res = await getReady()
      expect(res.status).toBe(503)
      const body = await res.json()
      expect(body.status).toBe('degraded')
      expect(body.db.reachable).toBe(false)
      expect(body.db.error).toBe('Connection terminated unexpectedly')
    })

    it('returns 503 when DATABASE_URL is unset', async () => {
      delete process.env.DATABASE_URL
      const { GET: getReady } = await import('@/app/api/health/route')

      const res = await getReady()
      expect(res.status).toBe(503)
      const body = await res.json()
      expect(body.status).toBe('degraded')
      expect(body.db.reachable).toBe(false)
      expect(body.db.error).toContain('DATABASE_URL is not set')
    })

    it('returns 503 when AUTH_SECRET is unset', async () => {
      delete process.env.AUTH_SECRET
      mockPoolQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })
      const { GET: getReady } = await import('@/app/api/health/route')

      const res = await getReady()
      expect(res.status).toBe(503)
      const body = await res.json()
      expect(body.status).toBe('degraded')
      expect(body.authConfigured).toBe(false)
    })

    it('returns 503 when AUTH_SECRET is shorter than 32 characters', async () => {
      process.env.AUTH_SECRET = 'short-secret'
      mockPoolQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })
      const { GET: getReady } = await import('@/app/api/health/route')

      const res = await getReady()
      expect(res.status).toBe(503)
      const body = await res.json()
      expect(body.status).toBe('degraded')
      expect(body.authConfigured).toBe(false)
    })

    it('returns ONLY {status} and no-store when HEALTH_DEBUG is not exactly "true"', async () => {
      mockPoolQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })
      delete process.env.HEALTH_DEBUG

      const { GET: getReady } = await import('@/app/api/health/route')
      const res = await getReady()
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toEqual({ status: 'ok' })
      expect(res.headers.get('cache-control')).toBe('no-store')

      // Any value other than the exact string "true" stays minimal.
      for (const value of ['TRUE', '1', 'yes', 'false']) {
        process.env.HEALTH_DEBUG = value
        vi.resetModules()
        process.env.DATABASE_URL = 'postgres://vsis:vsis@localhost:5432/vsis'
        process.env.AUTH_SECRET = 'super-secret-auth-key-12345-32-chars!'
        mockPoolQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })
        const { GET: again } = await import('@/app/api/health/route')
        const minimal = await again()
        expect(await minimal.json()).toEqual({ status: 'ok' })
      }
    })
  })
})
