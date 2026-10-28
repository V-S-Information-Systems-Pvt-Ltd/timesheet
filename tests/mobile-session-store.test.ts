import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockQuery, mockTransaction } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockTransaction: vi.fn(),
}))

vi.mock('@/lib/db/pool', () => ({
  query: mockQuery,
  transaction: mockTransaction,
}))

import { mobileSessionStore } from '@/lib/auth/mobile-session-store'

const sessionRow = {
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

describe('mobileSessionStore (native)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates a session with computed expiry', async () => {
    mockQuery.mockResolvedValueOnce([sessionRow])

    const created = await mobileSessionStore.create({
      userId: 'u-1',
      refreshTokenHash: 'hash-1',
      deviceName: 'Pixel 9',
      platform: 'android',
    })

    expect(created?.id).toBe('s-1')
    expect(created?.userId).toBe('u-1')
    expect(created?.familyId).toBe('f-1')
    expect(mockQuery.mock.calls[0][0]).toContain('insert into public.mobile_sessions')
  })

  it('creates a version-checked session only while the session version is current', async () => {
    mockQuery.mockResolvedValueOnce([sessionRow])
    const created = await mobileSessionStore.create({ userId: 'u-1', refreshTokenHash: 'hash-1', expectedSessionVersion: 2 })
    expect(created?.id).toBe('s-1')
    const [sql, params] = mockQuery.mock.calls[0]
    expect(sql).toContain('session_version = $11')
    expect(sql).toContain('for share')
    expect(params[10]).toBe(2)

    // A reset bumped the version: no row is inserted and nothing is returned.
    mockQuery.mockResolvedValueOnce([])
    expect(await mobileSessionStore.create({ userId: 'u-1', refreshTokenHash: 'hash-2', expectedSessionVersion: 2 })).toBeNull()
  })

  it('finds session by token hash and id', async () => {
    mockQuery.mockResolvedValue([sessionRow])
    expect((await mobileSessionStore.findByHash('hash-1'))?.id).toBe('s-1')
    expect((await mobileSessionStore.findById('s-1'))?.id).toBe('s-1')

    mockQuery.mockResolvedValue([])
    expect(await mobileSessionStore.findById('none')).toBeNull()
  })

  it('finds session and actor in a single combined lookup', async () => {
    mockQuery.mockResolvedValueOnce([
      {
        ...sessionRow,
        profile_id: 'u-1',
        email: 'user@example.com',
        role: 'user',
        permission_role: 'user',
        hierarchy_role: 'user',
        is_active: true,
        scope_departments: ['Engineering'],
      },
    ])

    const result = await mobileSessionStore.findSessionAndActorById('s-1')
    expect(result.session?.id).toBe('s-1')
    expect(result.actor).toEqual({
      id: 'u-1',
      email: 'user@example.com',
      role: 'user',
      permission_role: 'user',
      hierarchy_role: 'user',
      scope_departments: ['Engineering'],
      isActive: true,
    })
    expect(mockQuery).toHaveBeenCalledTimes(1)
  })

  it('returns no actor when the profile row is gone', async () => {
    mockQuery.mockResolvedValueOnce([{ ...sessionRow, profile_id: null, email: null }])
    const result = await mobileSessionStore.findSessionAndActorById('s-1')
    expect(result.session?.id).toBe('s-1')
    expect(result.actor).toBeNull()
  })

  it('revokes session and all sessions for a user', async () => {
    mockQuery.mockResolvedValue([])
    await expect(mobileSessionStore.revokeSession('s-1')).resolves.toBeUndefined()
    await expect(mobileSessionStore.revokeAll('u-1')).resolves.toBeUndefined()
    expect(mockQuery.mock.calls[0][1]).toEqual(['s-1'])
    expect(mockQuery.mock.calls[1][1]).toEqual(['u-1'])
  })

  it('revokes other sessions while preserving the caller session', async () => {
    mockQuery.mockResolvedValueOnce([])
    await expect(mobileSessionStore.revokeOtherSessions('u-1', 's-1')).resolves.toBe('revoked')
    expect(mockQuery.mock.calls[0][1]).toEqual(['u-1', 's-1'])
  })

  it('begins the password-change revocation by revoking every session; completion is a no-op', async () => {
    mockQuery.mockResolvedValue([])
    await expect(mobileSessionStore.beginPasswordChange('u-1')).resolves.toBeUndefined()
    expect(mockQuery.mock.calls[0][1]).toEqual(['u-1'])
    await expect(mobileSessionStore.completePasswordChange('u-1', null)).resolves.toBeUndefined()
    expect(mockQuery).toHaveBeenCalledTimes(1)
  })

  it('cleans up expired session records', async () => {
    mockQuery.mockResolvedValueOnce([{ id: 's-1' }, { id: 's-2' }])
    const cleaned = await mobileSessionStore.cleanupExpired(new Date('2026-08-26T12:00:00.000Z'))
    expect(cleaned).toBe(2)
  })
})
