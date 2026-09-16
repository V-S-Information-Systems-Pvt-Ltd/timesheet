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
} = vi.hoisted(() => ({
  mockGetActor: vi.fn(),
  mockVerify: vi.fn(),
  mockIsLegacy: vi.fn(),
  mockFindSessionAndActor: vi.fn(),
  mockList: vi.fn(),
  mockCreate: vi.fn(),
  mockWithIdempotency: vi.fn(),
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
}))
vi.mock('@/lib/idempotency', () => ({
  withIdempotency: mockWithIdempotency,
}))

import { GET, POST } from '@/app/api/v1/timesheets/route'

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
  it('serves a cookie GET with a web session actor and no bearer credentials', async () => {
    const res = await GET(new Request('http://localhost/api/v1/timesheets', { headers: { cookie: 'sb=1' } }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ data: { rows: [], count: 0 }, error: null })
    expect(mockList).toHaveBeenCalledWith(cookieActor, {})
    expect(mockGetActor).toHaveBeenCalledTimes(1)
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
    expect(mockList).toHaveBeenCalledWith(bearerActor, {})
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

describe('versioned timesheet routes are the only cookie opt-in', () => {
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

  it('only the five timesheet resource routes pass allowCookie', () => {
    const optedIn = routeFiles(V1_ROOT).filter((file) =>
      readFileSync(join(V1_ROOT, file), 'utf8').includes('allowCookie')
    )
    const expected = [
      join('timesheets', 'route.ts'),
      join('timesheets', '[id]', 'route.ts'),
      join('timesheets', '[id]', 'duplicate', 'route.ts'),
      join('timesheets', 'batch-delete', 'route.ts'),
      join('timesheets', 'batch-duplicate', 'route.ts'),
    ].sort()
    expect(optedIn).toEqual(expected)
  })
})
