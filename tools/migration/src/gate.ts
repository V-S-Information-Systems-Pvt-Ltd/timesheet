// tools/migration/src/gate.ts
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

import { MigrationRunError } from './journal'
import type { WriteSession } from './providers/session'

export type WriteGateState = 'open' | 'fenced'

export interface WriteGate {
  state: WriteGateState
  runId: string | null
  /** Stable UUID for one fenced window, retained when that window opens. */
  fenceGeneration: string
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
      fence_generation: string
      reason: string | null
      updated_at: string
      updated_by: string
    }>(
      `select state, run_id, fence_generation, reason,
              to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as updated_at,
              updated_by
         from public.migration_write_gate where id`
    )
    const row = rows[0]
    if (row) {
      gate = {
        state: row.state === 'fenced' ? 'fenced' : 'open',
        runId: row.run_id,
        fenceGeneration: row.fence_generation,
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
  const written = await session.transaction(async (tx) => {
    if (change.state === 'fenced' && change.runId) {
      const current = await tx.query<{ state: string; run_id: string | null }>(
        'select state, run_id from public.migration_write_gate where id for update'
      )
      const sameWindow = current[0]?.state === 'fenced' && current[0]?.run_id === change.runId
      if (!sameWindow) {
        const priorReceipt = await tx.query<{ run_id: string }>(
          'select run_id from public.migration_runs where run_id = $1 limit 1', [change.runId]
        )
        if (priorReceipt.length > 0) {
          throw new MigrationRunError('E_RUN_ID_REUSED', `Run ${change.runId} already has a receipt; a new fenced window requires a new run id.`)
        }
      }
    }
    const rows = await tx.query<{
      state: string
      run_id: string | null
      fence_generation: string
      reason: string | null
      updated_at: string
      updated_by: string
    }>(
      `insert into public.migration_write_gate (id, state, run_id, fence_generation, reason, updated_at, updated_by)
       values (true, $1, $2, gen_random_uuid(), $3, now(), $4)
       on conflict (id) do update
         set state = excluded.state,
             run_id = excluded.run_id,
             fence_generation = case
               when excluded.state = 'fenced'
                    and migration_write_gate.state = 'fenced'
                    and migration_write_gate.run_id is not distinct from excluded.run_id
                 then migration_write_gate.fence_generation
               when excluded.state = 'fenced' then gen_random_uuid()
               else migration_write_gate.fence_generation
             end,
             reason = excluded.reason,
             updated_at = now(),
             updated_by = excluded.updated_by
       returning state, run_id, fence_generation, reason,
                 to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as updated_at,
                 updated_by`,
      [change.state, change.runId ?? null, change.reason, change.actor]
    )
    return rows[0]
  })
  resetWriteGateCache()
  return written ? toGate(written) : {
    state: change.state,
    runId: change.runId ?? null,
    fenceGeneration: '',
    reason: change.reason,
    updatedAt: new Date().toISOString(),
    updatedBy: change.actor,
  }
}

/** Explicit pre-publication recovery; only the currently fenced run can be reopened. */
export async function recoverWriteGate(session: WriteSession, change: WriteGateChange & { runId: string }): Promise<WriteGate> {
  if (change.state !== 'open' || !change.runId.trim() || !change.reason.trim()) {
    throw new MigrationRunError('E_RECOVERY_INPUT', 'Recovery requires an open state, --run-id and --reason.')
  }
  const written = await session.transaction(async (tx) => {
    const current = await tx.query<{ state: string; run_id: string | null; fence_generation: string }>(
      'select state, run_id, fence_generation from public.migration_write_gate where id for update'
    )
    if (current[0]?.state !== 'fenced' || current[0]?.run_id !== change.runId || !current[0]?.fence_generation) {
      throw new MigrationRunError('E_FENCE_MISMATCH', `Run ${change.runId} is not the current fenced window; recovery is refused.`)
    }
    const receipt = await tx.query<{ state: string }>(
      'select state from public.migration_runs where run_id = $1 for update', [change.runId]
    )
    if (receipt[0]?.state === 'publication-intent' || receipt[0]?.state === 'writable') {
      throw new MigrationRunError('E_RECOVERY_AFTER_INTENT', `Run ${change.runId} has recorded publication intent; recovery cannot directly open its gate.`)
    }
    const rows = await tx.query<{
      state: string; run_id: string | null; fence_generation: string; reason: string | null; updated_at: string; updated_by: string
    }>(
      `update public.migration_write_gate
          set state = 'open', reason = $2, updated_at = now(), updated_by = $3
        where id and run_id = $1
        returning state, run_id, fence_generation, reason,
                  to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as updated_at,
                  updated_by`,
      [change.runId, change.reason, change.actor]
    )
    return rows[0]
  })
  if (!written) throw new MigrationRunError('E_FENCE_MISMATCH', `Run ${change.runId} is not the current fenced window.`)
  resetWriteGateCache()
  return toGate(written)
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

/** The transaction surface the apply lock needs. */
export interface WriteGateLockTarget {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    params?: unknown[]
  ): Promise<T[]>
}

/**
 * Apply-side gate precheck for a destination, distinguishing the outcomes the
 * plan requires apply to tell apart. A missing table or bootstrap row is an
 * unfenced target and must fail closed; only a present fenced row admits an
 * apply-side mutation.
 */
export type ApplyGatePrecheck =
  | { kind: 'fenced'; gate: WriteGate }
  | { kind: 'open'; gate: WriteGate }
  | { kind: 'missing-row' }
  | { kind: 'missing-table' }

const GATE_SELECT = `select state, run_id, fence_generation, reason,
        to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as updated_at,
        updated_by
   from public.migration_write_gate where id`

function toGate(row: Record<string, unknown>): WriteGate {
  return {
    state: row.state === 'fenced' ? 'fenced' : 'open',
    runId: (row.run_id as string | null) ?? null,
    fenceGeneration: String(row.fence_generation ?? ''),
    reason: (row.reason as string | null) ?? null,
    updatedAt: String(row.updated_at ?? ''),
    updatedBy: String(row.updated_by ?? ''),
  }
}

export async function readWriteGateForApply(session: WriteGateReader): Promise<ApplyGatePrecheck> {
  let rows: Array<Record<string, unknown>>
  try {
    rows = await session.query(GATE_SELECT)
  } catch (error) {
    if ((error as { code?: string }).code !== '42P01') throw error
    return { kind: 'missing-table' }
  }
  const row = rows[0]
  if (!row) return { kind: 'missing-row' }
  const gate = toGate(row)
  return gate.state === 'fenced' ? { kind: 'fenced', gate } : { kind: 'open', gate }
}

/**
 * Lock the gate for the whole apply transaction and require it to be fenced.
 *
 * Two problems are solved by the same row lock:
 *
 * 1. **Mutual exclusion.** `apply` checks the destination baseline and then
 *    writes. Without a lock, a concurrent apply — or an operator transition on
 *    the gate — can interleave between the check and the writes. `for update` on
 *    the single gate row serializes both.
 * 2. **The protocol.** C06A fences both deployments for the final
 *    planning/apply window, so an apply against an open gate means the operator
 *    skipped the fence. That is refused rather than silently performed while
 *    application writers are still admitted.
 *
 * A deployment whose gate table does not exist yet is an unfenced target: the
 * pre-transaction check refuses it with `E_GATE_MISSING` before any
 * provisioning or data write, and this lock refuses it again inside the
 * transaction so a table dropped between the two checks cannot reopen the
 * window.
 */
export async function lockWriteGateForApply(tx: WriteGateLockTarget, runId: string): Promise<WriteGate> {
  // The probe runs under a savepoint: a missing gate table raises 42P01, which
  // aborts the surrounding transaction, so the refusal must first recover to
  // the savepoint or every later statement would fail with 25P02.
  await tx.query('savepoint vsis_write_gate_probe')
  let rows: Array<Record<string, unknown>>
  try {
    rows = await tx.query(
      `select state, run_id, fence_generation, reason,
              to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as updated_at,
              updated_by
         from public.migration_write_gate where id for update`
    )
    await tx.query('release savepoint vsis_write_gate_probe')
  } catch (error) {
    if ((error as { code?: string }).code !== '42P01') throw error
    await tx.query('rollback to savepoint vsis_write_gate_probe')
    throw new MigrationRunError(
      'E_GATE_MISSING',
      `Run ${runId} cannot apply: the destination has no write-gate table, so it cannot prove it was fenced. Apply the write-gate migration and fence the destination first.`
    )
  }
  const row = rows[0]
  if (!row) {
    throw new MigrationRunError(
      'E_GATE_MISSING',
      `Run ${runId} cannot apply: the destination has no write-gate row, so it cannot prove it was fenced. Initialize and fence the destination first.`
    )
  }
  const gate: WriteGate = {
    state: row.state === 'fenced' ? 'fenced' : 'open',
    runId: (row.run_id as string | null) ?? null,
    fenceGeneration: String(row.fence_generation ?? ''),
    reason: (row.reason as string | null) ?? null,
    updatedAt: String(row.updated_at ?? ''),
    updatedBy: String(row.updated_by ?? ''),
  }
  if (gate.state !== 'fenced') {
    throw new MigrationRunError(
      'E_WRITERS_NOT_FENCED',
      `Run ${runId} cannot apply while destination writers are admitted. Fence the destination first (migration gate --state fenced --reason ...); the current gate was last set by ${gate.updatedBy}.`
    )
  }
  return gate
}
