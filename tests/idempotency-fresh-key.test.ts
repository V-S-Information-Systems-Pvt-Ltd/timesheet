import { beforeEach, describe, expect, it, vi } from 'vitest'
import { admitsFreshKey, cleanupExpiredFreshKeys, issueFreshKeys } from '@/lib/idempotency-fresh-key'

const state = vi.hoisted(() => ({
  native: true,
  gate: { state: 'open', fence_generation: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } as
    { state: string; fence_generation: string } | null,
  tickets: new Map<string, {
    key: string; actor_id: string; operation: string; fence_generation: string; expires_at: string
  }>(),
}))

vi.mock('@/lib/backend/config', () => ({
  get IS_NATIVE() { return state.native },
}))

vi.mock('@/lib/db/pool', () => ({
  query: vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes('from public.migration_write_gate where id')) return state.gate ? [state.gate] : []
    if (sql.includes('insert into public.migration_fresh_keys')) {
      for (let i = 0; i < params.length; i += 5) {
        const [key, actor_id, operation, fence_generation, expires_at] = params.slice(i, i + 5) as string[]
        state.tickets.set(key, { key, actor_id, operation, fence_generation, expires_at })
      }
      return []
    }
    if (sql.includes('from public.migration_fresh_keys ticket')) {
      const [key, actor, operation] = params as string[]
      const ticket = state.tickets.get(key)
      return ticket && ticket.actor_id === actor && ticket.operation === operation &&
        ticket.fence_generation === state.gate?.fence_generation && state.gate.state === 'open' &&
        Date.parse(ticket.expires_at) > Date.now() ? [{ admitted: true }] : []
    }
    if (sql.includes('delete from public.migration_fresh_keys')) {
      for (const [key, ticket] of state.tickets) {
        if (Date.parse(ticket.expires_at) <= Date.now()) state.tickets.delete(key)
      }
      return []
    }
    throw new Error(`Unexpected SQL: ${sql}`)
  }),
}))

vi.mock('@/lib/supabase/admin', () => ({
  getAdminClient: () => ({
    from: (table: string) => {
      const filters: Record<string, unknown> = {}
      return {
        delete: () => ({
          lte: async (_column: string, value: string) => {
            for (const [key, ticket] of state.tickets) {
              if (ticket.expires_at <= value) state.tickets.delete(key)
            }
            return { error: null }
          },
        }),
        insert: async (rows: Array<{
          key: string; actor_id: string; operation: string; fence_generation: string; expires_at: string
        }>) => {
          for (const row of rows) state.tickets.set(row.key, row)
          return { error: null }
        },
        select: () => ({
          eq(column: string, value: unknown) {
            filters[column] = value
            return this
          },
          async maybeSingle() {
            if (table === 'migration_write_gate') return { data: state.gate, error: null }
            const row = state.tickets.get(String(filters.key))
            return {
              data: row && row.actor_id === filters.actor_id && row.operation === filters.operation
                ? row : null,
              error: null,
            }
          },
        }),
      }
    },
  }),
}))

const ACTOR = '11111111-1111-4111-8111-111111111111'

describe.each([true, false])('server-minted fresh keys (native=%s)', (native) => {
  beforeEach(() => {
    state.native = native
    state.gate = { state: 'open', fence_generation: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }
    state.tickets.clear()
  })

  it('binds a new key to the actor, operation and live gate generation', async () => {
    const issued = await issueFreshKeys(ACTOR, 'create_reminder', 2)
    expect(issued).toHaveLength(2)
    expect(issued![0].key).not.toBe(issued![1].key)
    expect(await admitsFreshKey(issued![0].key, ACTOR, 'create_reminder')).toBe(true)
    expect(await admitsFreshKey(issued![0].key, '22222222-2222-4222-8222-222222222222', 'create_reminder')).toBe(false)
    expect(await admitsFreshKey(issued![0].key, ACTOR, 'create_leave')).toBe(false)
    expect(await admitsFreshKey('mf_not-server-issued', ACTOR, 'create_reminder')).toBe(false)
  })

  it('refuses stale, expired and fenced-generation keys', async () => {
    const issued = (await issueFreshKeys(ACTOR, 'create_leave', 1))![0]
    state.gate = { state: 'fenced', fence_generation: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }
    expect(await admitsFreshKey(issued.key, ACTOR, 'create_leave')).toBe(false)
    state.gate.state = 'open'
    expect(await admitsFreshKey(issued.key, ACTOR, 'create_leave')).toBe(false)
    state.gate.fence_generation = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    state.tickets.get(issued.key)!.expires_at = new Date(Date.now() - 1).toISOString()
    expect(await admitsFreshKey(issued.key, ACTOR, 'create_leave')).toBe(false)
  })

  it('cannot issue while fenced or without a gate', async () => {
    state.gate = { state: 'fenced', fence_generation: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }
    expect(await issueFreshKeys(ACTOR, 'create_reminder', 1)).toBeNull()
    state.gate = null
    expect(await issueFreshKeys(ACTOR, 'create_reminder', 1)).toBeNull()
    expect(state.tickets.size).toBe(0)
  })

  it('prunes expired tickets without deleting current ones', async () => {
    const issued = (await issueFreshKeys(ACTOR, 'create_reminder', 2))!
    state.tickets.get(issued[0].key)!.expires_at = new Date(Date.now() - 1).toISOString()
    await cleanupExpiredFreshKeys()
    expect(state.tickets.has(issued[0].key)).toBe(false)
    expect(state.tickets.has(issued[1].key)).toBe(true)
  })
})
