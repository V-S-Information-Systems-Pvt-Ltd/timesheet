// migrations/tool/src/publish.ts
// C06B: the publication transitions that sit between a committed import and an
// admitted destination.
//
// C06A requires publication intent to be durable on the destination's receipt
// *before* any gate admits business writes, and every gating mechanism to obey
// that recorded state. Two transitions make that a sequence instead of a
// convention:
//
//   verified --(intent)--> publication-intent --(admit)--> writable
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
 * Lock the gate row so publication serializes with `apply` and operator gate
 * changes. A missing row is returned as null and publication refuses it.
 */
async function lockGate(
  tx: { query<T extends Record<string, unknown> = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]> }
): Promise<{ state: string; runId: string | null; fenceGeneration: string } | null> {
  try {
    const rows = await tx.query<{ state: string; run_id: string | null; fence_generation: string }>(
      `select state, run_id, fence_generation from ${GATE} where id for update`
    )
    const row = rows[0]
    return row ? { state: row.state, runId: row.run_id, fenceGeneration: row.fence_generation } : null
  } catch (error) {
    if ((error as { code?: string }).code === '42P01') return null
    throw error
  }
}

function requireCurrentFence(
  gate: Awaited<ReturnType<typeof lockGate>>,
  receipt: ReceiptState,
  runId: string,
  namespace: string
): void {
  if (receipt.targetNamespace !== namespace) {
    throw new MigrationRunError('E_TARGET_MISMATCH', `Run ${runId} belongs to ${receipt.targetNamespace}, not ${namespace}.`)
  }
  if (!gate || gate.state !== 'fenced' || gate.runId !== runId || !gate.fenceGeneration) {
    throw new MigrationRunError('E_FENCE_MISMATCH', `Run ${runId} is not the current fenced window; publication is refused.`)
  }
}

export interface PublicationTransition {
  runId: string
  actor: string
  reason: string
}

export interface PublicationResult {
  runId: string
  state: 'verified' | 'publication-intent' | 'writable'
  targetNamespace: string
  actor: string
  reason: string
}

/**
 * Persist the `verified` state after a reconcile that matched the approved
 * result. Completion must not live only in terminal output, and publication
 * intent requires this recorded state — so a destination cannot be published
 * from a run nobody verified.
 */
export async function recordVerifiedState(
  session: WriteSession,
  transition: PublicationTransition
): Promise<PublicationResult> {
  requireFields(transition)
  const namespace = (await session.identity()).namespace
  const result = await session.transaction(async (tx) => {
    const gate = await lockGate(tx)
    const receipt = await lockReceipt(tx, transition.runId)
    if (!receipt) {
      throw new MigrationRunError(
        'E_RECEIPT_MISSING',
        `No import receipt exists for run ${transition.runId}; nothing to verify.`
      )
    }
    requireCurrentFence(gate, receipt, transition.runId, namespace)
    if (receipt.state === 'verified') {
      // Idempotent: verifying the same committed run twice is not an error.
      return { runId: transition.runId, state: 'verified' as const, targetNamespace: receipt.targetNamespace }
    }
    if (receipt.state !== 'data-committed') {
      throw new MigrationRunError(
        'E_PUBLICATION_STATE',
        `Run ${transition.runId} is ${receipt.state}; verification is only recorded for a data-committed run.`
      )
    }
    await tx.query("update public.migration_runs set state = 'verified' where run_id = $1", [transition.runId])
    return { runId: transition.runId, state: 'verified' as const, targetNamespace: receipt.targetNamespace }
  })
  return { ...result, actor: transition.actor, reason: transition.reason }
}

/** Record publication intent durably. No gate is opened by this step. */
export async function recordPublicationIntent(
  session: WriteSession,
  transition: PublicationTransition
): Promise<PublicationResult> {
  requireFields(transition)
  const namespace = (await session.identity()).namespace
  const result = await session.transaction(async (tx) => {
    const gate = await lockGate(tx)
    const receipt = await lockReceipt(tx, transition.runId)
    if (!receipt) {
      throw new MigrationRunError(
        'E_RECEIPT_MISSING',
        `No import receipt exists for run ${transition.runId}; there is nothing to publish.`
      )
    }
    requireCurrentFence(gate, receipt, transition.runId, namespace)
    if (receipt.state !== 'verified') {
      throw new MigrationRunError(
        'E_PUBLICATION_STATE',
        `Run ${transition.runId} is ${receipt.state}; publication intent requires a verified receipt.`
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
  const namespace = (await session.identity()).namespace
  const result = await session.transaction(async (tx) => {
    const gate = await lockGate(tx)
    if (!gate) {
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
    if (receipt.targetNamespace !== namespace) {
      throw new MigrationRunError('E_TARGET_MISMATCH', `Run ${transition.runId} belongs to ${receipt.targetNamespace}, not ${namespace}.`)
    }
    if (receipt.state === 'writable') {
      // The response may have been lost after the admission committed. A retry
      // must not report a state error for work that already succeeded; it
      // confirms the durable outcome instead.
      if (gate.state === 'open' && gate.runId === transition.runId) {
        return { runId: transition.runId, state: 'writable' as const, targetNamespace: receipt.targetNamespace }
      }
      throw new MigrationRunError(
        'E_PUBLICATION_STATE',
        `Run ${transition.runId} is already writable but the gate does not match it; investigate before admitting anything.`
      )
    }
    if (receipt.state !== 'publication-intent') {
      throw new MigrationRunError(
        'E_PUBLICATION_STATE',
        `Run ${transition.runId} is ${receipt.state}; writers can only be admitted from a recorded publication intent.`
      )
    }
    requireCurrentFence(gate, receipt, transition.runId, namespace)
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
