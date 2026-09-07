import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

const {
  mockRequire,
  mockRevokeOtherSessions,
  mockSignInWithPassword,
  mockUpdateUser,
  mockSignOut,
} = vi.hoisted(() => ({
  mockRequire: vi.fn(),
  mockRevokeOtherSessions: vi.fn(),
  mockSignInWithPassword: vi.fn(),
  mockUpdateUser: vi.fn(),
  mockSignOut: vi.fn(),
}))

vi.mock('@/app/api/v1/_http', () => ({
  requireMobileActor: mockRequire,
  withMobileActor: vi.fn(async (req: Request, fn: (auth: unknown) => Promise<unknown>, options?: unknown) => {
    const auth = (await mockRequire(req, options)) as { ok: boolean; response?: unknown }
    if (!auth.ok) return auth.response
    return fn(auth)
  }),
  json: vi.fn((body: unknown, status = 200, headers?: Record<string, string>) => ({ body, status, headers })),
  serverError: vi.fn(() => ({ status: 500 })),
  apiError: vi.fn((code: string, message: string, status = 400) => ({
    body: { data: null, error: { code, message } },
    status,
  })),
}))

vi.mock('@/lib/backend', () => ({
  IS_NATIVE: false,
}))

vi.mock('@/lib/auth/native', () => ({
  changePassword: vi.fn(),
}))

vi.mock('@/lib/auth/mobile-session-store', () => ({
  mobileSessionStore: {
    revokeOtherSessions: mockRevokeOtherSessions,
  },
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    auth: {
      signInWithPassword: mockSignInWithPassword,
      updateUser: mockUpdateUser,
      signOut: mockSignOut,
    },
  })),
}))

import { POST } from '@/app/api/v1/auth/change-password/route'
import { setRateLimitStore, resetLocalRateLimitWindows } from '@/lib/rate-limit'
import { createRateLimitFake, type RateLimitFake } from './helpers/rate-limit-store'

function request(body: unknown): Request {
  return new Request('http://localhost/api/v1/auth/change-password', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1' },
    body: JSON.stringify(body),
  })
}

const validBody = { currentPassword: 'OldPassword123!', newPassword: 'NewSecurePassword123!' }

type RouteResponse = { status: number; body: { data: { success: boolean } | null; error: { code: string; message: string } | null } }

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
  mockSignInWithPassword.mockResolvedValue({ error: null })
  mockRevokeOtherSessions.mockResolvedValue(undefined)
  mockUpdateUser.mockResolvedValue({ error: null })
  mockSignOut.mockResolvedValue({ error: null })
})

afterEach(() => {
  setRateLimitStore(null)
  resetLocalRateLimitWindows()
})

describe('POST /api/v1/auth/change-password (Supabase branch)', () => {
  it('verifies the current password with an ephemeral client and preserves the live session', async () => {
    const callOrder: string[] = []
    mockSignInWithPassword.mockImplementation(async () => {
      callOrder.push('signIn')
      return { error: null }
    })
    mockRevokeOtherSessions.mockImplementation(async () => {
      callOrder.push('revoke')
    })
    mockUpdateUser.mockImplementation(async () => {
      callOrder.push('update')
      return { error: null }
    })

    const response = (await POST(request(validBody))) as unknown as RouteResponse
    expect(response.status).toBe(200)
    expect(response.body.data?.success).toBe(true)

    expect(mockSignInWithPassword).toHaveBeenCalledWith({
      email: 'user@example.com',
      password: 'OldPassword123!',
    })
    // Revoke-before-write with the authenticated session preserved (never request JSON).
    expect(mockRevokeOtherSessions).toHaveBeenCalledWith('u1', 's1')
    expect(mockUpdateUser).toHaveBeenCalledWith({
      password: 'NewSecurePassword123!',
      current_password: 'OldPassword123!',
    })
    expect(callOrder).toEqual(['signIn', 'revoke', 'update'])
    expect(mockSignOut).toHaveBeenCalledWith({ scope: 'others' })
  })

  it('rejects a wrong current password without touching sessions or the provider password', async () => {
    mockSignInWithPassword.mockResolvedValue({ error: { message: 'Invalid login credentials' } })

    const response = (await POST(request(validBody))) as unknown as RouteResponse
    expect(response.status).toBe(400)
    expect(response.body.error?.code).toBe('INVALID_CREDENTIALS')
    expect(mockRevokeOtherSessions).not.toHaveBeenCalled()
    expect(mockUpdateUser).not.toHaveBeenCalled()
  })

  it('does not change the password when revocation fails', async () => {
    mockRevokeOtherSessions.mockRejectedValue(new Error('session store unavailable'))

    const response = (await POST(request(validBody))) as unknown as RouteResponse
    expect(response.status).toBe(500)
    expect(response.body.error?.code).toBe('PASSWORD_UPDATE_FAILED')
    expect(response.body.error?.message).toMatch(/not changed/i)
    expect(mockUpdateUser).not.toHaveBeenCalled()
  })

  it('reports truthfully when the provider write fails after sessions were revoked', async () => {
    mockUpdateUser.mockResolvedValue({ error: { message: 'Password update failed' } })

    const response = (await POST(request(validBody))) as unknown as RouteResponse
    expect(response.status).toBe(400)
    expect(response.body.error?.code).toBe('PASSWORD_UPDATE_FAILED')
    expect(response.body.error?.message).toMatch(/already revoked/i)
  })
})
