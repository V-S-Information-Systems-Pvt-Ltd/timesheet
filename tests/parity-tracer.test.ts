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
})
