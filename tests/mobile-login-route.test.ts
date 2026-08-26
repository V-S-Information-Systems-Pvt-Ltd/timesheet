import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockVerify, mockCreate, mockSign, mockGenerate, mockHash, mockGetActor } = vi.hoisted(() => ({
  mockVerify: vi.fn(),
  mockCreate: vi.fn(),
  mockSign: vi.fn(),
  mockGenerate: vi.fn(),
  mockHash: vi.fn(),
  mockGetActor: vi.fn(),
}))

vi.mock('@/lib/auth/mobile-credentials', () => ({ verifyMobileCredentials: mockVerify }))
vi.mock('@/lib/auth/mobile-actor', () => ({ getMobileActor: mockGetActor }))
vi.mock('@/lib/auth/mobile-session-store', () => ({ mobileSessionStore: { create: mockCreate } }))
vi.mock('@/lib/auth/mobile-tokens', () => ({
  generateRefreshToken: mockGenerate,
  hashRefreshToken: mockHash,
  signMobileAccessToken: mockSign,
  ACCESS_TOKEN_TTL_SECONDS: 900,
}))
vi.mock('@/app/api/_http', () => ({
  json: vi.fn((body: unknown, status = 200, headers?: Record<string, string>) => ({ body, status, headers })),
  serverError: vi.fn(() => ({ body: { data: null, error: { code: 'INTERNAL', message: 'internal' } }, status: 500 })),
}))

import { POST } from '@/app/api/v1/auth/login/route'
import { dailyLoginStore } from '@/lib/rate-limit'

function request(body: unknown): Request {
  return new Request('http://localhost/api/v1/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.0.0.1' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  dailyLoginStore.clear()
  mockGenerate.mockReturnValue('refresh-raw')
  mockHash.mockReturnValue('refresh-hash')
  mockCreate.mockResolvedValue({ id: 'session-1', familyId: 'family-1' })
  mockSign.mockResolvedValue('access-token')
  mockGetActor.mockResolvedValue({
    id: 'user-1',
    email: 'u@example.com',
    role: 'user',
    permission_role: 'user',
    hierarchy_role: 'user',
    isActive: true,
  })
})

describe('POST /api/v1/auth/login', () => {
  it('rejects malformed input', async () => {
    const response = (await POST(request({ email: 'bad', password: '' }))) as unknown as { status: number }
    expect(response.status).toBe(400)
    expect(mockVerify).not.toHaveBeenCalled()
  })

  it('returns a token pair after valid credential verification', async () => {
    mockVerify.mockResolvedValue({ user: { id: 'user-1', email: 'u@example.com' }, error: null })
    const response = (await POST(request({ email: 'U@EXAMPLE.COM', password: 'secret', platform: 'android' }))) as unknown as {
      status: number
      body: { data: Record<string, unknown>; error: null }
    }

    expect(response.status).toBe(200)
    expect(response.body.error).toBeNull()
    expect(response.body.data).toMatchObject({
      accessToken: 'access-token',
      refreshToken: 'refresh-raw',
      sessionId: 'session-1',
      actor: {
        id: 'user-1',
        email: 'u@example.com',
        role: 'user',
        permissionRole: 'user',
        hierarchyRole: 'user',
        isActive: true,
      },
    })
    expect(mockVerify).toHaveBeenCalledWith('u@example.com', 'secret')
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1', platform: 'android' }))
  })

  it('reports pending approval for inactive accounts without revoking the session', async () => {
    mockVerify.mockResolvedValue({ user: { id: 'user-1', email: 'u@example.com' }, error: null })
    mockGetActor.mockResolvedValue({
      id: 'user-1',
      email: 'u@example.com',
      role: 'user',
      permission_role: 'user',
      hierarchy_role: 'user',
      isActive: false,
    })
    const response = (await POST(request({ email: 'u@example.com', password: 'secret' }))) as unknown as {
      status: number
      body: { data: { actor: { isActive: boolean } }; error: null }
    }
    expect(response.status).toBe(200)
    expect(response.body.data.actor.isActive).toBe(false)
  })

  it('uses a generic error and consumes the failed-login budget', async () => {
    mockVerify.mockResolvedValue({ user: null, error: 'Invalid email or password.' })
    const response = (await POST(request({ email: 'u@example.com', password: 'wrong' }))) as unknown as {
      status: number
      body: { error: { code: string; message: string } }
    }
    expect(response.status).toBe(401)
    expect(response.body.error).toEqual({ code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' })
    expect(dailyLoginStore.size).toBe(1)
  })
})
