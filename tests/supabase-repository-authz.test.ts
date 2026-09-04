// tests/supabase-repository-authz.test.ts
// Authorization-parity coverage for the Supabase adapter's leave and reminder
// mutations. The native adapter is the authority (see lib/db/native.ts); these
// tests prove the Supabase adapter scopes every operation to the actor the
// same way, so a caller-supplied user id can never address another user's rows.
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ getAdminClient: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { getAdminClient } from '@/lib/supabase/admin'
import { supabaseRepository } from '@/lib/db/supabase'
import type { Actor } from '@/lib/db/repository'

const mockCreateClient = vi.mocked(createClient)
const mockGetAdminClient = vi.mocked(getAdminClient)

const admin: Actor = {
  id: 'admin-1',
  email: 'admin@x.com',
  role: 'admin',
  permission_role: 'admin',
  hierarchy_role: 'user',
  isActive: true,
}
const user: Actor = {
  id: 'user-1',
  email: 'user@x.com',
  role: 'user',
  permission_role: 'user',
  hierarchy_role: 'user',
  isActive: true,
}

const pm: Actor = {
  id: 'pm-1',
  email: 'pm@x.com',
  role: 'pm',
  permission_role: 'pm',
  hierarchy_role: 'user',
  isActive: true,
}
const leader: Actor = {
  id: 'lead-1',
  email: 'lead@x.com',
  role: 'team_lead',
  permission_role: 'user',
  hierarchy_role: 'team_lead',
  isActive: true,
}
const inactiveUser: Actor = {
  id: 'inactive-1',
  email: 'inactive@x.com',
  role: 'user',
  permission_role: 'user',
  hierarchy_role: 'user',
  isActive: false,
}

interface MockClient {
  client: { from: ReturnType<typeof vi.fn>; rpc: ReturnType<typeof vi.fn> }
  /** payloads passed to terminal .insert() calls */
  inserts: unknown[]
  /** terminal .update() patches */
  updates: unknown[]
  /** terminal .delete() count */
  deleteCount: () => number
  /** terminal .select() column args */
  selects: unknown[]
  /** (column, value) filter pairs in chain order */
  filters: Array<[string, unknown]>
}

/**
 * Build a thenable PostgREST query-builder mock. Every builder step returns
 * the same thenable object; the terminal action (insert/delete/update/select)
 * selected during the chain is what the awaited builder resolves to. This
 * mirrors supabase-js, where filter methods return a new builder and the whole
 * chain is only executed when awaited.
 */
function mockServerClient(overrides: {
  insertResult?: unknown
  deleteResult?: unknown
  selectResult?: unknown
  updateResult?: unknown
  count?: number
  rpcResult?: unknown
} = {}): MockClient {
  const inserts: unknown[] = []
  const updates: unknown[] = []
  const selects: unknown[] = []
  const filters: Array<[string, unknown]> = []
  let deletes = 0

  const terminal = {
    insert: overrides.insertResult ?? { data: null, error: null },
    delete: overrides.deleteResult ?? { error: null },
    update: overrides.updateResult ?? { error: null },
    select: overrides.selectResult ?? { data: [], count: overrides.count ?? 0, error: null },
  }
  // The terminal action is chosen by whichever of insert/delete/update/select
  // was invoked last in the chain before await.
  let lastAction: keyof typeof terminal = 'select'

  const builder: Record<string, unknown> = {
    then(onFulfilled: (value: unknown) => unknown) {
      return Promise.resolve(terminal[lastAction]).then(onFulfilled)
    },
    insert(payload: unknown) {
      inserts.push(payload)
      lastAction = 'insert'
      return builder
    },
    delete() {
      deletes++
      lastAction = 'delete'
      return builder
    },
    update(patch: unknown) {
      updates.push(patch)
      lastAction = 'update'
      return builder
    },
    select(cols: unknown, opts?: unknown) {
      selects.push({ cols, opts })
      lastAction = 'select'
      return builder
    },
    eq(col: string, val: unknown) {
      filters.push([col, val])
      return builder
    },
    neq(col: string, val: unknown) {
      filters.push([`!${col}`, val])
      return builder
    },
    in(col: string, vals: unknown[]) {
      filters.push([col, vals])
      return builder
    },
    order() {
      return builder
    },
    limit() {
      return builder
    },
    maybeSingle() {
      return Promise.resolve(terminal[lastAction])
    },
  }

  const client = {
    from: vi.fn(() => builder),
    rpc: vi.fn(() => Promise.resolve(overrides.rpcResult ?? { data: [], error: null })),
  }
  mockCreateClient.mockResolvedValue(client as never)
  mockGetAdminClient.mockReturnValue(client as never)
  return { client, inserts, updates, deleteCount: () => deletes, selects, filters }
}

function filterPairs(f: MockClient, column: string): unknown[] {
  return f.filters.filter(([c]) => c === column).map(([, v]) => v)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('supabase createLeaves authz (native parity)', () => {
  it('allows a regular user to mark their own leave', async () => {
    const m = mockServerClient()
    const result = await supabaseRepository.createLeaves(user, [
      { userId: 'user-1', leaveDate: '2026-09-10', reason: 'Sick' },
    ])
    expect(result.error).toBeNull()
    expect(m.inserts).toHaveLength(1)
    expect(m.inserts[0]).toEqual([{ user_id: 'user-1', leave_date: '2026-09-10', reason: 'Sick' }])
  })

  it('rejects a cross-user leave request from a regular user before any write', async () => {
    const m = mockServerClient()
    const result = await supabaseRepository.createLeaves(user, [
      { userId: 'someone-else', leaveDate: '2026-09-10', reason: 'Sick' },
    ])
    expect(result.error).toBe('You can only mark leave for yourself.')
    expect(m.client.from).not.toHaveBeenCalled()
  })

  it('preserves documented admin leave behavior for other users', async () => {
    const m = mockServerClient()
    const result = await supabaseRepository.createLeaves(admin, [
      { userId: 'someone-else', leaveDate: '2026-09-10', reason: 'Admin mark' },
    ])
    expect(result.error).toBeNull()
    expect(m.inserts[0]).toEqual([{ user_id: 'someone-else', leave_date: '2026-09-10', reason: 'Admin mark' }])
  })
})

describe('supabase deleteLeave authz (native parity)', () => {
  it('scopes a regular user delete to their own rows', async () => {
    const m = mockServerClient({ deleteResult: { error: null } })
    await supabaseRepository.deleteLeave(user, 'leave-1')
    expect(m.deleteCount()).toBe(1)
    expect(filterPairs(m, 'user_id')).toEqual(['user-1'])
    expect(filterPairs(m, 'id')).toEqual(['leave-1'])
  })

  it('lets an admin delete any row without a user scope', async () => {
    const m = mockServerClient({ deleteResult: { error: null } })
    await supabaseRepository.deleteLeave(admin, 'leave-1')
    expect(m.deleteCount()).toBe(1)
    expect(filterPairs(m, 'user_id')).toHaveLength(0)
    expect(filterPairs(m, 'id')).toEqual(['leave-1'])
  })
})

describe('supabase reminder authz (native parity, own-only)', () => {
  it('lists only the actor\'s reminders regardless of the supplied userId', async () => {
    const m = mockServerClient({ selectResult: { data: [{ id: 'r1', user_id: 'user-1' }], error: null } })
    const rows = await supabaseRepository.listReminders(user, 'someone-else')
    expect(rows).toHaveLength(1)
    expect(filterPairs(m, 'user_id')).toEqual(['user-1'])
  })

  it('forces a regular user reminder to their own user id', async () => {
    const m = mockServerClient()
    const result = await supabaseRepository.createReminder(user, {
      userId: 'someone-else',
      message: 'hello',
      remindAt: '2026-09-10T09:00:00Z',
    })
    expect(result.error).toBeNull()
    expect(m.inserts[0]).toEqual({ user_id: 'user-1', message: 'hello', remind_at: '2026-09-10T09:00:00Z' })
  })

  it('allows an admin to create a reminder for another user', async () => {
    const m = mockServerClient()
    const result = await supabaseRepository.createReminder(admin, {
      userId: 'someone-else',
      message: 'hello',
      remindAt: '2026-09-10T09:00:00Z',
    })
    expect(result.error).toBeNull()
    expect(m.inserts[0]).toEqual({ user_id: 'someone-else', message: 'hello', remind_at: '2026-09-10T09:00:00Z' })
  })

  it('scopes reminder updates to the actor', async () => {
    const m = mockServerClient({ updateResult: { error: null } })
    const result = await supabaseRepository.updateReminder(user, 'r1', { done: true })
    expect(result.error).toBeNull()
    expect(m.updates).toHaveLength(1)
    expect(m.updates[0]).toEqual({ done: true })
    expect(filterPairs(m, 'id')).toEqual(['r1'])
    expect(filterPairs(m, 'user_id')).toEqual(['user-1'])
  })

  it('scopes reminder deletion to the actor', async () => {
    const m = mockServerClient({ deleteResult: { error: null } })
    const result = await supabaseRepository.deleteReminder(user, 'r1')
    expect(result.error).toBeNull()
    expect(m.deleteCount()).toBe(1)
    expect(filterPairs(m, 'id')).toEqual(['r1'])
    expect(filterPairs(m, 'user_id')).toEqual(['user-1'])
  })
})

describe('supabase listProfiles authz (native parity)', () => {
  it('returns empty array for regular user without database read', async () => {
    const m = mockServerClient()
    const profiles = await supabaseRepository.listProfiles(user)
    expect(profiles).toEqual([])
    expect(m.client.from).not.toHaveBeenCalled()
  })

  it('returns subordinates and self for leader actor', async () => {
    const m = mockServerClient({
      rpcResult: { data: [{ subordinate_id: 'sub-1' }], error: null },
      selectResult: {
        data: [
          { id: 'lead-1', email: 'lead@x.com', is_active: true },
          { id: 'sub-1', email: 'sub@x.com', is_active: true },
        ],
        error: null,
      },
    })
    const profiles = await supabaseRepository.listProfiles(leader)
    expect(profiles).toHaveLength(2)
    expect(filterPairs(m, 'id')).toEqual([['lead-1', 'sub-1']])
  })

  it('returns all profiles for admin actor', async () => {
    const m = mockServerClient({
      selectResult: {
        data: [{ id: 'admin-1', email: 'admin@x.com', is_active: true }],
        error: null,
      },
    })
    const profiles = await supabaseRepository.listProfiles(admin)
    expect(profiles).toHaveLength(1)
    expect(filterPairs(m, 'id')).toHaveLength(0)
  })
})

describe('supabase timesheets authz (native parity)', () => {
  const tsInput = {
    userId: 'user-1',
    projectId: 'p1',
    activityTypeId: 'a1',
    hoursWorked: 4,
    workDone: 'worked on feature',
    logDate: '2026-09-01',
  }

  it('rejects cross-user createTimesheet by regular user', async () => {
    const m = mockServerClient()
    const res = await supabaseRepository.createTimesheet(user, { ...tsInput, userId: 'other-user' })
    expect(res.error).toBe('You can only log your own entries.')
    expect(m.client.from).not.toHaveBeenCalled()
  })

  it('rejects createTimesheet if actor is inactive', async () => {
    const m = mockServerClient()
    const res = await supabaseRepository.createTimesheet(inactiveUser, { ...tsInput, userId: 'inactive-1' })
    expect(res.error).toBe('Your account is not active.')
    expect(m.client.from).not.toHaveBeenCalled()
  })

  it('allows own createTimesheet for regular active user', async () => {
    const m = mockServerClient({ insertResult: { error: null } })
    const res = await supabaseRepository.createTimesheet(user, tsInput)
    expect(res.error).toBeNull()
    expect(m.inserts).toHaveLength(1)
  })

  it('scopes updateTimesheet to actor.id for non-admin', async () => {
    const m = mockServerClient({ updateResult: { error: null } })
    const res = await supabaseRepository.updateTimesheet(user, 'ts-1', tsInput)
    expect(res.error).toBeNull()
    expect(filterPairs(m, 'id')).toEqual(['ts-1'])
    expect(filterPairs(m, 'user_id')).toEqual(['user-1'])
  })

  it('does not scope updateTimesheet to user_id for admin', async () => {
    const m = mockServerClient({ updateResult: { error: null } })
    const res = await supabaseRepository.updateTimesheet(admin, 'ts-1', tsInput)
    expect(res.error).toBeNull()
    expect(filterPairs(m, 'id')).toEqual(['ts-1'])
    expect(filterPairs(m, 'user_id')).toHaveLength(0)
  })

  it('scopes deleteTimesheet to actor.id for non-admin', async () => {
    const m = mockServerClient({ deleteResult: { error: null } })
    const res = await supabaseRepository.deleteTimesheet(user, 'ts-1')
    expect(res.error).toBeNull()
    expect(filterPairs(m, 'id')).toEqual(['ts-1'])
    expect(filterPairs(m, 'user_id')).toEqual(['user-1'])
  })

  it('returns 0 for countTimesheetsByProject when actor is regular user', async () => {
    const m = mockServerClient()
    const count = await supabaseRepository.countTimesheetsByProject(user, 'p1')
    expect(count).toBe(0)
    expect(m.client.from).not.toHaveBeenCalled()
  })

  it('queries countTimesheetsByProject when actor is pm or admin', async () => {
    const m = mockServerClient({ count: 5 })
    const count = await supabaseRepository.countTimesheetsByProject(pm, 'p1')
    expect(count).toBe(5)
    expect(filterPairs(m, 'project_id')).toEqual(['p1'])
  })

  it('returns 0 for sumHoursForUserDate when actor is regular user querying another user', async () => {
    const m = mockServerClient()
    const sum = await supabaseRepository.sumHoursForUserDate(user, 'other-user', '2026-09-01')
    expect(sum).toBe(0)
    expect(m.client.from).not.toHaveBeenCalled()
  })
})

describe('supabase admin-only mutation gates (native parity)', () => {
  it('denies createProject for regular user', async () => {
    const res = await supabaseRepository.createProject(user, 'New Project')
    expect(res.error).toBe('You do not have permission to perform this action.')
  })

  it('denies setBackfillWindow for regular user', async () => {
    const res = await supabaseRepository.setBackfillWindow(user, { mode: 'days', windowDays: 7, extraDays: 0 })
    expect(res.error).toBe('You do not have permission to perform this action.')
  })

  it('denies deleteUser for regular user', async () => {
    const res = await supabaseRepository.deleteUser(user, 'some-user')
    expect(res.error).toBe('You do not have permission to perform this action.')
  })

  it('denies addWhitelistedDomain for regular user', async () => {
    const res = await supabaseRepository.addWhitelistedDomain(user, 'vsis.lk', true)
    expect(res.error).toBe('You do not have permission to manage email domains.')
  })

  it('denies updateUserHierarchy for regular user', async () => {
    const res = await supabaseRepository.updateUserHierarchy(user, 'some-user', { managerId: null })
    expect(res.error).toBe('You do not have permission to update hierarchy.')
  })

  it('denies addTitle for regular user', async () => {
    const res = await supabaseRepository.addTitle(user, 'Engineer', 'user')
    expect(res.error).toBe('You do not have permission to manage titles.')
  })
})
