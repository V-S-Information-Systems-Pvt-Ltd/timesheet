import { beforeEach, describe, expect, it, vi } from 'vitest'

const { ClientMock, clientState } = vi.hoisted(() => {
  const state: { client: unknown } = { client: null }
  const client = vi.fn(function MockClient() {
    return state.client
  })
  return { ClientMock: client, clientState: state }
})

vi.mock('pg', () => ({ Client: ClientMock }))

import { openReadOnlySession } from '@vsis/migration-tool/providers/session'

function sourceTarget() {
  return {
    provider: 'native' as const,
    role: 'source' as const,
    envName: 'MIGRATION_TEST',
    connectionString: 'postgres://localhost/test',
    displayTarget: 'localhost:5432/test',
    loopback: true,
    projectRef: null,
    applicationName: 'migration-session-test',
  }
}

function installClient(query: (text: string) => Promise<{ rows: unknown[] }>) {
  const client = {
    connect: vi.fn().mockResolvedValue(undefined),
    query: vi.fn(query),
    end: vi.fn().mockResolvedValue(undefined),
  }
  clientState.client = client
  return client
}

describe('read-only transaction cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps the callback error when rollback also fails', async () => {
    const callbackError = new Error('export interrupted')
    const rollbackError = new Error('connection already closed')
    const client = installClient(async (text) => {
      if (text === 'rollback') throw rollbackError
      return { rows: [] }
    })
    const session = openReadOnlySession(sourceTarget())

    await expect(
      session.withReadOnlyTransaction(async () => {
        throw callbackError
      })
    ).rejects.toBe(callbackError)
    expect(client.query.mock.calls.some(([text]) => text === 'rollback')).toBe(true)
  })

  it('surfaces a rollback error when the callback succeeds', async () => {
    const rollbackError = new Error('rollback failed')
    installClient(async (text) => {
      if (text === 'rollback') throw rollbackError
      return { rows: [] }
    })
    const session = openReadOnlySession(sourceTarget())

    await expect(session.withReadOnlyTransaction(async () => 'ok')).rejects.toBe(rollbackError)
  })
})

describe('read-only statement guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  async function queryText(text: string) {
    installClient(async () => ({ rows: [] }))
    const session = openReadOnlySession(sourceTarget())
    return session.query(text)
  }

  it('refuses a second statement hidden behind a quote inside a comment', async () => {
    // The old literal-stripping regex desynchronized here: the comment quote
    // swallowed the rest, so the INSERT looked keyword-free.
    await expect(
      queryText("select 1 /* ' */ ; insert into public.projects (id) values (1) /* ' */")
    ).rejects.toThrow(/single read-only statement/)
    await expect(queryText("select 1 -- '\n; drop table public.projects")).rejects.toThrow(
      /single read-only statement/
    )
  })

  it('refuses multi-statement input and side-effecting functions', async () => {
    await expect(queryText('select 1; select 2')).rejects.toThrow(/single read-only statement/)
    await expect(
      queryText("select set_config('default_transaction_read_only', 'off', false)")
    ).rejects.toThrow(/single read-only statement/)
    await expect(queryText('select pg_terminate_backend(1)')).rejects.toThrow(/single read-only statement/)
  })

  it('accepts one read-only statement, including semicolons and quotes inside literals', async () => {
    await expect(queryText("select 'a;b' as value, \"quoted id\" from public.projects")).resolves.toEqual([])
    await expect(queryText("select $$ text with ; and ' quote $$ as value")).resolves.toEqual([])
    await expect(queryText('select 1 as value;')).resolves.toEqual([])
  })
})

describe('read-only write probe', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('passes only when the write is refused by read-only mode (25006)', async () => {
    const statements: string[] = []
    installClient(async (text) => {
      statements.push(text)
      if (text.includes('create table')) {
        throw Object.assign(new Error('cannot execute CREATE TABLE in a read-only transaction'), {
          code: '25006',
        })
      }
      return { rows: [] }
    })
    const session = openReadOnlySession(sourceTarget())
    await expect(session.assertReadOnly()).resolves.toBeUndefined()
    expect(statements).toContain('rollback')
  })

  it('refuses to treat a permission error as proof of read-only mode', async () => {
    installClient(async (text) => {
      if (text.includes('create table')) {
        throw Object.assign(new Error('permission denied for schema public'), { code: '42501' })
      }
      return { rows: [] }
    })
    const session = openReadOnlySession(sourceTarget())
    await expect(session.assertReadOnly()).rejects.toThrow(/25006/)
  })
})

describe('identity probing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const baseIdentityRow = {
    database: 'test',
    server_version: '17.6',
    postmaster_started_at: '2026-09-19 00:00:00+00',
  }

  function installDeniedProbeClient(statements: string[]) {
    return installClient(async (text) => {
      statements.push(text)
      if (text.includes('pg_control_system')) {
        // A permission error aborts the transaction on the server; the session
        // must recover the snapshot instead of failing every later query (25P02).
        throw Object.assign(new Error('permission denied for function pg_control_system'), { code: '42501' })
      }
      if (text.includes('current_database()')) return { rows: [baseIdentityRow] }
      return { rows: [] }
    })
  }

  it('recovers the snapshot with a savepoint when the probe is denied inside a transaction', async () => {
    const statements: string[] = []
    installDeniedProbeClient(statements)
    const session = openReadOnlySession(sourceTarget())

    await session.withReadOnlyTransaction(async () => {
      await expect(session.identity()).rejects.toMatchObject({ code: 'E_INSTANCE_IDENTITY_UNAVAILABLE' })
      // The snapshot must still be usable after the denied probe.
      await session.query('select 1 as one')
    })

    expect(statements).toContain('savepoint vsis_system_identifier_probe')
    expect(statements).toContain('rollback to savepoint vsis_system_identifier_probe')
    expect(statements).not.toContain('release savepoint vsis_system_identifier_probe')
    expect(statements.indexOf('select 1 as one')).toBeGreaterThan(
      statements.indexOf('rollback to savepoint vsis_system_identifier_probe')
    )
  })

  it('probes without a savepoint outside a transaction', async () => {
    const statements: string[] = []
    installDeniedProbeClient(statements)
    const session = openReadOnlySession(sourceTarget())

    await expect(session.identity()).rejects.toMatchObject({ code: 'E_INSTANCE_IDENTITY_UNAVAILABLE' })

    expect(statements.some((text) => text.startsWith('savepoint'))).toBe(false)
  })
})
// migrations/tool/tests/migration-session.test.ts
