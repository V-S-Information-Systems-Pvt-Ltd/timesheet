// tests/migration-gate.test.ts
// C06B: the durable write gate and the surfaces that obey it. A fence that
// nobody enforces is a maintenance page, so this suite covers both the state
// itself and the refusal every write path returns while it is closed.

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  WRITE_GATE_CACHE_MS,
  isWriteGateFenced,
  readWriteGate,
  resetWriteGateCache,
  setWriteGate,
  writeGateRefusal,
} from '@/lib/migration/gate'
import { admitWriters, recordPublicationIntent } from '@/lib/migration/publish'
import type { WriteGateReader } from '@/lib/migration/gate'
import type { WriteSession } from '@/lib/migration/providers/session'

afterEach(() => resetWriteGateCache())

function reader(rows: Array<Record<string, unknown>> | 'missing', onQuery?: () => void): WriteGateReader {
  const query = vi.fn(async () => {
    onQuery?.()
    if (rows === 'missing') {
      const error = new Error('relation "public.migration_write_gate" does not exist') as Error & { code?: string }
      error.code = '42P01'
      throw error
    }
    return rows
  })
  return { query } as unknown as WriteGateReader
}

const FENCED_ROW = {
  state: 'fenced',
  run_id: 'run-1',
  reason: 'migration window',
  updated_at: '2026-09-19T10:00:00.000000Z',
  updated_by: 'operator',
}

describe('C06B write gate', () => {
  it('reads the durable state', async () => {
    const gate = await readWriteGate(reader([FENCED_ROW]))
    expect(gate).toEqual({
      state: 'fenced',
      runId: 'run-1',
      reason: 'migration window',
      updatedAt: '2026-09-19T10:00:00.000000Z',
      updatedBy: 'operator',
    })
    expect(await isWriteGateFenced(reader([FENCED_ROW]))).toBe(true)
    expect(await isWriteGateFenced(reader([{ ...FENCED_ROW, state: 'open' }]))).toBe(false)
  })

  it('treats a deployment without a gate table as open, and never as fenced', async () => {
    expect(await readWriteGate(reader('missing'))).toBeNull()
    expect(await isWriteGateFenced(reader('missing'))).toBe(false)
  })

  it('propagates a broken read instead of silently admitting writes', async () => {
    const broken = {
      query: vi.fn(async () => {
        const error = new Error('connection reset') as Error & { code?: string }
        error.code = 'ECONNRESET'
        throw error
      }),
    }
    await expect(readWriteGate(broken)).rejects.toThrow('connection reset')
  })

  it('caches the enforcement read for the configured window', async () => {
    let reads = 0
    const source = reader([FENCED_ROW], () => {
      reads += 1
    })
    const start = 1_000
    await readWriteGate(source, { cacheKey: 'native:a', now: () => start })
    await readWriteGate(source, { cacheKey: 'native:a', now: () => start + WRITE_GATE_CACHE_MS - 1 })
    expect(reads).toBe(1)
    await readWriteGate(source, { cacheKey: 'native:a', now: () => start + WRITE_GATE_CACHE_MS + 1 })
    expect(reads).toBe(2)
    // A different deployment never shares another's cache entry.
    await readWriteGate(source, { cacheKey: 'native:b', now: () => start })
    expect(reads).toBe(3)
  })

  it('writes transitions inside one transaction and requires a recorded reason', async () => {
    const queries: Array<{ sql: string; params?: unknown[] }> = []
    const session = {
      transaction: async (fn: (tx: { query: (sql: string, params?: unknown[]) => Promise<unknown[]> }) => Promise<unknown>) =>
        fn({
          query: async (sql: string, params?: unknown[]) => {
            queries.push({ sql, params })
            return []
          },
        }),
    } as unknown as WriteSession

    const gate = await setWriteGate(session, {
      state: 'fenced',
      reason: 'final planning/apply window',
      actor: 'operator@example.com',
      runId: 'run-1',
    })
    expect(gate.state).toBe('fenced')
    expect(queries).toHaveLength(1)
    expect(queries[0].sql).toContain('insert into public.migration_write_gate')
    expect(queries[0].sql).toContain('on conflict (id) do update')
    expect(queries[0].params).toEqual(['fenced', 'run-1', 'final planning/apply window', 'operator@example.com'])

    await expect(
      setWriteGate(session, { state: 'open', reason: '   ', actor: 'operator@example.com' })
    ).rejects.toThrow(/recorded reason/)
  })

  it('describes a retryable refusal, not an error the client should drop', async () => {
    const refusal = writeGateRefusal({
      state: 'fenced',
      runId: 'run-1',
      reason: 'migration window',
      updatedAt: '',
      updatedBy: 'operator',
    })
    expect(refusal.status).toBe(503)
    expect(refusal.code).toBe('WRITERS_FENCED')
    expect(refusal.message).toContain('was not applied')
    expect(refusal.message).toContain('migration window')
    expect(refusal.retryAfterSeconds).toBeGreaterThan(0)
  })
})

describe('C06B publication sequence', () => {
  function publicationSession(receiptState: string | null) {
    const statements: string[] = []
    const session = {
      query: vi.fn(async () => (receiptState === null ? [] : [{ run_id: 'run-1', state: receiptState, target_namespace: 'native:target' }])),
      transaction: async (
        fn: (tx: { query: (sql: string, params?: unknown[]) => Promise<unknown[]> }) => Promise<unknown>
      ) =>
        fn({
          query: async (sql: string) => {
            statements.push(sql)
            if (sql.includes('from public.migration_write_gate where id for update')) return [{}]
            if (sql.includes('from public.migration_runs where run_id'))
              return receiptState === null ? [] : [{ run_id: 'run-1', state: receiptState, target_namespace: 'native:target' }]
            return []
          },
        }),
    } as unknown as WriteSession
    return { session, statements }
  }

  it('refuses to admit writers before the publication intent is recorded', async () => {
    const { session, statements } = publicationSession('data-committed')
    await expect(
      admitWriters(session, { runId: 'run-1', actor: 'operator', reason: 'go live' })
    ).rejects.toThrow(/only be admitted from a recorded publication intent|E_PUBLICATION_STATE/)
    // Nothing was written: the receipt stays data-committed and the gate closed.
    expect(statements.some((sql) => /update public\.migration_runs set state = 'writable'/.test(sql))).toBe(false)
    expect(statements.some((sql) => /insert into public\.migration_write_gate/.test(sql))).toBe(false)
  })

  it('refuses publication intent for a run with no durable receipt', async () => {
    const { session } = publicationSession(null)
    await expect(
      recordPublicationIntent(session, { runId: 'run-1', actor: 'operator', reason: 'go live' })
    ).rejects.toThrow(/No import receipt exists/)
  })

  it('records intent, then admits writers and opens the gate in one transaction', async () => {
    const intent = publicationSession('data-committed')
    const recorded = await recordPublicationIntent(intent.session, {
      runId: 'run-1',
      actor: 'operator@example.com',
      reason: 'merged result verified',
    })
    expect(recorded.state).toBe('publication-intent')
    expect(intent.statements.some((sql) => /set state = 'publication-intent'/.test(sql))).toBe(true)
    // Intent records the state and locks the gate; it never opens it.
    expect(
      intent.statements.some((sql) => /insert into public\.migration_write_gate|update public\.migration_write_gate/.test(sql))
    ).toBe(false)

    const admit = publicationSession('publication-intent')
    const admitted = await admitWriters(admit.session, {
      runId: 'run-1',
      actor: 'operator@example.com',
      reason: 'clients admitted',
    })
    expect(admitted.state).toBe('writable')
    const writable = admit.statements.findIndex((sql) => /set state = 'writable'/.test(sql))
    const opened = admit.statements.findIndex((sql) => /insert into public\.migration_write_gate/.test(sql))
    expect(writable).toBeGreaterThanOrEqual(0)
    expect(opened).toBeGreaterThan(writable)
  })

  it('requires a reason, an actor and a run id for every transition', async () => {
    const { session } = publicationSession('data-committed')
    await expect(
      recordPublicationIntent(session, { runId: 'run-1', actor: 'operator', reason: '   ' })
    ).rejects.toThrow(/requires --reason/)
    await expect(
      admitWriters(session, { runId: '', actor: 'operator', reason: 'go live' })
    ).rejects.toThrow(/needs a run id/)
    await expect(
      recordPublicationIntent(session, { runId: 'run-1', actor: '  ', reason: 'go live' })
    ).rejects.toThrow(/requires --actor/)
  })
})

describe('C06B enforcement surfaces', () => {
  it('refuses state-mutating REST requests while fenced, and leaves reads alone', async () => {
    vi.resetModules()
    vi.doMock('@/lib/db/write-gate', () => ({
      writeGateResponse: async () => ({
        status: 503,
        body: { error: 'This deployment is temporarily read-only for a data migration.', code: 'WRITERS_FENCED' },
      }),
    }))
    vi.doMock('@/lib/auth', () => ({ getActor: async () => ({ id: 'a', isActive: true }) }))
    const { requireActive } = await import('@/app/api/_http')

    const write = await requireActive(new Request('https://example.test/api/data/x', { method: 'POST' }))
    expect(write.ok).toBe(false)
    if (!write.ok) {
      expect(write.response.status).toBe(503)
      expect(write.response.headers.get('retry-after')).toBe('60')
    }

    const read = await requireActive(new Request('https://example.test/api/data/x', { method: 'GET' }))
    expect(read.ok).toBe(true)

    vi.doUnmock('@/lib/db/write-gate')
    vi.doUnmock('@/lib/auth')
    vi.resetModules()
  })

  it('refuses Server Actions while fenced so a write cannot slip past the REST fence', async () => {
    vi.resetModules()
    vi.doMock('@/lib/db/write-gate', () => ({
      writeGateResponse: async () => ({
        status: 503,
        body: { error: 'This deployment is temporarily read-only for a data migration.', code: 'WRITERS_FENCED' },
      }),
    }))
    vi.doMock('@/lib/auth', () => ({ getActor: async () => ({ id: 'a', isActive: true, permissionRole: 'admin' }) }))
    const { requireActiveActor } = await import('@/app/actions/_shared')

    const result = await requireActiveActor()
    expect('error' in result && result.error).toContain('temporarily read-only')

    vi.doUnmock('@/lib/db/write-gate')
    vi.doUnmock('@/lib/auth')
    vi.resetModules()
  })

  it('refuses rather than admitting writes when the gate itself cannot be read', async () => {
    vi.resetModules()
    vi.doMock('@/lib/db/write-gate', () => ({
      writeGateResponse: async () => {
        throw new Error('permission denied for table migration_write_gate')
      },
    }))
    vi.doMock('@/lib/auth', () => ({ getActor: async () => ({ id: 'a', isActive: true }) }))
    const { requireActive } = await import('@/app/api/_http')

    const write = await requireActive(new Request('https://example.test/api/data/x', { method: 'PATCH' }))
    expect(write.ok).toBe(false)
    if (!write.ok) expect(write.response.status).toBe(503)

    vi.doUnmock('@/lib/db/write-gate')
    vi.doUnmock('@/lib/auth')
    vi.resetModules()
  })
})
