import 'server-only'

import { reserveWriteRateLimit } from '@/lib/rate-limit'

/**
 * Application-owned write-budget dependency. The timesheet module reserves one
 * per-user slot per operation (or per batch) and releases it unless the write
 * turned out to be chargeable, so exactly one charge decision happens inside the
 * application boundary rather than once per transport.
 */
export interface WriteBudgetReservation {
  release: () => Promise<void>
}

export type WriteBudgetReserveResult =
  | { ok: true; reservation: WriteBudgetReservation }
  | { ok: false; error: string; retryAfter?: number }

export interface WriteBudget {
  reserve(actorId: string): Promise<WriteBudgetReserveResult>
}

/** Production budget backed by the database/local rate-limit store. */
export const dailyWriteBudget: WriteBudget = {
  async reserve(actorId) {
    const result = await reserveWriteRateLimit(actorId)
    if (!result.ok) return { ok: false, error: result.error, retryAfter: result.retryAfter }
    return { ok: true, reservation: result.reservation }
  },
}

export type WriteBudgetOutcome<T> =
  | { ok: true; result: T }
  | { ok: false; error: string; retryAfter?: number }

/**
 * Run a guarded write once, holding the reserved slot for its duration.
 *
 * The slot is released unless `isChargeable` says the work counted, so
 * validation failures, permission rejections, no-op batches and thrown errors
 * all cost nothing and cannot leak a reservation.
 */
export async function runWithWriteBudget<T>(
  budget: WriteBudget,
  actorId: string,
  run: () => Promise<T>,
  isChargeable: (result: T) => boolean
): Promise<WriteBudgetOutcome<T>> {
  const reserved = await budget.reserve(actorId)
  if (!reserved.ok) return reserved

  let chargeable = false
  try {
    const result = await run()
    chargeable = isChargeable(result)
    return { ok: true, result }
  } finally {
    if (!chargeable) await reserved.reservation.release()
  }
}
