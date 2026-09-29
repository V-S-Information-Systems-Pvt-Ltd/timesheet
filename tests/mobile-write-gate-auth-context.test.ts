import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mobileClient,
  mobileFrom,
  mobileMaybeSingle,
  mockCreateCookieClient,
  mockFindSessionAndActor,
  mockVerify,
} = vi.hoisted(() => {
  const mobileMaybeSingle = vi.fn()
  const mobileFrom = vi.fn(() => ({
    select: vi.fn(() => ({ maybeSingle: mobileMaybeSingle })),
  }))

  return {
    mobileClient: { from: mobileFrom },
    mobileFrom,
    mobileMaybeSingle,
    mockCreateCookieClient: vi.fn(),
    mockFindSessionAndActor: vi.fn(),
    mockVerify: vi.fn(),
  }
})

vi.mock('@/lib/backend/config', () => ({
  IS_NATIVE: false,
  IS_SUPABASE: true,
}))

vi.mock('@/lib/auth/mobile-config', () => ({
  isMobileBearerAuthEnabled: () => true,
}))

vi.mock('@/lib/auth/mobile-tokens', () => ({
  verifyMobileAccessToken: mockVerify,
  isLegacyMobileToken: vi.fn(async () => false),
}))

vi.mock('@/lib/auth/mobile-session-store', () => ({
  mobileSessionStore: {
    findSessionAndActorById: mockFindSessionAndActor,
  },
}))

vi.mock('@/lib/auth', () => ({
  getActor: vi.fn(async () => null),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: mockCreateCookieClient,
}))

vi.mock('@/lib/supabase/bearer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/supabase/bearer')>()
  return {
    ...actual,
    createMobileBearerClient: vi.fn(() => mobileClient),
  }
})

import { requireMobileActor } from '@/app/api/v1/_http'
import { resetAppWriteGateCache } from '@/lib/db/write-gate'

describe('mobile write-gate authentication context', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetAppWriteGateCache()

    mockVerify.mockResolvedValue({
      userId: 'user-1',
      sessionId: 'session-1',
      familyId: 'family-1',
    })
    mockFindSessionAndActor.mockResolvedValue({
      session: {
        id: 'session-1',
        userId: 'user-1',
        familyId: 'family-1',
        revokedAt: null,
        rotatedAt: null,
        idleExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        absoluteExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      },
      actor: {
        id: 'user-1',
        email: 'user@example.com',
        role: 'user',
        permissionRole: 'user',
        hierarchyRole: 'user',
        isActive: true,
      },
    })
    mobileMaybeSingle.mockResolvedValue({
      data: { state: 'open', run_id: null, reason: null },
      error: null,
    })
    mockCreateCookieClient.mockResolvedValue({
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          maybeSingle: vi.fn(async () => ({
            data: null,
            error: { code: '42501', message: 'permission denied for table migration_write_gate' },
          })),
        })),
      })),
    })
  })

  it('reads the Supabase gate with the bearer-scoped client for a mobile mutation', async () => {
    const result = await requireMobileActor(
      new Request('https://example.test/api/v1/timesheets', {
        method: 'POST',
        headers: { authorization: 'Bearer access-token' },
      })
    )

    expect(result.ok).toBe(true)
    expect(mobileFrom).toHaveBeenCalledWith('migration_write_gate')
    expect(mockCreateCookieClient).not.toHaveBeenCalled()
  })
})
