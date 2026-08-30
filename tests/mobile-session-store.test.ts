import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockQuery, mockTransaction, mockFrom, mockRpc } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockTransaction: vi.fn(),
  mockFrom: vi.fn(),
  mockRpc: vi.fn(),
}))

vi.mock('@/lib/db/pool', () => ({
  query: mockQuery,
  transaction: mockTransaction,
}))

vi.mock('@/lib/supabase/admin', () => ({
  getAdminClient: () => ({
    from: mockFrom,
    rpc: mockRpc,
  }),
}))

import { mobileSessionStore } from '@/lib/auth/mobile-session-store'

describe('mobileSessionStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates a session with computed expiry', async () => {
    const fakeRow = {
      id: 's-1',
      user_id: 'u-1',
      family_id: 'f-1',
      refresh_token_hash: 'hash-1',
      previous_token_hash: null,
      device_name: 'Pixel 9',
      platform: 'android',
      created_at: '2026-08-26T10:00:00.000Z',
      last_used_at: '2026-08-26T10:00:00.000Z',
      idle_expires_at: '2026-09-25T10:00:00.000Z',
      absolute_expires_at: '2026-11-24T10:00:00.000Z',
      rotated_at: null,
      revoked_at: null,
      replaced_by_id: null,
    }

    mockFrom.mockReturnValue({
      insert: () => ({
        select: () => ({
          single: async () => ({ data: fakeRow, error: null }),
        }),
      }),
    })

    const created = await mobileSessionStore.create({
      userId: 'u-1',
      refreshTokenHash: 'hash-1',
      deviceName: 'Pixel 9',
      platform: 'android',
    })

    expect(created.id).toBe('s-1')
    expect(created.userId).toBe('u-1')
    expect(created.familyId).toBe('f-1')
  })

  it('finds session by token hash and id', async () => {
    const fakeRow = {
      id: 's-1',
      user_id: 'u-1',
      family_id: 'f-1',
      refresh_token_hash: 'hash-1',
      previous_token_hash: null,
      device_name: 'iPhone 16',
      platform: 'ios',
      created_at: '2026-08-26T10:00:00.000Z',
      last_used_at: '2026-08-26T10:00:00.000Z',
      idle_expires_at: '2026-09-25T10:00:00.000Z',
      absolute_expires_at: '2026-11-24T10:00:00.000Z',
      rotated_at: null,
      revoked_at: null,
      replaced_by_id: null,
    }

    mockFrom.mockReturnValue({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: fakeRow, error: null }),
        }),
      }),
    })

    const foundByHash = await mobileSessionStore.findByHash('hash-1')
    expect(foundByHash?.id).toBe('s-1')

    const foundById = await mobileSessionStore.findById('s-1')
    expect(foundById?.id).toBe('s-1')

    mockFrom.mockReturnValue({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null, error: null }),
        }),
      }),
    })
    const notFound = await mobileSessionStore.findById('none')
    expect(notFound).toBeNull()
  })

  it('finds session and actor in a single combined lookup', async () => {
    const fakeJoinedRow = {
      id: 's-1',
      user_id: 'u-1',
      family_id: 'f-1',
      refresh_token_hash: 'hash-1',
      previous_token_hash: null,
      device_name: 'iPhone 16',
      platform: 'ios',
      created_at: '2026-08-26T10:00:00.000Z',
      last_used_at: '2026-08-26T10:00:00.000Z',
      idle_expires_at: '2026-09-25T10:00:00.000Z',
      absolute_expires_at: '2026-11-24T10:00:00.000Z',
      rotated_at: null,
      revoked_at: null,
      replaced_by_id: null,
      profiles: {
        id: 'u-1',
        email: 'user@example.com',
        role: 'user',
        permission_role: 'user',
        hierarchy_role: 'user',
        is_active: true,
      },
    }

    mockFrom.mockReturnValue({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: fakeJoinedRow, error: null }),
        }),
      }),
    })

    const result = await mobileSessionStore.findSessionAndActorById('s-1')
    expect(result.session?.id).toBe('s-1')
    expect(result.actor).toEqual({
      id: 'u-1',
      email: 'user@example.com',
      role: 'user',
      permission_role: 'user',
      hierarchy_role: 'user',
      isActive: true,
    })
  })

  it('revokes session and all sessions for a user', async () => {
    mockFrom.mockReturnValue({
      update: () => ({
        eq: () => ({
          select: async () => ({ error: null }),
        }),
      }),
    })

    await expect(mobileSessionStore.revokeSession('s-1')).resolves.toBeUndefined()
    await expect(mobileSessionStore.revokeAll('u-1')).resolves.toBeUndefined()
  })

  it('cleans up expired session records', async () => {
    mockFrom.mockReturnValue({
      delete: () => ({
        or: () => ({
          select: async () => ({ data: [{ id: 's-1' }, { id: 's-2' }], error: null }),
        }),
        lte: () => ({
          select: async () => ({ data: [{ id: 's-1' }, { id: 's-2' }], error: null }),
        }),
      }),
    })

    const cleaned = await mobileSessionStore.cleanupExpired(new Date('2026-08-26T12:00:00.000Z'))
    expect(cleaned).toBe(2)
  })

  it('handles rotation status via rpc in supabase mode', async () => {
    mockRpc.mockResolvedValueOnce({
      data: [{ status: 'rotated', session_id: 's-2', user_id: 'u-1', family_id: 'f-1', refresh_token_hash: 'h-2', previous_token_hash: 'h-1', device_name: 'Dev', platform: 'windows', created_at: '2026-08-27T00:00:00Z', last_used_at: '2026-08-27T00:00:00Z', idle_expires_at: '2026-09-26T00:00:00Z', absolute_expires_at: '2026-11-25T00:00:00Z', rotated_at: null, revoked_at: null, replaced_by_id: null }],
      error: null,
    })

    const rotated = await mobileSessionStore.rotate({
      presentedTokenHash: 'h-1',
      replacementTokenHash: 'h-2',
    })
    expect(rotated.status).toBe('rotated')
    if (rotated.status === 'rotated') {
      expect(rotated.session.id).toBe('s-2')
    }

    mockRpc.mockResolvedValueOnce({
      data: [{ status: 'reused' }],
      error: null,
    })
    const reused = await mobileSessionStore.rotate({
      presentedTokenHash: 'old-hash',
      replacementTokenHash: 'new-hash',
    })
    expect(reused.status).toBe('reused')
  })
})
