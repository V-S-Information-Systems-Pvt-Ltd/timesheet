// lib/migration/publish.ts
// C06B: the publication transitions that sit between a committed import and an
// admitted destination.
//
// C06A requires publication intent to be durable on the destination's receipt
// *before* any gate admits business writes, and every gating mechanism to obey
// that recorded state. Two transitions make that a sequence instead of a
// convention:
//
//   data-committed | verified --(intent)--> publication-intent --(admit)--> writable
//
// `admit` sets the receipt state and opens the write gate inside one
// transaction, so the destination can never be writable without the intent that
// was recorded first. Both transitions take the same gate row lock `apply`
// takes, so an apply, an intent and an admission cannot interleave.

import { MigrationRunError } from './journal'
import type { WriteSession } from './providers/session'

interface ReceiptState {
  runId: string
  state: string
  targetNamespace: string
}

const GATE = 'public.migration_write_gate'

/** Receipt row locked for the rest of the transaction. */
async function lockReceipt(
  tx: { query<T extends Record<string, unknown> = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]> },
  runId: string
): Promise<ReceiptState | null> {
  const rows = await tx.query<{ run_id: string; state: string; target_namespace: string }>(
    'select run_id, state, target_namespace from public.migration_runs where run_id = $1 for update',
    [runId]
  )
  const row = rows[0]
  return row ? { runId: row.run_id, state: row.state, targetNamespace: row.target_namespace } : null
}

/**
 * Lock the gate row when the deployment has one, so this transition serializes
 * with `apply` and with operator gate changes. A deployment without the gate
 * table has nothing to serialize against.
 */
async function lockGate(
  tx: { query<T extends Record<string, unknown> = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]> }
): Promise<boolean> {
  try {
    await tx.query(`select 1 from ${GATE} where id for update`)
    return true
  } catch (error) {
    if ((error as { code?: string }).code === '42P01') return false
    throw error
  }
}

export interface PublicationTransition {
  runId: string
  actor: string
  reason: string
}

export interface PublicationResult {
  runId: string
  state: 'publication-intent' | 'writable'
  targetNamespace: string
  actor: string
  reason: string
}

/** Record publication intent durably. No gate is opened by this step. */
export async function recordPublicationIntent(
  session: WriteSession,
  transition: PublicationTransition
): Promise<PublicationResult> {
  requireFields(transition)
  const result = await session.transaction(async (tx) => {
    await lockGate(tx)
    const receipt = await lockReceipt(tx, transition.runId)
    if (!receipt) {
      throw new MigrationRunError(
        'E_RECEIPT_MISSING',
        `No import receipt exists for run ${transition.runId}; there is nothing to publish.`
      )
    }
    if (receipt.state !== 'data-committed' && receipt.state !== 'verified') {
      throw new MigrationRunError(
        'E_PUBLICATION_STATE',
        `Run ${transition.runId} is ${receipt.state}; publication intent requires data-committed or verified.`
      )
    }
    await tx.query("update public.migration_runs set state = 'publication-intent' where run_id = $1", [
      transition.runId,
    ])
    return { runId: transition.runId, state: 'publication-intent' as const, targetNamespace: receipt.targetNamespace }
  })
  return { ...result, actor: transition.actor, reason: transition.reason }
}

/**
 * Admit writers: the receipt becomes `writable` and the gate opens in the same
 * transaction, and only from a recorded publication intent.
 */
export async function admitWriters(
  session: WriteSession,
  transition: PublicationTransition
): Promise<PublicationResult> {
  requireFields(transition)
  const result = await session.transaction(async (tx) => {
    const hasGate = await lockGate(tx)
    if (!hasGate) {
      throw new MigrationRunError(
        'E_GATE_MISSING',
        'The destination has no write gate; apply the C06B migration before publishing.'
      )
    }
    const receipt = await lockReceipt(tx, transition.runId)
    if (!receipt) {
      throw new MigrationRunError(
        'E_RECEIPT_MISSING',
        `No import receipt exists for run ${transition.runId}; nothing can be published.`
      )
    }
    if (receipt.state !== 'publication-intent') {
      throw new MigrationRunError(
        'E_PUBLICATION_STATE',
        `Run ${transition.runId} is ${receipt.state}; writers can only be admitted from a recorded publication intent.`
      )
    }
    await tx.query("update public.migration_runs set state = 'writable' where run_id = $1", [transition.runId])
    await tx.query(
      `insert into ${GATE} (id, state, run_id, reason, updated_at, updated_by)
       values (true, 'open', $1, $2, now(), $3)
       on conflict (id) do update
         set state = 'open',
             run_id = excluded.run_id,
             reason = excluded.reason,
             updated_at = now(),
             updated_by = excluded.updated_by`,
      [transition.runId, transition.reason, transition.actor]
    )
    return { runId: transition.runId, state: 'writable' as const, targetNamespace: receipt.targetNamespace }
  })
  return { ...result, actor: transition.actor, reason: transition.reason }
}

/**
 * Whether the destination has a receipt that permits admitting writers: either
 * a recorded publication intent, or a completed publication. Used by the gate
 * command so the state cannot be opened out of order.
 */
export async function publishedRunFor(
  session: Pick<WriteSession, 'query'>,
  targetNamespace: string
): Promise<{ runId: string; state: string } | null> {
  const rows = await session.query<{ run_id: string; state: string }>(
    `select run_id, state from public.migration_runs
      where target_namespace = $1 and state in ('publication-intent', 'writable')
      order by committed_at desc nulls last, run_id desc
      limit 1`,
    [targetNamespace]
  )
  const row = rows[0]
  return row ? { runId: row.run_id, state: row.state } : null
}

function requireFields(transition: PublicationTransition): void {
  if (!transition.runId.trim()) throw new MigrationRunError('E_PUBLICATION_RUN', 'A publication transition needs a run id.')
  if (!transition.reason.trim()) {
    throw new MigrationRunError(
      'E_PUBLICATION_REASON',
      'A publication transition requires --reason so the operator record explains it.'
    )
  }
  if (!transition.actor.trim()) {
    throw new MigrationRunError('E_PUBLICATION_ACTOR', 'A publication transition requires --actor.')
  }
}
