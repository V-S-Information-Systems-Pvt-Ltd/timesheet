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

import { parseJsonBody, requireMobileActor, requireMobileSession, serviceResultResponse } from '@/app/api/v1/_http'

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

describe('parseJsonBody', () => {
  it('returns the parsed JSON body', async () => {
    await expect(parseJsonBody(new Request('http://localhost', { body: JSON.stringify({ value: 1 }), method: 'POST' }))).resolves.toEqual({
      ok: true,
      body: { value: 1 },
    })
  })

  it('returns the standard validation response for malformed JSON', async () => {
    const result = await parseJsonBody(new Request('http://localhost', { body: '{', method: 'POST' }))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.response.status).toBe(400)
      await expect(result.response.json()).resolves.toEqual({
        data: null,
        error: { code: 'VALIDATION_ERROR', message: 'A JSON request body is required.' },
      })
    }
  })
})

describe('serviceResultResponse', () => {
  it('returns the standard success envelope and uses the service status when supplied', async () => {
    const response = serviceResultResponse({ success: true, data: { id: 'leave-1' }, status: 201 })
    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toEqual({ data: { id: 'leave-1' }, error: null })
  })

  it('returns the standard error envelope without exposing service data', async () => {
    const response = serviceResultResponse({ success: false, code: 'FORBIDDEN', message: 'Not allowed.', status: 403 })
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      data: null,
      error: { code: 'FORBIDDEN', message: 'Not allowed.' },
    })
  })
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

describe('withMobileActor and withMobileSession', () => {
  it('executes callback with auth context when authentication succeeds', async () => {
    const { withMobileActor } = await import('@/app/api/v1/_http')
    const handler = vi.fn(async (auth) => {
      return new Response(JSON.stringify({ userId: auth.actor.id }), { status: 200 })
    })

    const res = await withMobileActor(request('Bearer access'), handler)
    expect(handler).toHaveBeenCalledTimes(1)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.userId).toBe('user-1')
  })

  it('short-circuits and returns 401 when unauthenticated', async () => {
    const { withMobileActor } = await import('@/app/api/v1/_http')
    const handler = vi.fn()

    const res = await withMobileActor(request(), handler)
    expect(handler).not.toHaveBeenCalled()
    expect(res.status).toBe(401)
  })

  it('withMobileSession allows inactive accounts through to handler', async () => {
    mockFindSessionAndActor.mockResolvedValue({
      session,
      actor: { ...actor, isActive: false },
    })
    const { withMobileSession } = await import('@/app/api/v1/_http')
    const handler = vi.fn(async (auth) => {
      return new Response(JSON.stringify({ active: auth.actor.isActive }), { status: 200 })
    })

    const res = await withMobileSession(request('Bearer access'), handler)
    expect(handler).toHaveBeenCalledTimes(1)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.active).toBe(false)
  })

  it('fails closed and returns 500 when Supabase bearer client creation throws', async () => {
    const bearerMod = await import('@/lib/supabase/bearer')
    const spy = vi.spyOn(bearerMod, 'createMobileBearerClient').mockImplementation(() => {
      throw new Error('Supabase client creation error')
    })

    const { withMobileActor } = await import('@/app/api/v1/_http')
    const handler = vi.fn()

    const res = await withMobileActor(request('Bearer access'), handler)
    expect(handler).not.toHaveBeenCalled()
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error.code).toBe('SERVER_ERROR')

    spy.mockRestore()
  })
})
