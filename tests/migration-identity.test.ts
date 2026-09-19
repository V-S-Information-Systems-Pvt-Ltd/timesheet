import { describe, expect, it, vi } from 'vitest'
import { cleanupRunIdentities, provisionIdentities } from '@/lib/migration/identity'
import type { AuthAdminPort } from '@/lib/migration/providers/supabase'
import type { WriteSession } from '@/lib/migration/providers/session'

const ID = '11111111-1111-4111-8111-111111111111'
const EMAIL = 'person@example.com'

function session(options: {
  authRows?: Array<{ id: string; email: string | null; migration_run_id: string | null }>
  journalRows?: Array<{ destination_id: string; action: string }>
} = {}) {
  const writes: string[] = []
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('from auth.users where id')) return options.authRows ?? []
    if (sql.includes('from auth.users where lower(email)')) return []
    if (sql.includes('from public.migration_runs')) return []
    if (sql.includes('from public.migration_identity_journal')) return options.journalRows ?? []
    throw new Error(`Unexpected query: ${sql}`)
  })
  const transaction = vi.fn(async (fn: (tx: { query: (sql: string) => Promise<unknown[]> }) => Promise<unknown>) =>
    fn({ query: async (sql) => { writes.push(sql); return [] } })
  )
  return { value: { query, transaction } as unknown as WriteSession, writes }
}

function auth(createUser = vi.fn<AuthAdminPort['createUser']>()): AuthAdminPort {
  return {
    listUsers: vi.fn(async () => []),
    findUserByEmail: vi.fn(async () => null),
    createUser,
    deleteUser: vi.fn(async () => undefined),
  }
}

const request = { id: ID, email: EMAIL, name: 'Person', sourceEmailConfirmed: null }

describe('migration Auth ownership recovery', () => {
  it('does not claim a same-id account after an uncertain create response without the run marker', async () => {
    const db = session({ authRows: [{ id: ID, email: EMAIL, migration_run_id: null }] })
    const provider = auth(vi.fn(async () => { throw new Error('response lost') }))
    // First lookup is absent; the retry lookup finds an account whose owner is unknown.
    db.value.query = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: ID, email: EMAIL, migration_run_id: null }])

    await expect(provisionIdentities({ runId: 'run-1', provider: 'supabase', requests: [request], session: db.value, auth: provider }))
      .rejects.toThrow('response lost')
    expect(db.writes).toEqual([])
  })

  it('reconciles a lost response only when Auth carries the matching run marker', async () => {
    const db = session()
    db.value.query = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: ID, email: EMAIL, migration_run_id: 'run-1' }])
    const provider = auth(vi.fn(async () => { throw new Error('response lost') }))

    const outcome = await provisionIdentities({ runId: 'run-1', provider: 'supabase', requests: [request], session: db.value, auth: provider })
    expect(outcome[0]?.action).toBe('created')
    expect(db.writes.some((sql) => sql.includes('insert into public.migration_identity_journal'))).toBe(true)
  })

  it('refuses cleanup of a journaled account whose Auth marker belongs elsewhere', async () => {
    const db = session({
      authRows: [{ id: ID, email: EMAIL, migration_run_id: null }],
      journalRows: [{ destination_id: ID, action: 'created' }],
    })
    const provider = auth()

    const outcome = await cleanupRunIdentities({ runId: 'run-1', session: db.value, auth: provider })
    expect(outcome.deleted).toEqual([])
    expect(outcome.errors).toHaveLength(1)
    expect(provider.deleteUser).not.toHaveBeenCalled()
  })

  it('refuses cleanup whenever the run has a durable import receipt', async () => {
    const db = session({ journalRows: [{ destination_id: ID, action: 'created' }] })
    db.value.query = vi.fn(async (sql: string) => {
      if (sql.includes('from public.migration_runs')) return [{ run_id: 'run-1' }]
      throw new Error('Cleanup must stop before reading identities')
    }) as unknown as WriteSession['query']
    const provider = auth()

    const outcome = await cleanupRunIdentities({ runId: 'run-1', session: db.value, auth: provider })
    expect(outcome.deleted).toEqual([])
    expect(outcome.errors).toContain('A durable import receipt exists; identity cleanup after app-data commit is forbidden.')
    expect(provider.deleteUser).not.toHaveBeenCalled()
  })
})
