import 'server-only'

import { reserveWriteRateLimit } from '@/lib/rate-limit'

// lib/api/v1/services/_write-budget.ts
// Shared write-budget wrapper for the v1 mobile services.
//
// Mirrors withWriteBudget in app/actions/_shared.ts: the per-user daily slot is
// reserved atomically before the guarded work runs, and released unless the work
// turned out to be chargeable. Because the release happens in a `finally`, a
// thrown error cannot leak a slot the way an early `return` before the old
// `consumeWriteRateLimit` call could.

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
  const gate = await reserveWriteRateLimit(actorId)
  if (!gate.ok) return onLimited(gate.error)

  let chargeable = false
  try {
    const result = await run()
    chargeable = isChargeable(result)
    return result
  } finally {
    if (!chargeable) await gate.reservation.release()
  }
}
