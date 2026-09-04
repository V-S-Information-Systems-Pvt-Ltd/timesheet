// tests/supabase-repository-authz.test.ts
// Authorization-parity coverage for the Supabase adapter's leave and reminder
// mutations. The native adapter is the authority (see lib/db/native.ts); these
// tests prove the Supabase adapter scopes every operation to the actor the
// same way, so a caller-supplied user id can never address another user's rows.
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ getAdminClient: vi.fn() }))

import { getAdminClient } from '@/lib/supabase/admin'
import { supabaseRepository } from '@/lib/db/supabase'
import type { Actor } from '@/lib/db/repository'

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

interface MockClient {
  client: { from: ReturnType<typeof vi.fn> }
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
    select: overrides.selectResult ?? { data: [], error: null },
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
    select(cols: unknown) {
      selects.push(cols)
      lastAction = 'select'
      return builder
    },
    eq(col: string, val: unknown) {
      filters.push([col, val])
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
  }

  const client = { from: vi.fn(() => builder) }
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
