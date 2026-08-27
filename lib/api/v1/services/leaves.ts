import { repo } from '@/lib/db'
import type { Actor } from '@/lib/db/repository'
import type { LeafQuery } from '@/lib/data/client'
import { parseSchema, leaveQuerySchema, leaveRowsSchema } from '@/lib/validation-schemas'
import { peekWriteRateLimit, consumeWriteRateLimit } from '@/lib/rate-limit'

export type ServiceResult<T> =
  | { success: true; data: T; status?: number }
  | { success: false; code: string; message: string; status: number }

export async function getLeavesService(
  actor: Actor,
  queryParams: Record<string, unknown>
): Promise<ServiceResult<unknown>> {
  const parsed = parseSchema(leaveQuerySchema, queryParams)
  if (!parsed.ok) {
    return { success: false, code: 'VALIDATION_ERROR', message: parsed.error.error, status: 400 }
  }

  const opts: LeafQuery = parsed.data
  const data = await repo.listLeaves(actor, opts)
  return { success: true, data }
}

export async function createLeavesService(
  actor: Actor,
  rawBody: unknown
): Promise<ServiceResult<{ success: boolean }>> {
  const rate = peekWriteRateLimit(actor.id)
  if (!rate.ok) {
    return { success: false, code: 'RATE_LIMITED', message: rate.error, status: 429 }
  }

  const parsed = parseSchema(leaveRowsSchema, (rawBody as { rows?: unknown })?.rows ?? rawBody)
  if (!parsed.ok) {
    return { success: false, code: 'VALIDATION_ERROR', message: parsed.error.error, status: 400 }
  }

  const result = await repo.createLeaves(actor, parsed.data)
  if (result.error) {
    return { success: false, code: 'DB_ERROR', message: result.error, status: 400 }
  }

  consumeWriteRateLimit(actor.id)
  return { success: true, data: { success: true }, status: 201 }
}

export async function deleteLeaveService(
  actor: Actor,
  id: string
): Promise<ServiceResult<{ success: boolean }>> {
  const rate = peekWriteRateLimit(actor.id)
  if (!rate.ok) {
    return { success: false, code: 'RATE_LIMITED', message: rate.error, status: 429 }
  }

  const result = await repo.deleteLeave(actor, id)
  if (result.error) {
    return { success: false, code: 'DB_ERROR', message: result.error, status: 400 }
  }

  consumeWriteRateLimit(actor.id)
  return { success: true, data: { success: true } }
}
