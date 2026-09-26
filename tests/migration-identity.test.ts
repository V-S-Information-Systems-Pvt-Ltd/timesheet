import { describe, expect, it, vi } from 'vitest'
import { cleanupRunIdentities, provisionIdentities } from '@/lib/migration/identity'
import type { AuthAdminPort } from '@/lib/migration/providers/supabase'
import type { WriteSession } from '@/lib/migration/providers/session'

const ID = '11111111-1111-4111-8111-111111111111'
const EMAIL = 'person@example.com'

function session(options: {
  authRows?: Array<{ id: string; email: string | null; migration_run_id: string | null }>
  journalRows?: Array<{ destination_id: string; action: string }>
  /** Accounts the run-marker sweep finds, i.e. untracked run creations. */
  markedRows?: Array<{ id: string }>
} = {}) {
  const writes: string[] = []
  const query = vi.fn(async (sql: string) => {
    // Order matters: the id lookup also reads the marker column.
    if (sql.includes('from auth.users where id')) return options.authRows ?? []
    if (sql.includes("raw_app_meta_data ->> 'vsis_migration_run_id' = $1 order by id")) {
      return options.markedRows ?? []
    }
    if (sql.includes('from auth.users where lower(email)')) return []
    if (sql.includes('from public.migration_runs')) return []
    if (sql.includes('from public.migration_identity_journal')) return options.journalRows ?? []
    throw new Error(`Unexpected query: ${sql}`)
  })
  const transaction = vi.fn(async (fn: (tx: { query: (sql: string) => Promise<unknown[]> }) => Promise<unknown>) =>
    fn({ query: async (sql) => { writes.push(sql); return [] } })
  )
  return { value: { provider: 'supabase', query, transaction } as unknown as WriteSession, writes }
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

  it('removes a created account even when its journal write failed', async () => {
    const db = session()
    db.value.query = vi.fn().mockResolvedValue([])
    db.value.transaction = vi.fn(async () => {
      throw new Error('journal write failed')
    })
    const deleteUser = vi.fn(async () => undefined)
    const provider = auth(vi.fn(async () => ({ id: ID, email: EMAIL, emailConfirmedAt: null })))
    provider.deleteUser = deleteUser

    await expect(
      provisionIdentities({ runId: 'run-1', provider: 'supabase', requests: [request], session: db.value, auth: provider })
    ).rejects.toThrow('journal entry could not be written')
    expect(deleteUser).toHaveBeenCalledWith(ID)
  })

  it('sweeps accounts that carry the run marker even without a journal row', async () => {
    const db = session({
      authRows: [{ id: ID, email: EMAIL, migration_run_id: 'run-1' }],
      markedRows: [{ id: ID }],
    })
    const provider = auth()

    const outcome = await cleanupRunIdentities({ runId: 'run-1', session: db.value, auth: provider })
    expect(outcome.deleted).toEqual([ID])
    expect(outcome.errors).toEqual([])
    expect(provider.deleteUser).toHaveBeenCalledWith(ID)
  })

  it('finishes cleanup when Auth was deleted but the journal row remained', async () => {
    const db = session({
      authRows: [],
      journalRows: [{ destination_id: ID, action: 'created' }],
    })
    const provider = auth()

    const outcome = await cleanupRunIdentities({ runId: 'run-1', session: db.value, auth: provider })
    expect(outcome.deleted).toEqual([ID])
    expect(outcome.errors).toEqual([])
    expect(provider.deleteUser).not.toHaveBeenCalled()
    expect(db.writes.some((sql) => sql.includes('delete from public.migration_identity_journal'))).toBe(true)
  })

  it('can sweep an unjournaled creation after immediate deletion failed', async () => {
    const createDb = session()
    createDb.value.query = vi.fn().mockResolvedValue([])
    createDb.value.transaction = vi.fn(async () => {
      throw new Error('journal write failed')
    })
    const provider = auth(vi.fn(async () => ({ id: ID, email: EMAIL, emailConfirmedAt: null })))
    provider.deleteUser = vi.fn(async () => {
      throw new Error('provider temporarily unavailable')
    })

    await expect(
      provisionIdentities({ runId: 'run-1', provider: 'supabase', requests: [request], session: createDb.value, auth: provider })
    ).rejects.toThrow('account could not be removed')

    const cleanupDb = session({
      authRows: [{ id: ID, email: EMAIL, migration_run_id: 'run-1' }],
      markedRows: [{ id: ID }],
    })
    provider.deleteUser = vi.fn(async () => undefined)
    const outcome = await cleanupRunIdentities({ runId: 'run-1', session: cleanupDb.value, auth: provider })

    expect(outcome.deleted).toEqual([ID])
    expect(outcome.errors).toEqual([])
    expect(provider.deleteUser).toHaveBeenCalledWith(ID)
  })

  it('reports marker-only cleanup work when Auth Admin credentials are unavailable', async () => {
    const db = session({ markedRows: [{ id: ID }] })

    const outcome = await cleanupRunIdentities({ runId: 'run-1', session: db.value, auth: null })

    expect(outcome.deleted).toEqual([])
    expect(outcome.errors).toContain('Auth Admin credentials are required to clean up run-created identities.')
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
