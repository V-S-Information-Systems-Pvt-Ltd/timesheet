import { beforeEach, describe, expect, it, vi } from 'vitest'

const { ClientMock, clientState } = vi.hoisted(() => {
  const state: { client: unknown } = { client: null }
  const client = vi.fn(function MockClient() {
    return state.client
  })
  return { ClientMock: client, clientState: state }
})

vi.mock('pg', () => ({ Client: ClientMock }))

import { openReadOnlySession } from '@/lib/migration/providers/session'

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

    const identity = await session.withReadOnlyTransaction(async () => {
      const value = await session.identity()
      // The snapshot must still be usable after the denied probe.
      await session.query('select 1 as one')
      return value
    })

    expect(identity.systemIdentifier).toBeNull()
    expect(identity.namespace).toMatch(/^native:/)
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

    const identity = await session.identity()

    expect(identity.systemIdentifier).toBeNull()
    expect(statements.some((text) => text.startsWith('savepoint'))).toBe(false)
  })
})
