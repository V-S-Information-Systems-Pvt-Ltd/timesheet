// tests/error-hygiene.test.ts
// Tests for CP10 error hygiene, secret validation, and swallow-site logging.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SignJWT } from 'jose'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ getAdminClient: vi.fn() }))
import { createClient } from '@/lib/supabase/server'
import { getAdminClient } from '@/lib/supabase/admin'
import { supabaseRepository } from '@/lib/db/supabase'
import { logger } from '@/lib/logger'
import { signSessionToken, verifySessionToken } from '@/lib/auth/jwt'
import type { Actor } from '@/lib/db/repository'

const mockCreateClient = vi.mocked(createClient)
const mockGetAdminClient = vi.mocked(getAdminClient)

const admin: Actor = {
  id: 'admin-1',
  email: 'admin@vsis.lk',
  role: 'admin',
  permission_role: 'admin',
  hierarchy_role: 'user',
  isActive: true,
}

const leader: Actor = {
  id: 'lead-1',
  email: 'lead@vsis.lk',
  role: 'team_lead',
  permission_role: 'user',
  hierarchy_role: 'team_lead',
  isActive: true,
}

describe('CP10 writeError hygiene and error logging', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('maps unknown PostgREST write errors to a generic message and logs with logger.error', async () => {
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {})
    const mockBuilder: Record<string, unknown> = {
      insert: vi.fn().mockReturnThis(),
      then: (fn: (v: unknown) => unknown) =>
        Promise.resolve({ error: { message: 'pg_toast table corrupt: block 402', code: 'XX000' } }).then(fn),
    }
    const clientMock = { from: vi.fn(() => mockBuilder) }
    mockCreateClient.mockResolvedValue(clientMock as never)
    mockGetAdminClient.mockReturnValue(clientMock as never)

    const result = await supabaseRepository.createProject(admin, 'Corrupt Project')
    expect(result.error).toBe('Something went wrong. Please try again.')
    expect(errorSpy).toHaveBeenCalledWith(
      'Supabase write error',
      expect.objectContaining({
        error: 'pg_toast table corrupt: block 402',
        code: 'XX000',
      })
    )
    errorSpy.mockRestore()
  })

  it('returns friendly message for 23505 duplicate key errors', async () => {
    const mockBuilder: Record<string, unknown> = {
      insert: vi.fn().mockReturnThis(),
      then: (fn: (v: unknown) => unknown) =>
        Promise.resolve({ error: { message: 'duplicate key violates unique constraint', code: '23505' } }).then(fn),
    }
    const clientMock = { from: vi.fn(() => mockBuilder) }
    mockCreateClient.mockResolvedValue(clientMock as never)
    mockGetAdminClient.mockReturnValue(clientMock as never)

    const result = await supabaseRepository.createProject(admin, 'Existing Project')
    expect(result.error).toBe('A record with that value already exists.')
  })

  it('returns friendly message for 23503 foreign key reference errors', async () => {
    const mockBuilder: Record<string, unknown> = {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      then: (fn: (v: unknown) => unknown) =>
        Promise.resolve({ error: { message: 'violates foreign key constraint', code: '23503' } }).then(fn),
    }
    const clientMock = { from: vi.fn(() => mockBuilder) }
    mockCreateClient.mockResolvedValue(clientMock as never)
    mockGetAdminClient.mockReturnValue(clientMock as never)

    const result = await supabaseRepository.updateUserManager(admin, 'user-1', 'nonexistent-manager')
    expect(result.error).toBe('This record is referenced by other data and cannot be changed.')
  })
})

describe('CP10 getSubordinateIds error propagation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('propagates an error and logs via logger.error when team_ids RPC fails', async () => {
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {})
    const clientMock = {
      rpc: vi.fn().mockResolvedValue({ data: null, error: { message: 'function team_ids does not exist' } }),
      from: vi.fn(),
    }
    mockCreateClient.mockResolvedValue(clientMock as never)
    mockGetAdminClient.mockReturnValue(clientMock as never)

    await expect(supabaseRepository.listProfiles(leader)).rejects.toThrow(
      'Subordinate lookup failed: function team_ids does not exist'
    )
    expect(errorSpy).toHaveBeenCalledWith(
      'Failed to lookup subordinate IDs',
      expect.objectContaining({ leaderId: 'lead-1', error: 'function team_ids does not exist' })
    )
    errorSpy.mockRestore()
  })
})

describe('CP10 AUTH_SECRET minimum length and HS256 algorithm pinning', () => {
  const originalSecret = process.env.AUTH_SECRET

  beforeEach(() => {
    process.env.AUTH_SECRET = 'a'.repeat(32)
  })

  afterEach(() => {
    if (originalSecret !== undefined) process.env.AUTH_SECRET = originalSecret
    else delete process.env.AUTH_SECRET
  })

  it('rejects signing when AUTH_SECRET is less than 32 characters', async () => {
    process.env.AUTH_SECRET = 'short-key-16-bytes!'
    await expect(signSessionToken({ id: 'u1', email: 'test@vsis.lk' })).rejects.toThrow(
      'AUTH_SECRET must be configured with at least 32 characters.'
    )
  })

  it('rejects verification when AUTH_SECRET is less than 32 characters', async () => {
    process.env.AUTH_SECRET = 'short-key-16-bytes!'
    const result = await verifySessionToken('dummy.token.payload')
    expect(result).toBeNull()
  })

  it('successfully signs and verifies with a valid 32+ character secret', async () => {
    process.env.AUTH_SECRET = 'valid-secret-key-that-is-at-least-32-chars-long!'
    const token = await signSessionToken({ id: 'u1', email: 'test@vsis.lk' }, 2)
    const verified = await verifySessionToken(token)
    expect(verified).not.toBeNull()
    expect(verified?.user.id).toBe('u1')
    expect(verified?.user.email).toBe('test@vsis.lk')
    expect(verified?.sessionVersion).toBe(2)
  })

  it('rejects tokens signed with an unapproved algorithm even if signed with the same key', async () => {
    process.env.AUTH_SECRET = 'valid-secret-key-that-is-at-least-32-chars-long!'
    const key = new TextEncoder().encode(process.env.AUTH_SECRET)

    // Sign with HS384 instead of pinned HS256
    const nonHs256Token = await new SignJWT({ email: 'test@vsis.lk', sv: 1 })
      .setProtectedHeader({ alg: 'HS384' })
      .setSubject('u1')
      .setIssuedAt()
      .setExpirationTime('7d')
      .sign(key)

    const result = await verifySessionToken(nonHs256Token)
    expect(result).toBeNull()
  })
})

describe('CP10 getGroupedReportTotals pagination (no silent truncation)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('pages through timesheets when count exceeds single page limit', async () => {
    const adminClient = {
      from: vi.fn(),
      rpc: vi.fn(),
    }
    mockGetAdminClient.mockReturnValue(adminClient as never)

    // Spy on listTimesheets to return 1000 rows on page 1 and 200 rows on page 2
    const page1Rows = Array.from({ length: 1000 }, (_, i) => ({
      id: `ts-${i}`,
      user_id: 'user-1',
      project_id: 'p1',
      activity_type_id: null,
      hours_worked: 1,
      work_done: 'work',
      log_date: '2026-09-01',
      projects: { name: 'Project Alpha' },
      profiles: { email: 'user@vsis.lk' },
      activity_types: null,
    }))

    const page2Rows = Array.from({ length: 200 }, (_, i) => ({
      id: `ts-${1000 + i}`,
      user_id: 'user-1',
      project_id: 'p1',
      activity_type_id: null,
      hours_worked: 1,
      work_done: 'work',
      log_date: '2026-09-02',
      projects: { name: 'Project Alpha' },
      profiles: { email: 'user@vsis.lk' },
      activity_types: null,
    }))

    let callCount = 0
    const listSpy = vi.spyOn(supabaseRepository, 'listTimesheets').mockImplementation(async () => {
      callCount++
      if (callCount === 1) return { rows: page1Rows as never, count: 1200 }
      return { rows: page2Rows as never, count: 1200 }
    })

    const buckets = await supabaseRepository.getGroupedReportTotals(
      leader,
      { userId: 'user-1' },
      'project'
    )

    expect(listSpy).toHaveBeenCalledTimes(2)
    expect(buckets).toHaveLength(1)
    expect(buckets[0].label).toBe('Project Alpha')
    expect(buckets[0].hours).toBe(1200)
    expect(buckets[0].entries).toBe(1200)

    listSpy.mockRestore()
  })
})
