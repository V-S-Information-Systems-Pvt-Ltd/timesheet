// tests/mobile-timesheets-cookie-auth.test.ts
//
// Slice 03: the versioned timesheet resources accept an authenticated
// browser-cookie request (no Authorization header) in addition to the mobile
// bearer request, while explicit bearer credentials keep working unchanged.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const {
  mockGetActor,
  mockVerify,
  mockIsLegacy,
  mockFindSessionAndActor,
  mockList,
  mockCreate,
  mockWithIdempotency,
  mockWriteGate,
} = vi.hoisted(() => ({
  mockGetActor: vi.fn(),
  mockVerify: vi.fn(),
  mockIsLegacy: vi.fn(),
  mockFindSessionAndActor: vi.fn(),
  mockList: vi.fn(),
  mockCreate: vi.fn(),
  mockWithIdempotency: vi.fn(),
  mockWriteGate: vi.fn(),
}))

vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth')
  return { ...actual, getActor: mockGetActor }
})
vi.mock('@/lib/auth/mobile-tokens', () => ({
  verifyMobileAccessToken: mockVerify,
  isLegacyMobileToken: mockIsLegacy,
}))
vi.mock('@/lib/auth/mobile-session-store', () => ({
  mobileSessionStore: {
    findSessionAndActorById: mockFindSessionAndActor,
  },
}))
vi.mock('@/lib/api/v1/services/timesheets', () => ({
  listTimesheetsService: mockList,
  createTimesheetService: mockCreate,
  createYesterdayTimesheetService: mockCreate,
  deleteLastTimesheetService: mockCreate,
  getLastTimesheetService: mockList,
  batchUpdateTimesheetsService: mockCreate,
}))
vi.mock('@/lib/idempotency', () => ({
  withIdempotency: mockWithIdempotency,
}))

vi.mock('@/lib/db/write-gate', () => ({ writeGateResponse: mockWriteGate }))

import { GET, POST } from '@/app/api/v1/timesheets/route'
import { POST as yesterdayPost } from '@/app/api/v1/timesheets/yesterday/route'
import { DELETE as lastDelete, GET as lastGet } from '@/app/api/v1/timesheets/last/route'
import { POST as batchUpdatePost } from '@/app/api/v1/timesheets/batch-update/route'

const cookieActor = {
  id: 'user-cookie',
  email: 'cookie@example.com',
  role: 'user' as const,
  permission_role: 'user' as const,
  hierarchy_role: 'user' as const,
  isActive: true,
}
const bearerActor = {
  id: 'user-bearer',
  email: 'bearer@example.com',
  role: 'user' as const,
  permission_role: 'user' as const,
  hierarchy_role: 'user' as const,
  isActive: true,
}
const future = new Date(Date.now() + 30 * 86400 * 1000).toISOString()
const bearerSession = {
  id: 'session-b',
  userId: 'user-bearer',
  familyId: 'family-b',
  revokedAt: null,
  rotatedAt: null,
  idleExpiresAt: future,
  absoluteExpiresAt: future,
}
const validBody = {
  projectId: 'proj-1',
  activityTypeId: 'act-1',
  hoursWorked: 7.5,
  workDone: 'Cookie work',
  logDate: '2026-08-26',
}
const POST_URL = 'http://localhost:3000/api/v1/timesheets'

beforeEach(() => {
  vi.clearAllMocks()
  mockWriteGate.mockReset().mockResolvedValue(null)
  mockGetActor.mockResolvedValue(cookieActor)
  mockVerify.mockResolvedValue({ userId: 'user-bearer', sessionId: 'session-b', familyId: 'family-b' })
  mockIsLegacy.mockResolvedValue(false)
  mockFindSessionAndActor.mockResolvedValue({ session: bearerSession, actor: bearerActor })
  mockList.mockResolvedValue({ success: true, data: { rows: [], count: 0 } })
  mockCreate.mockResolvedValue({ success: true, data: { success: true } })
  mockWithIdempotency.mockImplementation(
    async (
      _request: Request,
      _actorId: string,
      _operation: string,
      _payload: unknown,
      execute: () => Promise<Response>
    ) => execute()
  )
})

describe('/api/v1/timesheets cookie authentication', () => {
  it('requires updated clients on classified reads after activation', async () => {
    try {
      vi.stubEnv('TIMESHEET_CLASSIFICATION_V2', 'true')
      const old = await GET(new Request('http://localhost/api/v1/timesheets', { headers: { authorization: 'Bearer old' } }))
      expect(old.status).toBe(409)
      expect(await old.json()).toMatchObject({ error: { code: 'CLIENT_UPDATE_REQUIRED' } })
      expect(mockList).not.toHaveBeenCalled()
      const updated = await GET(new Request('http://localhost/api/v1/timesheets', { headers: { 'X-Timesheet-Format': '2' } }))
      expect(updated.status).toBe(200)
      expect(mockList).toHaveBeenCalledTimes(1)
    } finally { vi.unstubAllEnvs() }
  })
  it('reads Undo Last preview through the same active cookie actor without a write gate', async () => {
    mockList.mockResolvedValueOnce({ success: true, data: { entry: null } })
    const response = await lastGet(new Request('http://localhost/api/v1/timesheets/last', { headers: { cookie: 'sb=1' } }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: { entry: null }, error: null })
    expect(mockList).toHaveBeenCalledWith(cookieActor)
    expect(mockWriteGate).not.toHaveBeenCalled()
  })
  it('rejects an inactive Last preview without reading persistence', async () => {
    mockGetActor.mockResolvedValueOnce({ ...cookieActor, isActive: false })
    const response = await lastGet(new Request('http://localhost/api/v1/timesheets/last', { headers: { cookie: 'sb=1' } }))
    expect(response.status).toBe(403)
    expect(mockList).not.toHaveBeenCalled()
  })
  const actionRoutes = [
    { name: 'yesterday', method: 'POST', handler: yesterdayPost, body: validBody },
    { name: 'last', method: 'DELETE', handler: lastDelete, body: undefined },
    { name: 'batch-update', method: 'POST', handler: batchUpdatePost, body: { entries: [{ ...validBody, id: 'ts-1' }] } },
  ]

  for (const route of actionRoutes) {
    function actionRequest(headers: Record<string, string>) {
      return new Request(`http://localhost:3000/api/v1/timesheets/${route.name}`, {
        method: route.method,
        headers: { host: 'localhost:3000', origin: 'http://localhost:3000', ...headers },
        ...(route.body ? { body: JSON.stringify(route.body) } : {}),
      })
    }

    it(`${route.name} accepts browser cookies independently of the bearer flag`, async () => {
      vi.stubEnv('MOBILE_BEARER_AUTH_ENABLED', 'false')
      try {
        const res = await route.handler(actionRequest({ cookie: 'sb=1' }))
        expect(res.status).toBe(route.name === 'yesterday' ? 201 : 200)
        expect(mockCreate).toHaveBeenCalled()
        expect(mockVerify).not.toHaveBeenCalled()
      } finally {
        vi.unstubAllEnvs()
      }
    })

    it.each(['closed', 'unreadable'])(`${route.name} refuses writes when the fence is %s`, async (state) => {
      if (state === 'closed') mockWriteGate.mockResolvedValue({ status: 503, body: { error: 'Writers are fenced.' } })
      else mockWriteGate.mockRejectedValue(new Error('Gate unavailable'))
      const response = await route.handler(actionRequest({ cookie: 'sb=1' }))
      expect(response.status).toBe(503)
      expect(response.headers.get('retry-after')).toBe('60')
      expect(await response.json()).toMatchObject({ error: { code: 'WRITERS_FENCED' } })
      expect(mockCreate).not.toHaveBeenCalled()
    })

    it(`${route.name} rejects foreign origins before identity or persistence access`, async () => {
      const res = await route.handler(actionRequest({ origin: 'https://evil.example' }))
      expect(res.status).toBe(403)
      expect(mockGetActor).not.toHaveBeenCalled()
      expect(mockCreate).not.toHaveBeenCalled()
    })

    it(`${route.name} rejects inactive cookie actors`, async () => {
      mockGetActor.mockResolvedValue({ ...cookieActor, isActive: false })
      const res = await route.handler(actionRequest({ cookie: 'sb=1' }))
      expect(res.status).toBe(403)
      expect(mockCreate).not.toHaveBeenCalled()
    })

    it(`${route.name} does not fall back from invalid bearer credentials to cookies`, async () => {
      const res = await route.handler(actionRequest({ authorization: 'invalid', cookie: 'sb=1' }))
      expect(res.status).toBe(401)
      expect(mockGetActor).not.toHaveBeenCalled()
      expect(mockCreate).not.toHaveBeenCalled()
    })
  }

  it('serves a cookie GET with a web session actor and no bearer credentials', async () => {
    const res = await GET(new Request('http://localhost/api/v1/timesheets', { headers: { cookie: 'sb=1' } }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ data: { rows: [], count: 0 }, error: null })
    expect(mockList).toHaveBeenCalledWith(cookieActor, { from: 0, to: 49, limit: 50 })
    expect(mockGetActor).toHaveBeenCalledTimes(1)
    expect(mockVerify).not.toHaveBeenCalled()
  })

  it('forwards the browser cookie count opt-out', async () => {
    const res = await GET(new Request('http://localhost/api/v1/timesheets?includeCount=false', {
      headers: { cookie: 'sb=1' },
    }))
    expect(res.status).toBe(200)
    expect(mockList).toHaveBeenCalledWith(cookieActor, expect.objectContaining({ includeCount: false }))
    expect(mockVerify).not.toHaveBeenCalled()
  })

  it('rejects a cookie GET without a signed-in account with 401 AUTH_REQUIRED', async () => {
    mockGetActor.mockResolvedValue(null)
    const res = await GET(new Request('http://localhost/api/v1/timesheets'))
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error.code).toBe('AUTH_REQUIRED')
    expect(mockList).not.toHaveBeenCalled()
  })

  it('still serves bearer GET via the bearer path (no cookie lookup)', async () => {
    const res = await GET(
      new Request('http://localhost/api/v1/timesheets', { headers: { authorization: 'Bearer access' } })
    )
    expect(res.status).toBe(200)
    expect(mockList).toHaveBeenCalledWith(bearerActor, { from: 0, to: 49, limit: 50 })
    expect(mockGetActor).not.toHaveBeenCalled()
  })

  it('rejects a cross-origin cookie POST with 403 before reaching the service', async () => {
    const req = new Request(POST_URL, {
      method: 'POST',
      headers: {
        host: 'localhost:3000',
        origin: 'http://evil.example',
        cookie: 'sb=1',
        'content-type': 'application/json',
      },
      body: JSON.stringify(validBody),
    })
    const res = await POST(req)
    expect(res.status).toBe(403)
    expect(mockCreate).not.toHaveBeenCalled()
    expect(mockGetActor).not.toHaveBeenCalled()
  })

  it('creates an entry from a same-origin cookie POST', async () => {
    const req = new Request(POST_URL, {
      method: 'POST',
      headers: {
        host: 'localhost:3000',
        origin: 'http://localhost:3000',
        cookie: 'sb=1',
        'content-type': 'application/json',
      },
      body: JSON.stringify(validBody),
    })
    const res = await POST(req)
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body).toEqual({ data: { success: true }, error: null })
    expect(mockCreate).toHaveBeenCalledWith(cookieActor, expect.objectContaining({ projectId: 'proj-1' }))
  })

  it('keeps bearer POST working without an Origin header (no origin check)', async () => {
    const req = new Request(POST_URL, {
      method: 'POST',
      headers: {
        host: 'localhost:3000',
        authorization: 'Bearer access',
        'content-type': 'application/json',
      },
      body: JSON.stringify(validBody),
    })
    const res = await POST(req)
    expect(res.status).toBe(201)
    expect(mockCreate).toHaveBeenCalledWith(bearerActor, expect.objectContaining({ projectId: 'proj-1' }))
    expect(mockGetActor).not.toHaveBeenCalled()
  })
})

describe('versioned browser routes use explicit cookie opt-in', () => {
  const V1_ROOT = join(process.cwd(), 'app', 'api', 'v1')

  function routeFiles(dir: string): string[] {
    const out: string[] = []
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) {
        out.push(...routeFiles(full))
      } else if (entry === 'route.ts') {
        out.push(relative(V1_ROOT, full))
      }
    }
    return out.sort()
  }

  it('only the migrated browser-compatible v1 routes pass allowCookie', () => {
    const optedIn = routeFiles(V1_ROOT).filter((file) =>
      readFileSync(join(V1_ROOT, file), 'utf8').includes('allowCookie')
    )
    const expected = [
      join('admin', 'activity-types', '[id]', 'route.ts'),
      join('admin', 'activity-types', 'route.ts'),
      join('admin', 'backup', 'restore', 'route.ts'),
      join('admin', 'backup', 'route.ts'),
      join('admin', 'branding', 'route.ts'),
      join('admin', 'global-reminders', '[id]', 'route.ts'),
      join('admin', 'global-reminders', 'route.ts'),
      join('admin', 'projects', 'route.ts'),
      join('admin', 'projects', '[id]', 'route.ts'),
      join('admin', 'settings', 'backfill', 'route.ts'),
      join('admin', 'superadmin', 'reset', 'route.ts'),
      join('admin', 'superadmin', 'users', '[id]', 'route.ts'),
      join('admin', 'superadmin', 'whitelist', '[id]', 'route.ts'),
      join('admin', 'superadmin', 'whitelist', 'route.ts'),
      join('admin', 'timesheets', 'import', 'route.ts'),
      join('admin', 'titles', 'impact', 'route.ts'),
      join('admin', 'titles', 'route.ts'),
      join('admin', 'users', 'route.ts'),
      join('admin', 'users', '[id]', 'route.ts'),
      join('admin', 'users', '[id]', 'timesheets', 'route.ts'),
      join('capabilities', 'route.ts'),
      join('layout', 'web', 'route.ts'),
      join('leaves', '[id]', 'route.ts'),
      join('leaves', 'route.ts'),
      join('people', 'route.ts'),
      join('profile', 'route.ts'),
      join('reference', 'route.ts'),
      join('reminders', '[id]', 'route.ts'),
      join('reminders', 'global', '[id]', 'dismiss', 'route.ts'),
      join('reminders', 'global', 'route.ts'),
      join('reminders', 'route.ts'),
      join('reports', 'export', 'route.ts'),
      join('reports', 'route.ts'),
      join('settings', 'backfill', 'route.ts'),
      join('timesheets', 'route.ts'),
      join('timesheets', '[id]', 'route.ts'),
      join('timesheets', '[id]', 'duplicate', 'route.ts'),
      join('timesheets', 'batch-delete', 'route.ts'),
      join('timesheets', 'batch-update', 'route.ts'),
      join('timesheets', 'batch-duplicate', 'route.ts'),
      join('timesheets', 'last', 'route.ts'),
      join('timesheets', 'yesterday', 'route.ts'),
    ].sort()
    expect(optedIn).toEqual(expected)
  })
})
