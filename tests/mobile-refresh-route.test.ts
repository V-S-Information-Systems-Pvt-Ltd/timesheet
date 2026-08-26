import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRotate, mockGenerate, mockHash, mockSign, mockPurge } = vi.hoisted(() => ({
  mockRotate: vi.fn(),
  mockGenerate: vi.fn(),
  mockHash: vi.fn(),
  mockSign: vi.fn(),
  mockPurge: vi.fn(),
}))

vi.mock('@/lib/auth/mobile-session-store', () => ({ mobileSessionStore: { rotate: mockRotate, purgeExpired: mockPurge } }))
vi.mock('@/lib/auth/mobile-tokens', () => ({
  generateRefreshToken: mockGenerate,
  hashRefreshToken: mockHash,
  signMobileAccessToken: mockSign,
  ACCESS_TOKEN_TTL_SECONDS: 900,
}))
vi.mock('@/app/api/_http', () => ({
  json: vi.fn((body: unknown, status = 200) => ({ body, status })),
  serverError: vi.fn(() => ({ body: { data: null, error: { code: 'INTERNAL', message: 'internal' } }, status: 500 })),
}))

import { POST } from '@/app/api/v1/auth/refresh/route'

function request(body: unknown): Request {
  return new Request('http://localhost/api/v1/auth/refresh', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGenerate.mockReturnValue('replacement-raw')
  mockHash.mockImplementation((value: string) => `hash:${value}`)
  mockSign.mockResolvedValue('access-token')
  mockPurge.mockResolvedValue(0)
})

describe('POST /api/v1/auth/refresh', () => {
  it('rejects a missing refresh token', async () => {
    const response = (await POST(request({}))) as unknown as { status: number }
    expect(response.status).toBe(400)
    expect(mockRotate).not.toHaveBeenCalled()
  })

  it('returns a replacement pair after atomic rotation', async () => {
    mockRotate.mockResolvedValue({
      status: 'rotated',
      session: { id: 'session-2', userId: 'user-1', familyId: 'family-1' },
    })
    const response = (await POST(request({ refreshToken: 'presented-raw' }))) as unknown as {
      status: number
      body: { data: Record<string, unknown>; error: null }
    }

    expect(response.status).toBe(200)
    expect(response.body.data).toMatchObject({
      accessToken: 'access-token',
      refreshToken: 'replacement-raw',
      sessionId: 'session-2',
    })
    expect(mockRotate).toHaveBeenCalledWith({
      presentedTokenHash: 'hash:presented-raw',
      replacementTokenHash: 'hash:replacement-raw',
    })
  })

  it('reports token reuse without issuing another access token', async () => {
    mockRotate.mockResolvedValue({ status: 'reused' })
    const response = (await POST(request({ refreshToken: 'reused-raw' }))) as unknown as {
      status: number
      body: { error: { code: string } }
    }
    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe('REFRESH_TOKEN_REUSED')
    expect(mockSign).not.toHaveBeenCalled()
    expect(mockPurge).not.toHaveBeenCalled()
  })

  it('triggers bounded expired-session cleanup after a successful rotation', async () => {
    mockRotate.mockResolvedValue({
      status: 'rotated',
      session: { id: 'session-3', userId: 'user-1', familyId: 'family-1' },
    })
    const response = (await POST(request({ refreshToken: 'valid-raw' }))) as unknown as { status: number }
    expect(response.status).toBe(200)
    await vi.waitFor(() => expect(mockPurge).toHaveBeenCalledTimes(1))
  })
})
