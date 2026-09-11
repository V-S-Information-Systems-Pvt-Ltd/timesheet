import { repo } from '@/lib/db'
import type { Actor } from '@/lib/db/repository'
import { parseSchema, reminderSchema } from '@/lib/validation-schemas'
import { withServiceWriteBudget } from './_write-budget'
import type { MobileServiceResult } from './_result'

function rateLimited(message: string): MobileServiceResult<{ success: boolean }> {
  return { success: false, code: 'RATE_LIMITED', message, status: 429 }
}

/** Only a successful write keeps the reserved slot. */
function chargeable(result: MobileServiceResult<{ success: boolean }>): boolean {
  return result.success
}

export async function listRemindersService(actor: Actor): Promise<MobileServiceResult<unknown>> {
  const data = await repo.listReminders(actor, actor.id)
  return { success: true, data }
}

export async function createReminderService(
  actor: Actor,
  rawBody: unknown
): Promise<MobileServiceResult<{ success: boolean }>> {
  return withServiceWriteBudget(
    actor.id,
    rateLimited,
    async () => {
      const parsed = parseSchema(reminderSchema, {
        message: (rawBody as { message?: unknown })?.message,
        remindAt: (rawBody as { remindAt?: unknown })?.remindAt,
      })
      if (!parsed.ok) {
        return { success: false as const, code: 'VALIDATION_ERROR', message: parsed.error.error, status: 400 }
      }

      const result = await repo.createReminder(actor, {
        userId: actor.id,
        message: parsed.data.message,
        remindAt: new Date(parsed.data.remindAt).toISOString(),
      })

      if (result.error) {
        return { success: false as const, code: 'DB_ERROR', message: result.error, status: 400 }
      }

      return { success: true as const, data: { success: true }, status: 201 }
    },
    chargeable
  )
}

export async function updateReminderService(
  actor: Actor,
  id: string,
  rawBody: unknown
): Promise<MobileServiceResult<{ success: boolean }>> {
  return withServiceWriteBudget(
    actor.id,
    rateLimited,
    async () => {
      const done = Boolean((rawBody as { done?: unknown })?.done)
      const result = await repo.updateReminder(actor, id, { done })
      if (result.error) {
        return { success: false as const, code: 'DB_ERROR', message: result.error, status: 400 }
      }

      return { success: true as const, data: { success: true } }
    },
    chargeable
  )
}

export async function deleteReminderService(
  actor: Actor,
  id: string
): Promise<MobileServiceResult<{ success: boolean }>> {
  return withServiceWriteBudget(
    actor.id,
    rateLimited,
    async () => {
      const result = await repo.deleteReminder(actor, id)
      if (result.error) {
        return { success: false as const, code: 'DB_ERROR', message: result.error, status: 400 }
      }

      return { success: true as const, data: { success: true } }
    },
    chargeable
  )
}
