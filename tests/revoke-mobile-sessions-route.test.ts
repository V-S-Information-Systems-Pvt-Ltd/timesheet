import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetSessionUser, mockBegin, mockComplete, mockOriginCheck, mockServerError } = vi.hoisted(() => ({
  mockGetSessionUser: vi.fn(),
  mockBegin: vi.fn(),
  mockComplete: vi.fn(),
  mockOriginCheck: vi.fn(),
  mockServerError: vi.fn(),
}))

vi.mock('@/app/api/_http', () => ({
  originCheck: mockOriginCheck,
  json: vi.fn((body: unknown, status = 200, headers?: Record<string, string>) => ({ body, status, headers })),
  serverError: mockServerError,
}))

vi.mock('@/lib/auth', () => ({
  getSessionUser: mockGetSessionUser,
}))

vi.mock('@/lib/auth/mobile-session-store', () => ({
  mobileSessionStore: {
    beginPasswordChange: mockBegin,
    completePasswordChange: mockComplete,
    revokeAll: vi.fn(),
  },
}))

import { POST } from '@/app/api/auth/revoke-mobile-sessions/route'

function request(body?: unknown): Request {
  return new Request('http://localhost/api/auth/revoke-mobile-sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

describe('POST /api/auth/revoke-mobile-sessions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockOriginCheck.mockReturnValue(null)
    mockGetSessionUser.mockResolvedValue({ id: 'u-1' })
    mockServerError.mockReturnValue({ status: 500 })
  })

  it('rejects an unauthenticated caller without touching sessions', async () => {
    mockGetSessionUser.mockResolvedValueOnce(null)
    const res = (await POST(request({}))) as { status: number }
    expect(res.status).toBe(401)
    expect(mockBegin).not.toHaveBeenCalled()
    expect(mockComplete).not.toHaveBeenCalled()
  })

  it('begins the guarded revoke-all for a plain body', async () => {
    const res = (await POST(request({}))) as { status: number }
    expect(res.status).toBe(200)
    expect(mockBegin).toHaveBeenCalledWith('u-1')
    expect(mockComplete).not.toHaveBeenCalled()
  })

  it('treats a missing body as the begin phase', async () => {
    const res = (await POST(request())) as { status: number }
    expect(res.status).toBe(200)
    expect(mockBegin).toHaveBeenCalledWith('u-1')
  })

  it('completes the guarded change when complete is true', async () => {
    const res = (await POST(request({ complete: true }))) as { status: number }
    expect(res.status).toBe(200)
    expect(mockComplete).toHaveBeenCalledWith('u-1', null)
    expect(mockBegin).not.toHaveBeenCalled()
  })

  it('fails closed when the store rejects', async () => {
    mockBegin.mockRejectedValueOnce(new Error('db down'))
    const res = (await POST(request({}))) as { status: number }
    expect(res.status).toBe(500)
    expect(mockServerError).toHaveBeenCalled()
  })

  it('returns the origin-check rejection before authenticating', async () => {
    mockOriginCheck.mockReturnValueOnce({ status: 403 })
    const res = (await POST(request({}))) as { status: number }
    expect(res.status).toBe(403)
    expect(mockGetSessionUser).not.toHaveBeenCalled()
  })
})
