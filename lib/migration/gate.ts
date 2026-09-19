// lib/migration/gate.ts
// C06B: the durable destination write gate.
//
// The C06A contract requires both deployments to be fenced during the final
// planning/apply/verification window and the merged destination to be admitted
// only after its publication gates pass. That is a durable state, not a page:
// a single row (`public.migration_write_gate`) that every write path reads
// before mutating.
//
// The row is readable by signed-in callers and writable only by the migration
// tooling. The enforcement read is cached for a few seconds so a fence costs
// one indexed single-row read per process per interval rather than one per
// request. A stale window is safe in the direction that matters: the gate is
// closed *before* the freeze, so at worst a write lands within the cache TTL of
// the operator's own fence command.

import type { WriteSession } from './providers/session'

export type WriteGateState = 'open' | 'fenced'

export interface WriteGate {
  state: WriteGateState
  runId: string | null
  reason: string | null
  updatedAt: string
  updatedBy: string
}

export interface WriteGateChange {
  state: WriteGateState
  reason: string
  actor: string
  runId?: string | null
}

/** Reads are cached for this long; see the note above for why that is safe. */
export const WRITE_GATE_CACHE_MS = 5_000

/** Minimal read surface: the CLI's write session and a test double both satisfy it. */
export interface WriteGateReader {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    params?: unknown[]
  ): Promise<T[]>
}

const cache = new Map<string, { at: number; gate: WriteGate | null }>()

export function resetWriteGateCache(): void {
  cache.clear()
}

/**
 * Current gate state, or `null` when the deployment has no gate table yet
 * (an older deployment, or a database that predates this migration).
 */
export async function readWriteGate(
  session: WriteGateReader,
  options: { cacheKey?: string; now?: () => number } = {}
): Promise<WriteGate | null> {
  const key = options.cacheKey
  const now = options.now ?? (() => Date.now())
  if (key) {
    const hit = cache.get(key)
    if (hit && now() - hit.at < WRITE_GATE_CACHE_MS) return hit.gate
  }
  let gate: WriteGate | null = null
  try {
    const rows = await session.query<{
      state: string
      run_id: string | null
      reason: string | null
      updated_at: string
      updated_by: string
    }>(
      `select state, run_id, reason,
              to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as updated_at,
              updated_by
         from public.migration_write_gate where id`
    )
    const row = rows[0]
    if (row) {
      gate = {
        state: row.state === 'fenced' ? 'fenced' : 'open',
        runId: row.run_id,
        reason: row.reason,
        updatedAt: row.updated_at,
        updatedBy: row.updated_by,
      }
    }
  } catch (error) {
    if ((error as { code?: string }).code !== '42P01') throw error
    gate = null
  }
  if (key) cache.set(key, { at: now(), gate })
  return gate
}

/**
 * Whether business writes are refused. A deployment with no gate table is
 * treated as open: the gate exists to protect a migration window, and a
 * deployment that has never run one has nothing to freeze.
 */
export async function isWriteGateFenced(
  session: WriteGateReader,
  options: { cacheKey?: string } = {}
): Promise<boolean> {
  return (await readWriteGate(session, options))?.state === 'fenced'
}

/** Operator transition. Writes the durable row; the caller owns the audit trail. */
export async function setWriteGate(session: WriteSession, change: WriteGateChange): Promise<WriteGate> {
  if (!change.reason.trim()) {
    throw new Error('A write-gate transition requires a recorded reason.')
  }
  await session.transaction(async (tx) => {
    await tx.query(
      `insert into public.migration_write_gate (id, state, run_id, reason, updated_at, updated_by)
       values (true, $1, $2, $3, now(), $4)
       on conflict (id) do update
         set state = excluded.state,
             run_id = excluded.run_id,
             reason = excluded.reason,
             updated_at = now(),
             updated_by = excluded.updated_by`,
      [change.state, change.runId ?? null, change.reason, change.actor]
    )
  })
  resetWriteGateCache()
  return {
    state: change.state,
    runId: change.runId ?? null,
    reason: change.reason,
    updatedAt: new Date().toISOString(),
    updatedBy: change.actor,
  }
}

/** The refusal every write path returns while the destination is fenced. */
export interface WriteGateRefusal {
  status: 503
  code: 'WRITERS_FENCED'
  message: string
  retryAfterSeconds: number
}

export function writeGateRefusal(gate: WriteGate | null): WriteGateRefusal {
  const suffix = gate?.reason ? ` (${gate.reason})` : ''
  return {
    status: 503,
    code: 'WRITERS_FENCED',
    message: `This deployment is temporarily read-only for a data migration${suffix}. Your request was not applied; retry after the migration window.`,
    retryAfterSeconds: 60,
  }
}
