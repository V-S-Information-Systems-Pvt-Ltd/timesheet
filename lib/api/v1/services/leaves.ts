import { repo } from '@/lib/db'
import type { Actor } from '@/lib/db/repository'
import type { LeafQuery } from '@/lib/data/client'
import { parseSchema, leaveQuerySchema, leaveRowsSchema } from '@/lib/validation-schemas'
import { withServiceWriteBudget } from './_write-budget'
import { isSuccessful, rateLimitedResult, type MobileServiceResult } from './_result'

const writeRateLimited = rateLimitedResult<{ success: boolean }>

export async function getLeavesService(
  actor: Actor,
  queryParams: Record<string, unknown>
): Promise<MobileServiceResult<unknown>> {
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
): Promise<MobileServiceResult<{ success: boolean }>> {
  return withServiceWriteBudget(
    actor.id,
    writeRateLimited,
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
    isSuccessful
  )
}

export async function deleteLeaveService(
  actor: Actor,
  id: string
): Promise<MobileServiceResult<{ success: boolean }>> {
  return withServiceWriteBudget(
    actor.id,
    writeRateLimited,
    async () => {
      const result = await repo.deleteLeave(actor, id)
      if (result.error) {
        return { success: false as const, code: 'DB_ERROR', message: result.error, status: 400 }
      }

      return { success: true as const, data: { success: true } }
    },
    isSuccessful
  )
}
