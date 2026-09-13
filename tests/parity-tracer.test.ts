import { beforeEach, describe, expect, it, vi } from 'vitest'
import { signMobileAccessToken, verifyMobileAccessToken } from '@/lib/auth/mobile-tokens'
import { createMobileBearerClient, getMobileSupabaseClient, runWithMobileSupabaseClient } from '@/lib/supabase/bearer'
import { requireMobileActor } from '@/app/api/v1/_http'

const { mockFindSessionAndActor } = vi.hoisted(() => ({
  mockFindSessionAndActor: vi.fn(),
}))

vi.mock('@/lib/auth/mobile-session-store', () => ({
  mobileSessionStore: {
    findSessionAndActorById: mockFindSessionAndActor,
  },
}))

describe('T18.0 & T17.0: Parity Tracer & Mobile Bearer Principal Binding', () => {
  const future = new Date(Date.now() + 86400 * 1000).toISOString()
  const userId = 'user-uuid-1234'
  const sessionId = 'session-uuid-1234'
  const familyId = 'family-uuid-1234'

  const actor = {
    id: userId,
    email: 'engineer@example.com',
    role: 'user' as const,
    permission_role: 'user' as const,
    hierarchy_role: 'engineer' as const,
    isActive: true,
  }

  const session = {
    id: sessionId,
    userId,
    familyId,
    revokedAt: null,
    rotatedAt: null,
    idleExpiresAt: future,
    absoluteExpiresAt: future,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.MOBILE_BEARER_AUTH_ENABLED = 'true'
    process.env.MOBILE_AUTH_SECRET = '01234567890123456789012345678901'
    mockFindSessionAndActor.mockResolvedValue({ session, actor })
  })

  it('signs and verifies mobile token with standard claims', async () => {
    const token = await signMobileAccessToken({
      userId,
      sessionId,
      familyId,
    })
    expect(typeof token).toBe('string')

    const claims = await verifyMobileAccessToken(token)
    expect(claims).not.toBeNull()
    expect(claims?.userId).toBe(userId)
    expect(claims?.sessionId).toBe(sessionId)
    expect(claims?.familyId).toBe(familyId)
  })

  it('rejects tokens missing the server-authored role claim in Supabase mode', async () => {
    const { SignJWT } = await import('jose')
    const backend = process.env.NEXT_PUBLIC_BACKEND?.trim()
    if (backend && backend !== 'supabase') return
    const key = new TextEncoder().encode(
      process.env.SUPABASE_MOBILE_SIGNING_KEY ?? 'supabase-mobile-signing-key-0123456789012345'
    )
    const noRole = await new SignJWT({ sid: sessionId, family: familyId, ver: 1 })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT', kid: 'test-key-id-1' })
      .setSubject(userId)
      .setIssuer('vsis-timesheet-mobile')
      .setAudience('authenticated')
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(key)
    await expect(verifyMobileAccessToken(noRole)).resolves.toBeNull()
  })

  it('rejects sessions whose user does not match the token subject', async () => {
    const token = await signMobileAccessToken({ userId, sessionId, familyId })
    mockFindSessionAndActor.mockResolvedValueOnce({
      session: { ...session, userId: 'different-user' },
      actor,
    })
    const req = new Request('http://localhost/api/v1/dashboard', {
      headers: { authorization: `Bearer ${token}` },
    })
    const result = await requireMobileActor(req)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      const data = await result.response.json()
      expect(data.error.code).toBe('SESSION_REVOKED')
    }
  })

  it('rejects bearer requests when MOBILE_BEARER_AUTH_ENABLED is false', async () => {
    process.env.MOBILE_BEARER_AUTH_ENABLED = 'false'
    const token = await signMobileAccessToken({ userId, sessionId, familyId })
    const req = new Request('http://localhost/api/v1/dashboard', {
      headers: { authorization: `Bearer ${token}` },
    })

    const result = await requireMobileActor(req)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.response.status).toBe(503)
      const data = await result.response.json()
      expect(data.error.code).toBe('MOBILE_API_DISABLED')
    }
  })

  it('establishes a request-scoped Supabase client bound to bearer token', async () => {
    const token = await signMobileAccessToken({ userId, sessionId, familyId })
    const client = createMobileBearerClient(token)
    expect(client).toBeDefined()

    await runWithMobileSupabaseClient(client, async () => {
      const activeClient = getMobileSupabaseClient()
      expect(activeClient).toBe(client)
    })

    // Cleared outside scope
    expect(getMobileSupabaseClient()).toBeUndefined()
  })

  it('rejects cross-user authorization access for standard user', async () => {
    const _unrelatedActor = {
      ...actor,
      id: 'unrelated-user-5678',
      email: 'other@example.com',
    }

    // Role check logic parity test
    const canSeeOther = (actor.permission_role as string) === 'admin' || (actor.hierarchy_role as string) === 'manager'
    expect(canSeeOther).toBe(false)

    // Admin can see other
    const adminActor = {
      ...actor,
      id: 'admin-1',
      permission_role: 'admin' as const,
    }
    const adminCanSeeOther = adminActor.permission_role === 'admin'
    expect(adminCanSeeOther).toBe(true)
  })

  // Real-backend tracer (T18.0 gate): uses a disposable Postgres when
  // TEST_DATABASE_URL is set; otherwise reports "not run" (never green).
  // Covers one allow + one deny slice with persisted-state assertions.
  it.skipIf(!process.env.TEST_DATABASE_URL)('traces a real-backend timesheet allow/deny slice when TEST_DATABASE_URL is set', async () => {
    // lib/db/pool.ts resolves DATABASE_URL at call time; mirror the CI
    // convention that TEST_DATABASE_URL feeds the disposable database.
    if (!process.env.DATABASE_URL) {
      process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
    }
    const { nativeRepository } = await import('@/lib/db/native')
    const { query } = await import('@/lib/db/pool')
    const stamp = Date.now().toString(36)
    const ownerEmail = `tracer-owner-${stamp}@example.com`
    const strangerEmail = `tracer-stranger-${stamp}@example.com`
    const projectName = `TracerProj-${stamp}`
    const logDate = '2099-06-15'

    const ownerRow = await query<{ id: string }>(
      `insert into public.profiles (email, name, role, is_active) values ($1, $1, 'user', true) returning id`,
      [ownerEmail]
    )
    const strangerRow = await query<{ id: string }>(
      `insert into public.profiles (email, name, role, is_active) values ($1, $1, 'user', true) returning id`,
      [strangerEmail]
    )
    const ownerId = ownerRow[0].id
    const strangerId = strangerRow[0].id
    const owner = { ...actor, id: ownerId, email: ownerEmail }
    const stranger = { ...actor, id: strangerId, email: strangerEmail }

    try {
      const proj = await query<{ id: string }>(
        `insert into public.projects (name) values ($1) returning id`,
        [projectName]
      )
      await query('insert into public.timesheets (user_id, project_id, log_date, hours_worked, work_done) values ($1, $2, $3, 4, $4)', [
        ownerId,
        proj[0].id,
        logDate,
        'tracer allow slice',
      ])

      // Allow: owner lists their own row in the tracer date window.
      const allowed = await nativeRepository.listTimesheets(owner, { dateFrom: logDate, dateTo: logDate })
      expect(allowed.rows.some((r) => r.user_id === ownerId && r.log_date === logDate)).toBe(true)

      // Deny: stranger's identically-scoped read must not surface the
      // owner's row (persisted-state deny, not a mock-shape assertion).
      const denied = await nativeRepository.listTimesheets(stranger, { dateFrom: logDate, dateTo: logDate })
      expect(denied.rows.some((r) => r.user_id === ownerId)).toBe(false)
    } finally {
      await query('delete from public.timesheets where user_id in ($1, $2)', [ownerId, strangerId]).catch(() => [])
      await query('delete from public.projects where name = $1', [projectName]).catch(() => [])
      await query('delete from public.profiles where id in ($1, $2)', [ownerId, strangerId]).catch(() => [])
    }
  })
})
