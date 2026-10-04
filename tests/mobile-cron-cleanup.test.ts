import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCleanupExpired, mockReadScheduledMaintenanceWriteGate } = vi.hoisted(() => ({
  mockCleanupExpired: vi.fn(),
  mockReadScheduledMaintenanceWriteGate: vi.fn(),
}))

vi.mock('@/lib/auth/mobile-session-store', () => ({
  mobileSessionStore: {
    cleanupExpired: mockCleanupExpired,
  },
}))

vi.mock('@/lib/db/write-gate', () => ({
  readScheduledMaintenanceWriteGate: mockReadScheduledMaintenanceWriteGate,
}))

import { GET, POST } from '@/app/api/v1/cron/cleanup/route'
import { logger } from '@/lib/logger'

describe('POST /api/v1/cron/cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.CRON_SECRET
    mockReadScheduledMaintenanceWriteGate.mockResolvedValue({
      state: 'open',
      runId: null,
      reason: null,
    })
  })

  it('fails closed when CRON_SECRET is not configured', async () => {
    const response = await POST(new Request('http://localhost/api/v1/cron/cleanup', { method: 'POST' }))
    expect(response.status).toBe(503)
    expect(mockReadScheduledMaintenanceWriteGate).not.toHaveBeenCalled()
    expect(mockCleanupExpired).not.toHaveBeenCalled()
  })

  it('performs cleanup successfully when authorized', async () => {
    process.env.CRON_SECRET = 'super-secret-cron-key'
    mockCleanupExpired.mockResolvedValue(5)

    const request = new Request('http://localhost/api/v1/cron/cleanup', {
      method: 'POST',
      headers: {
        authorization: 'Bearer super-secret-cron-key',
      },
    })

    const response = await POST(request)
    expect(response.status).toBe(200)

    const json = (await response.json()) as { data: { cleanedSessions: number }; error: null }
    expect(json.data.cleanedSessions).toBe(5)
    expect(mockReadScheduledMaintenanceWriteGate).toHaveBeenCalledTimes(1)
    expect(mockCleanupExpired).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['POST', POST],
    ['GET', GET],
  ])('refuses %s cleanup while migration writers are fenced', async (_method, handler) => {
    process.env.CRON_SECRET = 'super-secret-cron-key'
    mockReadScheduledMaintenanceWriteGate.mockResolvedValue({
      state: 'fenced',
      runId: 'migration-run',
      reason: 'migration window',
    })

    const response = await handler(new Request('http://localhost/api/v1/cron/cleanup', {
      method: _method,
      headers: { authorization: 'Bearer super-secret-cron-key' },
    }))

    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ error: { code: 'WRITERS_FENCED' } })
    expect(mockCleanupExpired).not.toHaveBeenCalled()
  })

  it('fails closed when the migration write gate cannot be read', async () => {
    process.env.CRON_SECRET = 'super-secret-cron-key'
    mockReadScheduledMaintenanceWriteGate.mockRejectedValue(new Error('gate read failed'))

    const response = await POST(new Request('http://localhost/api/v1/cron/cleanup', {
      method: 'POST',
      headers: { authorization: 'Bearer super-secret-cron-key' },
    }))

    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ error: { code: 'WRITE_GATE_UNAVAILABLE' } })
    expect(mockCleanupExpired).not.toHaveBeenCalled()
  })

  it('fails closed when the migration write gate row is missing', async () => {
    process.env.CRON_SECRET = 'super-secret-cron-key'
    mockReadScheduledMaintenanceWriteGate.mockResolvedValue(null)

    const response = await POST(new Request('http://localhost/api/v1/cron/cleanup', {
      method: 'POST',
      headers: { authorization: 'Bearer super-secret-cron-key' },
    }))

    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ error: { code: 'WRITE_GATE_UNAVAILABLE' } })
    expect(mockCleanupExpired).not.toHaveBeenCalled()
  })

  it('accepts the Vercel Cron GET invocation with the same gate', async () => {
    process.env.CRON_SECRET = 'super-secret-cron-key'
    mockCleanupExpired.mockResolvedValue(0)

    const response = await GET(new Request('http://localhost/api/v1/cron/cleanup', {
      headers: { authorization: 'Bearer super-secret-cron-key' },
    }))
    expect(response.status).toBe(200)
    expect(mockCleanupExpired).toHaveBeenCalledTimes(1)
  })

  it('rejects unauthorized requests when CRON_SECRET is configured', async () => {
    process.env.CRON_SECRET = 'super-secret-cron-key'

    const request = new Request('http://localhost/api/v1/cron/cleanup', {
      method: 'POST',
      headers: {
        authorization: 'Bearer wrong-key',
      },
    })

    const response = await POST(request)
    expect(response.status).toBe(403)
    expect(mockReadScheduledMaintenanceWriteGate).not.toHaveBeenCalled()
    expect(mockCleanupExpired).not.toHaveBeenCalled()
  })

  it('never logs the presented cron secret, only header presence', async () => {
    process.env.CRON_SECRET = 'super-secret-cron-key'
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {})

    const response = await POST(
      new Request('http://localhost/api/v1/cron/cleanup', {
        method: 'POST',
        headers: { authorization: 'Bearer wrong-key' },
      })
    )
    expect(response.status).toBe(403)

    const serialized = JSON.stringify(warnSpy.mock.calls)
    expect(serialized).not.toContain('wrong-key')
    expect(serialized).not.toContain('super-secret-cron-key')
    expect(serialized).toContain('hasAuthHeader')

    warnSpy.mockRestore()
  })
})
