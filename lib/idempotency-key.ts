import 'server-only'

import { AsyncLocalStorage } from 'node:async_hooks'

// lib/idempotency-key.ts
// Ambient idempotency scope for keyed offline mutations (T19.2).
//
// `withIdempotency` (lib/idempotency.ts) establishes the scope around the
// business mutation so code running inside it can observe the key and
// operation name. Unkeyed requests observe no scope.
//
// The scope carries request identity only (key + operation name). It never
// carries cookies, tokens, or authorization decisions: actor scoping stays in
// the adapter SQL predicates, exactly as for unkeyed writes. This mirrors
// the existing transaction-context precedent in lib/db/pool.ts.

export interface IdempotencyScope {
  key: string
  operation: string
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
