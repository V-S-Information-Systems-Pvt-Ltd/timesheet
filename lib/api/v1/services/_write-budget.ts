import 'server-only'

import { dailyWriteBudget, runWithWriteBudget } from '@/lib/domain/write-budget'

// lib/api/v1/services/_write-budget.ts
// Service-shaped adapter over the shared write-budget core. The per-user daily
// slot is reserved atomically before the guarded work runs and released unless
// the work turned out to be chargeable; a thrown error cannot leak a slot
// because the release happens in the core's `finally`. Timesheet operations are
// charged inside the application module instead; this adapter remains for the
// domains that have not migrated yet.

/**
 * @param actorId    Subject of the budget.
 * @param onLimited  Builds the service-shaped rejection for a 429.
 * @param run        The guarded work.
 * @param isChargeable Whether the result should keep the reserved slot.
 */
export async function withServiceWriteBudget<T>(
  actorId: string,
  onLimited: (message: string) => T,
  run: () => Promise<T>,
  isChargeable: (result: T) => boolean
): Promise<T> {
  const outcome = await runWithWriteBudget(dailyWriteBudget, actorId, run, isChargeable)
  if (!outcome.ok) return onLimited(outcome.error)
  return outcome.result
}
