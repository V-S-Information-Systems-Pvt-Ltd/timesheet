import { describe, expect, it, vi } from 'vitest'

const { mockRequire, mockRevoke, mockRevokeAll } = vi.hoisted(() => ({
  mockRequire: vi.fn(), mockRevoke: vi.fn(), mockRevokeAll: vi.fn(),
}))
vi.mock('@/app/api/v1/_http', () => ({
  requireMobileActor: mockRequire,
  json: vi.fn((body: unknown, status = 200) => ({ body, status })),
  serverError: vi.fn(() => ({ status: 500 })),
}))
vi.mock('@/lib/auth/mobile-session-store', () => ({
  mobileSessionStore: { revokeSession: mockRevoke, revokeAll: mockRevokeAll },
}))

import { POST as logout } from '@/app/api/v1/auth/logout/route'
import { POST as logoutAll } from '@/app/api/v1/auth/logout-all/route'

const actor = { id: 'user-1', email: 'u@example.com', isActive: true }

describe('mobile logout routes', () => {
  it('revokes only the current device session', async () => {
    mockRequire.mockResolvedValue({ ok: true, actor, sessionId: 'session-1' })
    const response = (await logout(new Request('http://localhost', { method: 'POST' }))) as unknown as { status: number; body: unknown }
    expect(response.status).toBe(200)
    expect(mockRevoke).toHaveBeenCalledWith('session-1')
    expect(mockRevokeAll).not.toHaveBeenCalled()
  })

  it('revokes all sessions for the current actor', async () => {
    mockRequire.mockResolvedValue({ ok: true, actor, sessionId: 'session-1' })
    const response = (await logoutAll(new Request('http://localhost', { method: 'POST' }))) as unknown as { status: number }
    expect(response.status).toBe(200)
    expect(mockRevokeAll).toHaveBeenCalledWith('user-1')
  })
})
