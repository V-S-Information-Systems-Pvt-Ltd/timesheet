import 'server-only'

import { AsyncLocalStorage } from 'node:async_hooks'

// lib/idempotency-key.ts
// Ambient idempotency scope for keyed offline mutations (T19.2).
//
// `withIdempotency` (lib/idempotency.ts) establishes the scope around the
// business mutation. In Supabase mode, adapters forward the key and operation
// as PostgREST request headers; an AFTER trigger records immutable effect
// evidence in the same transaction as the business write. That evidence turns
// a repeat delivery into a ledger-backed replay without re-executing. Unkeyed
// requests observe no scope and take byte-identical paths.
//
// The scope carries request identity only (key + operation name). It never
// carries cookies, tokens, or authorization decisions: actor scoping stays in
// the adapter predicates and RLS, exactly as for unkeyed writes. This mirrors
// the existing transaction-context precedent in lib/db/pool.ts.

export interface IdempotencyScope {
  key: string
  operation: string
  /**
   * Recovery probe: prove prior application from immutable effect evidence
   * without writing.
   * Set only when the ledger cannot prove the outcome (committed-unknown).
   * Adapters must not mutate business rows under a recovery scope.
   */
  recoverOnly?: boolean
}

/**
 * Offline-queued operations whose deliveries must be effect-idempotent.
 * Deliberately closed: batch and duplicate routes carry their own ledger
 * entries and response contracts (per-row results, created entry DTOs) that a
 * generic stamp-recovery response could not rebuild, so they keep
 * ledger-replay-only semantics.
 */
const STAMPED_OPERATIONS: ReadonlySet<string> = new Set([
  'create_timesheet',
  'update_timesheet',
  'delete_timesheet',
  'create_leave',
  'delete_leave',
  'create_reminder',
  'update_reminder',
  'delete_reminder',
])

/** Thrown by adapters on positive evidence of prior application. Never serialized. */
export class DuplicateDeliveryError extends Error {
  readonly operation: string
  readonly key: string

  constructor(operation: string, key: string) {
    super(`Idempotency key already applied for operation ${operation}.`)
    this.name = 'DuplicateDeliveryError'
    this.operation = operation
    this.key = key
  }
}

/**
 * Thrown by adapters in a recovery scope when row evidence cannot prove prior
 * application (e.g. the target is gone without a stamp). Maps to
 * 409 IDEMPOTENCY_COMMIT_UNKNOWN so the work is preserved for manual review
 * instead of being silently dropped or blindly re-executed.
 */
export class UnrecoverableDeliveryError extends Error {
  readonly operation: string
  readonly key: string

  constructor(operation: string, key: string) {
    super(`Idempotency key outcome cannot be proven for operation ${operation}.`)
    this.name = 'UnrecoverableDeliveryError'
    this.operation = operation
    this.key = key
  }
}

/**
 * Thrown by Supabase adapters when the immutable effect shows the key was
 * already committed for a DIFFERENT payload. Maps to
 * 409 IDEMPOTENCY_CONFLICT so the client keeps the mutation in a visible
 * failed state instead of silently accepting a different payload.
 */
export class IdempotencyConflictError extends Error {
  readonly operation: string
  readonly key: string

  constructor(operation: string, key: string) {
    super(`Idempotency key reused with a different payload for operation ${operation}.`)
    this.name = 'IdempotencyConflictError'
    this.operation = operation
    this.key = key
  }
}

const scopeStorage = new AsyncLocalStorage<IdempotencyScope>()

/** Establish the ambient scope for one keyed mutation delivery. */
export function runWithIdempotencyScope<T>(scope: IdempotencyScope, fn: () => T): T {
  return scopeStorage.run(scope, fn)
}

/** Current scope, or null for unkeyed requests and non-idempotent paths. */
export function getIdempotencyScope(): IdempotencyScope | null {
  return scopeStorage.getStore() ?? null
}

/**
 * Active effect scope, or null when immutable effect recording must not
 * apply: unkeyed requests, non-queued operations (batch/duplicate keep
 * ledger-only semantics), and empty keys.
 */
export function getStampScope(): IdempotencyScope | null {
  const scope = getIdempotencyScope()
  if (!scope || scope.key.trim().length === 0) return null
  if (!STAMPED_OPERATIONS.has(scope.operation)) return null
  return scope
}

/** Whether deliveries of this operation have immutable effect evidence. */
export function isStampedOperation(operation: string): boolean {
  return STAMPED_OPERATIONS.has(operation)
}
