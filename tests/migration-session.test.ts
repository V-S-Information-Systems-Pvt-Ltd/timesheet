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
