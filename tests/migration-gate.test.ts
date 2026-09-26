// tests/migration-gate.test.ts
// C06B: the durable write gate and the surfaces that obey it. A fence that
// nobody enforces is a maintenance page, so this suite covers both the state
// itself and the refusal every write path returns while it is closed.

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  WRITE_GATE_CACHE_MS,
  isWriteGateFenced,
  lockWriteGateForApply,
  readWriteGate,
  readWriteGateForApply,
  recoverWriteGate,
  resetWriteGateCache,
  setWriteGate,
  writeGateRefusal,
} from '@/lib/migration/gate'
import { admitWriters, recordPublicationIntent, recordVerifiedState } from '@/lib/migration/publish'
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
  fence_generation: '11111111-1111-4111-8111-111111111111',
  reason: 'migration window',
  updated_at: '2026-09-19T10:00:00.000000Z',
  updated_by: 'operator',
}

describe('C06B write gate', () => {
  it('reads the durable state', async () => {
    const source = reader([FENCED_ROW])
    const gate = await readWriteGate(source)
    expect(source.query).toHaveBeenCalledWith(expect.stringContaining('fence_generation'))
    expect(gate).toEqual({
      state: 'fenced',
      runId: 'run-1',
      fenceGeneration: '11111111-1111-4111-8111-111111111111',
      reason: 'migration window',
      updatedAt: '2026-09-19T10:00:00.000000Z',
      updatedBy: 'operator',
    })
    expect(await isWriteGateFenced(reader([FENCED_ROW]))).toBe(true)
    expect(await isWriteGateFenced(reader([{ ...FENCED_ROW, state: 'open' }]))).toBe(false)
  })

  it('only recovers the currently fenced run and retains its generation', async () => {
    const statements: string[] = []
    const session = {
      transaction: async (fn: (tx: { query: (sql: string) => Promise<unknown[]> }) => Promise<unknown>) => fn({
        query: async (sql: string) => {
          statements.push(sql)
          if (sql.includes('for update')) return [{ state: 'fenced', run_id: 'run-2', fence_generation: FENCED_ROW.fence_generation }]
          return [{ ...FENCED_ROW, state: 'open', run_id: 'run-2' }]
        },
      }),
    } as unknown as WriteSession
    await expect(recoverWriteGate(session, {
      state: 'open', runId: 'run-1', actor: 'operator', reason: '[recovery] restored baseline',
    })).rejects.toThrow(/not the current fenced window/)
    expect(statements).toHaveLength(1)
    const recovered = await recoverWriteGate(session, {
      state: 'open', runId: 'run-2', actor: 'operator', reason: '[recovery] restored baseline',
    })
    expect(recovered).toMatchObject({ state: 'open', runId: 'run-2', fenceGeneration: FENCED_ROW.fence_generation })
    expect(statements.some((sql) => sql.startsWith('update public.migration_write_gate'))).toBe(true)
  })

  it('refuses recovery once publication intent has been recorded', async () => {
    const statements: string[] = []
    const session = {
      transaction: async (fn: (tx: { query: (sql: string) => Promise<unknown[]> }) => Promise<unknown>) => fn({
        query: async (sql: string) => {
          statements.push(sql)
          if (sql.includes('migration_write_gate where id for update')) return [FENCED_ROW]
          if (sql.includes('from public.migration_runs')) return [{ state: 'publication-intent' }]
          return []
        },
      }),
    } as unknown as WriteSession
    await expect(recoverWriteGate(session, {
      state: 'open', runId: 'run-1', actor: 'operator', reason: '[recovery] unsafe',
    })).rejects.toThrow(/cannot directly open its gate/)
    expect(statements.some((sql) => sql.startsWith('update public.migration_write_gate'))).toBe(false)
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
    expect(queries).toHaveLength(3)
    expect(queries[0].sql).toContain('for update')
    expect(queries[1].sql).toContain('from public.migration_runs')
    expect(queries[2].sql).toContain('insert into public.migration_write_gate')
    expect(queries[2].sql).toContain('on conflict (id) do update')
    expect(queries[2].sql).toContain('fence_generation = case')
    expect(queries[2].params).toEqual(['fenced', 'run-1', 'final planning/apply window', 'operator@example.com'])

    await expect(
      setWriteGate(session, { state: 'open', reason: '   ', actor: 'operator@example.com' })
    ).rejects.toThrow(/recorded reason/)
  })

  it('refuses to refence a recovered run with a durable receipt', async () => {
    const statements: string[] = []
    const session = {
      transaction: async (fn: (tx: { query: (sql: string) => Promise<unknown[]> }) => Promise<unknown>) => fn({
        query: async (sql: string) => {
          statements.push(sql)
          if (sql.includes('migration_write_gate where id for update')) return [{ state: 'open', run_id: 'run-1' }]
          if (sql.includes('from public.migration_runs')) return [{ run_id: 'run-1' }]
          return []
        },
      }),
    } as unknown as WriteSession
    await expect(setWriteGate(session, {
      state: 'fenced', runId: 'run-1', actor: 'operator', reason: 'new window',
    })).rejects.toThrow(/new run id/)
    expect(statements.some((sql) => sql.includes('insert into public.migration_write_gate'))).toBe(false)
  })

  it('describes a retryable refusal, not an error the client should drop', async () => {
    const refusal = writeGateRefusal({
      state: 'fenced',
      runId: 'run-1',
      fenceGeneration: '11111111-1111-4111-8111-111111111111',
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

describe('C06B apply-side gate refusals', () => {
  function lockTarget(rows: Array<Record<string, unknown>> | 'missing', onQuery?: (sql: string) => void) {
    const statements: string[] = []
    const tx = {
      query: vi.fn(async (sql: string) => {
        statements.push(sql)
        onQuery?.(sql)
        if (rows === 'missing' && sql.includes('migration_write_gate')) {
          const error = new Error('relation "public.migration_write_gate" does not exist') as Error & { code?: string }
          error.code = '42P01'
          throw error
        }
        return rows === 'missing' ? [] : rows
      }),
    }
    return { tx: tx as unknown as Parameters<typeof lockWriteGateForApply>[0], statements }
  }

  it('distinguishes missing table, missing row, open and fenced for the apply precheck', async () => {
    expect(await readWriteGateForApply(reader([FENCED_ROW]))).toEqual({ kind: 'fenced', gate: expect.anything() })
    expect(await readWriteGateForApply(reader([{ ...FENCED_ROW, state: 'open' }]))).toEqual({
      kind: 'open',
      gate: expect.anything(),
    })
    expect(await readWriteGateForApply(reader([]))).toEqual({ kind: 'missing-row' })
    expect(await readWriteGateForApply(reader('missing'))).toEqual({ kind: 'missing-table' })
  })

  it('refuses a gate-less destination inside the apply transaction after recovering the savepoint', async () => {
    const { tx, statements } = lockTarget('missing')
    await expect(lockWriteGateForApply(tx, 'run-1')).rejects.toMatchObject({ code: 'E_GATE_MISSING' })
    // The 42P01 aborts the surrounding transaction, so the refusal must first
    // recover to the savepoint or every later statement would fail with 25P02.
    expect(statements[0]).toBe('savepoint vsis_write_gate_probe')
    expect(statements[1]).toContain('from public.migration_write_gate where id for update')
    expect(statements[2]).toBe('rollback to savepoint vsis_write_gate_probe')
  })

  it('keeps the fenced admit and open refusal behaviors on the transactional lock', async () => {
    const fenced = lockTarget([FENCED_ROW])
    expect(await lockWriteGateForApply(fenced.tx, 'run-1')).toMatchObject({ state: 'fenced' })
    const open = lockTarget([{ ...FENCED_ROW, state: 'open' }])
    await expect(lockWriteGateForApply(open.tx, 'run-1')).rejects.toMatchObject({
      code: 'E_WRITERS_NOT_FENCED',
    })
  })

  it('refuses a missing gate row under the transactional lock', async () => {
    const missingRow = lockTarget([])
    await expect(lockWriteGateForApply(missingRow.tx, 'run-1')).rejects.toMatchObject({
      code: 'E_GATE_MISSING',
    })
    expect(missingRow.statements).toContain('release savepoint vsis_write_gate_probe')
  })
})

describe('C06B publication sequence', () => {
  function publicationSession(receiptState: string | null, gateRunId = 'run-1') {
    const statements: string[] = []
    const session = {
      identity: async () => ({ provider: 'native', namespace: 'native:target', runtimeFingerprint: 'runtime' }),
      query: vi.fn(async () => (receiptState === null ? [] : [{ run_id: 'run-1', state: receiptState, target_namespace: 'native:target' }])),
      transaction: async (
        fn: (tx: { query: (sql: string, params?: unknown[]) => Promise<unknown[]> }) => Promise<unknown>
      ) =>
        fn({
          query: async (sql: string) => {
            statements.push(sql)
            if (sql.includes('from public.migration_write_gate where id for update')) {
              return [{ state: 'fenced', run_id: gateRunId, fence_generation: '11111111-1111-4111-8111-111111111111' }]
            }
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
    const intent = publicationSession('verified')
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
    expect(admit.statements[opened]).not.toContain('fence_generation')
  })

  it('records verification durably, idempotently, and only from a committed run', async () => {
    const first = publicationSession('data-committed')
    const verified = await recordVerifiedState(first.session, {
      runId: 'run-1',
      actor: 'operator@example.com',
      reason: 'merged result reconciled',
    })
    expect(verified.state).toBe('verified')
    expect(first.statements.some((sql) => /set state = 'verified'/.test(sql))).toBe(true)

    // Verifying the same committed run again is not an error and writes nothing.
    const repeat = publicationSession('verified')
    expect(
      (await recordVerifiedState(repeat.session, { runId: 'run-1', actor: 'operator', reason: 're-run' })).state
    ).toBe('verified')
    expect(repeat.statements.some((sql) => /set state = 'verified'/.test(sql))).toBe(false)

    // A run that is already published cannot claim a fresh verification.
    const published = publicationSession('writable')
    await expect(
      recordVerifiedState(published.session, { runId: 'run-1', actor: 'operator', reason: 'late' })
    ).rejects.toThrow(/verification is only recorded for a data-committed run/)

    const missing = publicationSession(null)
    await expect(
      recordVerifiedState(missing.session, { runId: 'run-1', actor: 'operator', reason: 'late' })
    ).rejects.toThrow(/No import receipt exists/)
  })

  it('refuses publication intent until post-commit verification is durable', async () => {
    const { session, statements } = publicationSession('data-committed')
    await expect(
      recordPublicationIntent(session, { runId: 'run-1', actor: 'operator', reason: 'go live' })
    ).rejects.toThrow(/requires a verified receipt/)
    expect(statements.some((sql) => /set state = 'publication-intent'/.test(sql))).toBe(false)
  })

  it('refuses stale intent and admission after another run fences the destination', async () => {
    const intent = publicationSession('verified', 'run-2')
    await expect(recordPublicationIntent(intent.session, {
      runId: 'run-1', actor: 'operator', reason: 'stale intent',
    })).rejects.toThrow(/not the current fenced window/)
    expect(intent.statements.some((sql) => /set state = 'publication-intent'/.test(sql))).toBe(false)

    const admit = publicationSession('publication-intent', 'run-2')
    await expect(admitWriters(admit.session, {
      runId: 'run-1', actor: 'operator', reason: 'stale admission',
    })).rejects.toThrow(/not the current fenced window/)
    expect(admit.statements.some((sql) => /set state = 'writable'|set state = 'open'/.test(sql))).toBe(false)
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

  it('leaves active-account reads available while refusing active-account mutations when fenced', async () => {
    vi.resetModules()
    vi.doMock('@/lib/db/write-gate', () => ({
      writeGateResponse: async () => ({
        status: 503,
        body: { error: 'This deployment is temporarily read-only for a data migration.', code: 'WRITERS_FENCED' },
      }),
    }))
    vi.doMock('@/lib/auth', () => ({ getActor: async () => ({ id: 'a', isActive: true, permissionRole: 'admin' }) }))
    const { requireActiveActor, requireMutatingActiveActor } = await import('@/app/actions/_shared')

    const read = await requireActiveActor()
    expect('error' in read).toBe(false)
    const mutation = await requireMutatingActiveActor()
    expect('error' in mutation && mutation.error).toContain('temporarily read-only')

    vi.doUnmock('@/lib/db/write-gate')
    vi.doUnmock('@/lib/auth')
    vi.resetModules()
  })

  it('fails closed for a mutating Server Action when its write gate is unreadable', async () => {
    vi.resetModules()
    vi.doMock('@/lib/db/write-gate', () => ({
      writeGateResponse: async () => { throw new Error('database unavailable') },
    }))
    vi.doMock('@/lib/auth', () => ({ getActor: async () => ({ id: 'a', isActive: true }) }))
    const { requireMutatingActiveActor } = await import('@/app/actions/_shared')

    const result = await requireMutatingActiveActor()
    expect('error' in result && result.error).toContain('could not be read')

    vi.doUnmock('@/lib/db/write-gate')
    vi.doUnmock('@/lib/auth')
    vi.resetModules()
  })

  it('fences role-gated mutations but keeps role-gated reads working', async () => {
    vi.resetModules()
    vi.doMock('@/lib/db/write-gate', () => ({
      writeGateResponse: async () => ({
        status: 503,
        body: { error: 'This deployment is temporarily read-only for a data migration.', code: 'WRITERS_FENCED' },
      }),
    }))
    vi.doMock('@/lib/auth', () => ({
      getActor: async () => ({ id: 'a', isActive: true, role: 'admin', permission_role: 'admin' }),
    }))
    const { requireActor, requireMutatingActor } = await import('@/app/actions/_shared')

    // A role-gated mutation is refused while the deployment is fenced.
    const mutation = await requireMutatingActor(['admin'])
    expect('error' in mutation && mutation.error).toContain('temporarily read-only')

    // A role-gated read (e.g. exportBackup) keeps working: requireActor does
    // not consult the fence.
    const read = await requireActor(['admin'])
    expect('error' in read).toBe(false)

    vi.doUnmock('@/lib/db/write-gate')
    vi.doUnmock('@/lib/auth')
    vi.resetModules()
  })

  it('refuses mobile-API mutations while fenced, and leaves reads alone', async () => {
    vi.resetModules()
    vi.doMock('@/lib/db/write-gate', () => ({
      writeGateResponse: async () => ({
        status: 503,
        body: { error: 'This deployment is temporarily read-only for a data migration.', code: 'WRITERS_FENCED' },
      }),
    }))
    // Only the credential path is stubbed; the guard's field checks
    // (sessionId/userId/familyId, revocations, expiry) still run, so the fence
    // is reached through the real code path.
    vi.doMock('@/lib/auth/mobile-tokens', () => ({
      verifyMobileAccessToken: vi.fn(async () => ({
        sessionId: 'session-1',
        userId: 'user-1',
        familyId: 'family-1',
      })),
      isLegacyMobileToken: vi.fn(async () => false),
    }))
    vi.doMock('@/lib/auth/mobile-session-store', () => ({
      mobileSessionStore: {
        findSessionAndActorById: vi.fn(async () => ({
          session: {
            id: 'session-1',
            userId: 'user-1',
            familyId: 'family-1',
            revokedAt: null,
            rotatedAt: null,
            idleExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
            absoluteExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
          },
          actor: {
            id: 'user-1',
            email: 'u@example.com',
            role: 'user',
            permissionRole: 'admin',
            hierarchyRole: 'manager',
            isActive: true,
          },
        })),
      },
    }))
    vi.doMock('@/lib/auth', async () => {
      const actual = await vi.importActual<Record<string, unknown>>('@/lib/auth')
      return { ...actual, getActor: async () => null }
    })
    const { requireMobileActor } = await import('@/app/api/v1/_http')
    const bearer = (method: string) =>
      new Request('https://example.test/api/v1/timesheets', {
        method,
        headers: { authorization: 'Bearer access-token' },
      })

    const write = await requireMobileActor(bearer('POST'))
    expect(write.ok).toBe(false)
    if (!write.ok) {
      expect(write.response.status).toBe(503)
      const body = (await write.response.json()) as { error?: { code?: string } }
      expect(body.error?.code).toBe('WRITERS_FENCED')
      expect(write.response.headers.get('retry-after')).toBe('60')
    }

    const read = await requireMobileActor(bearer('GET'))
    expect(read.ok).toBe(true)

    vi.doUnmock('@/lib/db/write-gate')
    vi.doUnmock('@/lib/auth/mobile-tokens')
    vi.doUnmock('@/lib/auth/mobile-session-store')
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
