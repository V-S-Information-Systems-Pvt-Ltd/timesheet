import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockVerify, mockFindById, mockActor } = vi.hoisted(() => ({
  mockVerify: vi.fn(),
  mockFindById: vi.fn(),
  mockActor: vi.fn(),
}))

vi.mock('@/lib/auth/mobile-tokens', () => ({ verifyMobileAccessToken: mockVerify }))
vi.mock('@/lib/auth/mobile-session-store', () => ({ mobileSessionStore: { findById: mockFindById } }))
vi.mock('@/lib/auth/mobile-actor', () => ({ getMobileActor: mockActor }))

import { requireMobileActor, requireMobileSession } from '@/app/api/v1/_http'

const claims = { userId: 'user-1', sessionId: 'session-1', familyId: 'family-1' }
const future = new Date(Date.now() + 30 * 86400 * 1000).toISOString()
const session = {
  userId: 'user-1',
  familyId: 'family-1',
  revokedAt: null,
  rotatedAt: null,
  idleExpiresAt: future,
  absoluteExpiresAt: future,
}
const actor = { id: 'user-1', email: 'u@example.com', isActive: true }

function request(auth?: string): Request {
  return new Request('http://localhost/api/v1/dashboard', {
    headers: auth ? { authorization: auth } : {},
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockVerify.mockResolvedValue(claims)
  mockFindById.mockResolvedValue(session)
  mockActor.mockResolvedValue(actor)
})

describe('requireMobileActor', () => {
  it('rejects missing or malformed bearer headers', async () => {
    const missing = await requireMobileActor(request())
    const malformed = await requireMobileActor(request('Basic abc'))
    expect(((missing as { response: Response }).response as unknown as { status: number }).status).toBe(401)
    expect(((malformed as { response: Response }).response as unknown as { status: number }).status).toBe(401)
    expect(mockVerify).not.toHaveBeenCalled()
  })

  it('rejects a revoked or rotated server session', async () => {
    mockFindById.mockResolvedValue({ ...session, rotatedAt: '2026-08-26T10:00:00.000Z' })
    const response = await requireMobileActor(request('Bearer access'))
    expect((response as { response: Response }).response).toBeDefined()
    expect(mockActor).not.toHaveBeenCalled()
  })

  it('rejects an idle-expired session', async () => {
    mockFindById.mockResolvedValue({
      ...session,
      idleExpiresAt: new Date(Date.now() - 1000).toISOString(),
    })
    const response = await requireMobileActor(request('Bearer access'))
    expect(((response as { response: Response }).response as unknown as { status: number }).status).toBe(401)
    expect(mockActor).not.toHaveBeenCalled()
  })

  it('rejects an absolute-expired session', async () => {
    mockFindById.mockResolvedValue({
      ...session,
      absoluteExpiresAt: new Date(Date.now() - 1000).toISOString(),
    })
    const response = await requireMobileActor(request('Bearer access'))
    expect(((response as { response: Response }).response as unknown as { status: number }).status).toBe(401)
    expect(mockActor).not.toHaveBeenCalled()
  })

  it('resolves the current active actor and attaches request context', async () => {
    const result = await requireMobileActor(request('Bearer access'))
    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        actor,
        sessionId: 'session-1',
        requestId: expect.any(String),
        startTime: expect.any(Number),
      })
    )
  })

  it('preserves incoming x-request-id header', async () => {
    const req = new Request('http://localhost/api/v1/dashboard', {
      headers: { authorization: 'Bearer access', 'x-request-id': 'custom-req-id-123' },
    })
    const result = await requireMobileActor(req)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.requestId).toBe('custom-req-id-123')
    }
  })

  it('rejects an inactive actor with 403 on standard data routes', async () => {
    mockActor.mockResolvedValue({ ...actor, isActive: false })
    const result = await requireMobileActor(request('Bearer access'))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect((result.response as unknown as { status: number }).status).toBe(403)
      expect(result.requestId).toBeDefined()
    }
  })

  it('permits an inactive actor when requireMobileSession is used', async () => {
    mockActor.mockResolvedValue({ ...actor, isActive: false })
    const result = await requireMobileSession(request('Bearer access'))
    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        actor: { ...actor, isActive: false },
        sessionId: 'session-1',
        requestId: expect.any(String),
        startTime: expect.any(Number),
      })
    )
  })
})
