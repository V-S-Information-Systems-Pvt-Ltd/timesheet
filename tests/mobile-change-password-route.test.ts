import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

const { mockRequire, mockChangePassword } = vi.hoisted(() => ({
  mockRequire: vi.fn(),
  mockChangePassword: vi.fn(),
}))

vi.mock('@/app/api/v1/_http', () => ({
  requireMobileActor: mockRequire,
  json: vi.fn((body: unknown, status = 200, headers?: Record<string, string>) => ({ body, status, headers })),
  serverError: vi.fn(() => ({ status: 500 })),
  apiError: vi.fn((code: string, message: string, status = 400) => ({
    body: { data: null, error: { code, message } },
    status,
  })),
}))

vi.mock('@/lib/backend', () => ({
  IS_NATIVE: true,
}))

vi.mock('@/lib/auth/native', () => ({
  changePassword: mockChangePassword,
}))

import { POST } from '@/app/api/v1/auth/change-password/route'
import { setRateLimitStore, resetLocalRateLimitWindows } from '@/lib/rate-limit'
import { createRateLimitFake, netHeld, type RateLimitFake } from './helpers/rate-limit-store'

function request(body: unknown): Request {
  return new Request('http://localhost/api/v1/auth/change-password', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1' },
    body: JSON.stringify(body),
  })
}

let rateLimitFake: RateLimitFake

beforeEach(() => {
  vi.clearAllMocks()
  rateLimitFake = createRateLimitFake()
  setRateLimitStore(rateLimitFake)
  mockRequire.mockResolvedValue({
    ok: true,
    actor: { id: 'u1', email: 'user@example.com', role: 'user', permission_role: 'user', hierarchy_role: 'user', isActive: true },
    sessionId: 's1',
  })
})

afterEach(() => {
  setRateLimitStore(null)
  resetLocalRateLimitWindows()
})

describe('POST /api/v1/auth/change-password', () => {
  it('rejects short passwords', async () => {
    const response = (await POST(request({ currentPassword: 'OldPassword123!', newPassword: 'short' }))) as unknown as {
      status: number
      body: { error: { code: string } }
    }
    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('updates password successfully on valid request', async () => {
    mockChangePassword.mockResolvedValue({ error: null })
    const response = (await POST(request({ currentPassword: 'OldPassword123!', newPassword: 'NewSecurePassword123!' }))) as unknown as {
      status: number
      body: { data: { success: boolean }; error: null }
    }
    expect(response.status).toBe(200)
    expect(response.body.data.success).toBe(true)
    expect(mockChangePassword).toHaveBeenCalledWith('u1', 'OldPassword123!', 'NewSecurePassword123!')
    expect(netHeld(rateLimitFake, 'daily-password')).toBe(0)
  })

  it('releases the reservation when the password service throws', async () => {
    mockChangePassword.mockRejectedValue(new Error('database unavailable'))
    const response = (await POST(request({ currentPassword: 'OldPassword123!', newPassword: 'NewSecurePassword123!' }))) as unknown as {
      status: number
    }
    expect(response.status).toBe(500)
    expect(netHeld(rateLimitFake, 'daily-password')).toBe(0)
  })
})
