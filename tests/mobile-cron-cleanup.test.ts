import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCleanupExpired } = vi.hoisted(() => ({
  mockCleanupExpired: vi.fn(),
}))

vi.mock('@/lib/auth/mobile-session-store', () => ({
  mobileSessionStore: {
    cleanupExpired: mockCleanupExpired,
  },
}))

import { POST } from '@/app/api/v1/cron/cleanup/route'

describe('POST /api/v1/cron/cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.CRON_SECRET
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
