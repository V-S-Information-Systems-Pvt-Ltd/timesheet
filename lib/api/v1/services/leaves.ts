import { repo } from '@/lib/db'
import type { Actor } from '@/lib/db/repository'
import type { LeafQuery } from '@/lib/data/client'
import { parseSchema, leaveQuerySchema, leaveRowsSchema } from '@/lib/validation-schemas'
import { withServiceWriteBudget } from './_write-budget'

export type ServiceResult<T> =
  | { success: true; data: T; status?: number }
  | { success: false; code: string; message: string; status: number }

function rateLimited(message: string): ServiceResult<{ success: boolean }> {
  return { success: false, code: 'RATE_LIMITED', message, status: 429 }
}

/** Only a successful write keeps the reserved slot. */
function chargeable(result: ServiceResult<{ success: boolean }>): boolean {
  return result.success
}

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
  return withServiceWriteBudget(
    actor.id,
    rateLimited,
    async () => {
      const parsed = parseSchema(leaveRowsSchema, (rawBody as { rows?: unknown })?.rows ?? rawBody)
      if (!parsed.ok) {
        return { success: false as const, code: 'VALIDATION_ERROR', message: parsed.error.error, status: 400 }
      }

      const result = await repo.createLeaves(actor, parsed.data)
      if (result.error) {
        return { success: false as const, code: 'DB_ERROR', message: result.error, status: 400 }
      }

      return { success: true as const, data: { success: true }, status: 201 }
    },
    chargeable
  )
}

export async function deleteLeaveService(
  actor: Actor,
  id: string
): Promise<ServiceResult<{ success: boolean }>> {
  return withServiceWriteBudget(
    actor.id,
    rateLimited,
    async () => {
      const result = await repo.deleteLeave(actor, id)
      if (result.error) {
        return { success: false as const, code: 'DB_ERROR', message: result.error, status: 400 }
      }

      return { success: true as const, data: { success: true } }
    },
    chargeable
  )
}
