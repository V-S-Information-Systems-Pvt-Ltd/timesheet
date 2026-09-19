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
