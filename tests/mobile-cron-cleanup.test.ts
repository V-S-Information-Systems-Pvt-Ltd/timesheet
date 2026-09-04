import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCleanupExpired } = vi.hoisted(() => ({
  mockCleanupExpired: vi.fn(),
}))

vi.mock('@/lib/auth/mobile-session-store', () => ({
  mobileSessionStore: {
    cleanupExpired: mockCleanupExpired,
  },
}))

import { GET, POST } from '@/app/api/v1/cron/cleanup/route'

describe('POST /api/v1/cron/cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.CRON_SECRET
  })

  it('fails closed when CRON_SECRET is not configured', async () => {
    const response = await POST(new Request('http://localhost/api/v1/cron/cleanup', { method: 'POST' }))
    expect(response.status).toBe(503)
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
    expect(mockCleanupExpired).toHaveBeenCalledTimes(1)
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
    expect(mockCleanupExpired).not.toHaveBeenCalled()
  })
})
