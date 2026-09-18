import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockVerify, mockFindSessionAndActor, mockGetActor, mockIsLegacy } = vi.hoisted(() => ({
  mockVerify: vi.fn(),
  mockFindSessionAndActor: vi.fn(),
  mockGetActor: vi.fn(),
  mockIsLegacy: vi.fn(),
}))

vi.mock('@/lib/auth/mobile-tokens', () => ({
  verifyMobileAccessToken: mockVerify,
  isLegacyMobileToken: mockIsLegacy,
}))
vi.mock('@/lib/auth/mobile-session-store', () => ({
  mobileSessionStore: {
    findSessionAndActorById: mockFindSessionAndActor,
  },
}))
vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth')
  return { ...actual, getActor: mockGetActor }
})

import { apiSuccess, parseJsonBody, requireMobileActor, requireMobileSession, serviceResultResponse } from '@/app/api/v1/_http'

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
  mockGetActor.mockResolvedValue(actor)
  mockIsLegacy.mockResolvedValue(false)
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

describe('apiSuccess', () => {
  it('returns the standard success envelope with its status and headers', async () => {
    const response = apiSuccess({ id: 'entry-1' }, 201, { 'x-request-id': 'request-1' })
    expect(response.status).toBe(201)
    expect(response.headers.get('x-request-id')).toBe('request-1')
    await expect(response.json()).resolves.toEqual({ data: { id: 'entry-1' }, error: null })
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

  it.each([
    ['revoked', { revokedAt: '2026-08-26T10:00:00.000Z', rotatedAt: null }],
    ['rotated', { revokedAt: null, rotatedAt: '2026-08-26T10:00:00.000Z' }],
  ])('rejects a %s server session before creating the Supabase bearer client', async (_state, terminalState) => {
    const bearerMod = await import('@/lib/supabase/bearer')
    const createClientSpy = vi.spyOn(bearerMod, 'createMobileBearerClient')
    mockFindSessionAndActor.mockResolvedValue({
      session: { ...session, ...terminalState },
      actor,
    })

    const response = await requireMobileActor(request('Bearer access'))

    expect((response as { response: Response }).response).toBeDefined()
    expect(((response as { response: Response }).response as unknown as { status: number }).status).toBe(401)
    expect(createClientSpy).not.toHaveBeenCalled()
    createClientSpy.mockRestore()
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

describe('requireMobileActor credential selection (bearer vs cookie)', () => {
  const cookieRequest = () =>
    new Request('http://localhost/api/v1/timesheets', { headers: { cookie: 'sb-session=abc' } })
  const bearerRequest = (auth = 'Bearer access') =>
    new Request('http://localhost/api/v1/timesheets', { headers: { authorization: auth } })

  it('keeps explicit bearer working and reports the bearer context', async () => {
    const result = await requireMobileActor(bearerRequest())
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.via).toBe('bearer')
      expect(result.actor).toEqual(actor)
      expect('sessionId' in result && result.sessionId).toBe('session-1')
    }
    expect(mockGetActor).not.toHaveBeenCalled()
  })

  it('never falls back to a valid cookie when the bearer token is invalid', async () => {
    mockVerify.mockResolvedValue(null)
    const req = new Request('http://localhost/api/v1/timesheets', {
      headers: { authorization: 'Bearer invalid', cookie: 'sb-session=abc' },
    })
    const result = await requireMobileActor(req, { allowCookie: true })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.response.status).toBe(401)
      expect((await result.response.json()).error.code).toBe('ACCESS_TOKEN_EXPIRED')
    }
    expect(mockGetActor).not.toHaveBeenCalled()
  })

  it('rejects a malformed Authorization header without cookie fallback', async () => {
    const req = new Request('http://localhost/api/v1/timesheets', {
      headers: { authorization: 'Basic abc', cookie: 'sb-session=abc' },
    })
    const result = await requireMobileActor(req, { allowCookie: true })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.response.status).toBe(401)
      expect((await result.response.json()).error.code).toBe('AUTH_REQUIRED')
    }
    expect(mockVerify).not.toHaveBeenCalled()
    expect(mockGetActor).not.toHaveBeenCalled()
  })

  it('never falls back to a valid cookie when the bearer session is revoked', async () => {
    mockFindSessionAndActor.mockResolvedValue({
      session: { ...session, revokedAt: '2026-08-26T10:00:00.000Z' },
      actor,
    })
    const req = new Request('http://localhost/api/v1/timesheets', {
      headers: { authorization: 'Bearer access', cookie: 'sb-session=abc' },
    })
    const result = await requireMobileActor(req, { allowCookie: true })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.response.status).toBe(401)
      expect((await result.response.json()).error.code).toBe('SESSION_REVOKED')
    }
    expect(mockGetActor).not.toHaveBeenCalled()
  })

  it('resolves a cookie actor where the route opts in and no Authorization header is present', async () => {
    const result = await requireMobileActor(cookieRequest(), { allowCookie: true })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.via).toBe('cookie')
      expect(result.actor).toEqual(actor)
      expect('sessionId' in result).toBe(false)
      expect('token' in result).toBe(false)
    }
    expect(mockGetActor).toHaveBeenCalledTimes(1)
    expect(mockVerify).not.toHaveBeenCalled()
  })

  it('rejects missing credentials with AUTH_REQUIRED on cookie-enabled routes', async () => {
    mockGetActor.mockResolvedValue(null)
    const result = await requireMobileActor(
      new Request('http://localhost/api/v1/timesheets'),
      { allowCookie: true }
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.response.status).toBe(401)
      expect((await result.response.json()).error.code).toBe('AUTH_REQUIRED')
    }
  })

  it('rejects missing credentials with AUTH_REQUIRED on bearer-only routes and never consults cookies', async () => {
    const result = await requireMobileActor(request())
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.response.status).toBe(401)
      expect((await result.response.json()).error.code).toBe('AUTH_REQUIRED')
    }
    expect(mockGetActor).not.toHaveBeenCalled()
  })

  it('rejects an inactive user on cookie routes with 403 ACCOUNT_INACTIVE', async () => {
    mockGetActor.mockResolvedValue({ ...actor, isActive: false })
    const result = await requireMobileActor(cookieRequest(), { allowCookie: true })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.response.status).toBe(403)
      expect((await result.response.json()).error.code).toBe('ACCOUNT_INACTIVE')
    }
  })

  it('rejects a non-active user on bearer routes (revoked/inactive no fallback)', async () => {
    mockFindSessionAndActor.mockResolvedValue({ session, actor: { ...actor, isActive: false } })
    const result = await requireMobileActor(bearerRequest(), { allowCookie: true })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.response.status).toBe(403)
      expect((await result.response.json()).error.code).toBe('ACCOUNT_INACTIVE')
    }
    expect(mockGetActor).not.toHaveBeenCalled()
  })
})

describe('requireMobileActor cookie mutation origin protection', () => {
  it('rejects a cross-origin cookie mutation with 403 before resolving identity', async () => {
    const req = new Request('http://localhost:3000/api/v1/timesheets', {
      method: 'POST',
      headers: { host: 'localhost:3000', origin: 'http://evil.com', cookie: 'sb=1' },
    })
    const result = await requireMobileActor(req, { allowCookie: true })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.response.status).toBe(403)
    }
    expect(mockGetActor).not.toHaveBeenCalled()
  })

  it('allows a same-origin cookie mutation', async () => {
    const req = new Request('http://localhost:3000/api/v1/timesheets', {
      method: 'POST',
      headers: { host: 'localhost:3000', origin: 'http://localhost:3000', cookie: 'sb=1' },
    })
    const result = await requireMobileActor(req, { allowCookie: true })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.via).toBe('cookie')
    }
  })

  it('does not apply origin protection to bearer mutations', async () => {
    const req = new Request('http://localhost:3000/api/v1/timesheets', {
      method: 'POST',
      headers: { host: 'localhost:3000', origin: 'http://evil.com', authorization: 'Bearer access' },
    })
    const result = await requireMobileActor(req, { allowCookie: true })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.via).toBe('bearer')
    }
  })
})

describe('requireMobileActor feature-gate dispatch', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('keeps 503 MOBILE_API_DISABLED for explicit bearer while cookie requests bypass the gate', async () => {
    vi.stubEnv('MOBILE_BEARER_AUTH_ENABLED', 'false')

    const bearer = await requireMobileActor(
      new Request('http://localhost/api/v1/timesheets', { headers: { authorization: 'Bearer access' } }),
      { allowCookie: true }
    )
    expect(bearer.ok).toBe(false)
    if (!bearer.ok) {
      expect(bearer.response.status).toBe(503)
      expect((await bearer.response.json()).error.code).toBe('MOBILE_API_DISABLED')
    }

    const cookie = await requireMobileActor(
      new Request('http://localhost/api/v1/timesheets', { headers: { cookie: 'sb=1' } }),
      { allowCookie: true }
    )
    expect(cookie.ok).toBe(true)
    if (cookie.ok) {
      expect(cookie.via).toBe('cookie')
    }

    mockGetActor.mockResolvedValue(null)
    const missing = await requireMobileActor(
      new Request('http://localhost/api/v1/timesheets'),
      { allowCookie: true }
    )
    expect(missing.ok).toBe(false)
    if (!missing.ok) {
      expect(missing.response.status).toBe(401)
      expect((await missing.response.json()).error.code).toBe('AUTH_REQUIRED')
    }
  })

  it('leaves the bearer-only gate behavior unchanged (no header, gate disabled => 503)', async () => {
    vi.stubEnv('MOBILE_BEARER_AUTH_ENABLED', 'false')
    const result = await requireMobileActor(request())
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.response.status).toBe(503)
      expect((await result.response.json()).error.code).toBe('MOBILE_API_DISABLED')
    }
  })
})

describe('requireMobileActor concurrent cookie and bearer isolation', () => {
  it('resolves each request to its own actor and Supabase client context', async () => {
    const { withMobileActor } = await import('@/app/api/v1/_http')
    const { getMobileSupabaseClient } = await import('@/lib/supabase/bearer')

    const bearerActor = { ...actor, id: 'user-bearer', email: 'bearer@example.com' }
    const cookieActor = { ...actor, id: 'user-cookie', email: 'cookie@example.com' }
    mockVerify.mockResolvedValue({
      userId: 'user-bearer',
      sessionId: 'session-b',
      familyId: 'family-b',
    })
    mockFindSessionAndActor.mockResolvedValue({
      session: { ...session, id: 'session-b', userId: 'user-bearer', familyId: 'family-b' },
      actor: bearerActor,
    })
    mockGetActor.mockResolvedValue(cookieActor)

    const observe = async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
      return {
        id: '',
        via: '',
        hasMobileClient: Boolean(getMobileSupabaseClient()),
      }
    }

    const [fromBearer, fromCookie] = await Promise.all([
      withMobileActor(
        new Request('http://localhost/api/v1/timesheets', { headers: { authorization: 'Bearer access' } }),
        async (auth) => {
          const seen = await observe()
          return { ...seen, id: auth.actor.id, via: auth.via }
        }
      ),
      withMobileActor(
        new Request('http://localhost/api/v1/timesheets', { headers: { cookie: 'sb=1' } }),
        async (auth) => {
          const seen = await observe()
          return { ...seen, id: auth.actor.id, via: auth.via }
        },
        { allowCookie: true }
      ),
    ])

    expect(fromBearer).toEqual({ id: 'user-bearer', via: 'bearer', hasMobileClient: true })
    expect(fromCookie).toEqual({ id: 'user-cookie', via: 'cookie', hasMobileClient: false })
  })
})
