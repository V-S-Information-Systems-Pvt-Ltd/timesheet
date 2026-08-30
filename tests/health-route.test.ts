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
  vi.doUnmock('@/lib/backend/config')
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
      vi.doMock('@/lib/backend/config', () => ({ IS_NATIVE: true }))
      process.env.DATABASE_URL = 'postgres://vsis:vsis@localhost:5432/vsis'
      process.env.AUTH_SECRET = 'super-secret-auth-key-12345'
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
  })

  describe('supabase mode', () => {
    beforeEach(() => {
      vi.doMock('@/lib/backend/config', () => ({ IS_NATIVE: false }))
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key-123'
    })

    it('returns 200 when supabase url is reachable and key is configured', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(null, { status: 200 })))
      const { GET: getReady } = await import('@/app/api/health/route')

      const res = await getReady()
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.status).toBe('ok')
      expect(body.backend).toBe('supabase')
      expect(body.db.reachable).toBe(true)
      expect(body.authConfigured).toBe(true)
      expect(mockPoolQuery).not.toHaveBeenCalled()
    })

    it('returns 503 when SUPABASE_URL is missing', async () => {
      delete process.env.NEXT_PUBLIC_SUPABASE_URL
      const { GET: getReady } = await import('@/app/api/health/route')

      const res = await getReady()
      expect(res.status).toBe(503)
      const body = await res.json()
      expect(body.status).toBe('degraded')
      expect(body.db.reachable).toBe(false)
      expect(body.db.error).toContain('SUPABASE_URL is not set')
    })
  })
})
