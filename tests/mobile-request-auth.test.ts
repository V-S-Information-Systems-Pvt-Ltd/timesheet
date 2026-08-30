import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockVerify, mockFindSessionAndActor } = vi.hoisted(() => ({
  mockVerify: vi.fn(),
  mockFindSessionAndActor: vi.fn(),
}))

vi.mock('@/lib/auth/mobile-tokens', () => ({ verifyMobileAccessToken: mockVerify }))
vi.mock('@/lib/auth/mobile-session-store', () => ({
  mobileSessionStore: {
    findSessionAndActorById: mockFindSessionAndActor,
  },
}))

import { requireMobileActor, requireMobileSession } from '@/app/api/v1/_http'

const claims = { userId: 'user-1', sessionId: 'session-1', familyId: 'family-1' }
const future = new Date(Date.now() + 30 * 86400 * 1000).toISOString()
const session = {
  id: 'session-1',
  userId: 'user-1',
  familyId: 'family-1',
  revokedAt: null,
  rotatedAt: null,
  idleExpiresAt: future,
  absoluteExpiresAt: future,
}
const actor = {
  id: 'user-1',
  email: 'u@example.com',
  role: 'user' as const,
  permission_role: 'user' as const,
  hierarchy_role: 'user' as const,
  isActive: true,
}

function request(auth?: string): Request {
  return new Request('http://localhost/api/v1/dashboard', {
    headers: auth ? { authorization: auth } : {},
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockVerify.mockResolvedValue(claims)
  mockFindSessionAndActor.mockResolvedValue({ session, actor })
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
    mockFindSessionAndActor.mockResolvedValue({
      session: { ...session, rotatedAt: '2026-08-26T10:00:00.000Z' },
      actor,
    })
    const response = await requireMobileActor(request('Bearer access'))
    expect((response as { response: Response }).response).toBeDefined()
    expect(((response as { response: Response }).response as unknown as { status: number }).status).toBe(401)
  })

  it('rejects an idle-expired session', async () => {
    mockFindSessionAndActor.mockResolvedValue({
      session: { ...session, idleExpiresAt: new Date(Date.now() - 1000).toISOString() },
      actor,
    })
    const response = await requireMobileActor(request('Bearer access'))
    expect(((response as { response: Response }).response as unknown as { status: number }).status).toBe(401)
  })

  it('rejects an absolute-expired session', async () => {
    mockFindSessionAndActor.mockResolvedValue({
      session: { ...session, absoluteExpiresAt: new Date(Date.now() - 1000).toISOString() },
      actor,
    })
    const response = await requireMobileActor(request('Bearer access'))
    expect(((response as { response: Response }).response as unknown as { status: number }).status).toBe(401)
  })

  it('rejects when actor is null (missing profile)', async () => {
    mockFindSessionAndActor.mockResolvedValue({
      session,
      actor: null,
    })
    const response = await requireMobileActor(request('Bearer access'))
    expect(((response as { response: Response }).response as unknown as { status: number }).status).toBe(401)
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
    expect(mockFindSessionAndActor).toHaveBeenCalledWith('session-1')
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
    mockFindSessionAndActor.mockResolvedValue({
      session,
      actor: { ...actor, isActive: false },
    })
    const result = await requireMobileActor(request('Bearer access'))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect((result.response as unknown as { status: number }).status).toBe(403)
      expect(result.requestId).toBeDefined()
    }
  })

  it('permits an inactive actor when requireMobileSession is used', async () => {
    mockFindSessionAndActor.mockResolvedValue({
      session,
      actor: { ...actor, isActive: false },
    })
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
