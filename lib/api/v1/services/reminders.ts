import { repo } from '@/lib/db'
import type { Actor } from '@/lib/db/repository'
import { parseSchema, reminderSchema } from '@/lib/validation-schemas'

export type ServiceResult<T> =
  | { success: true; data: T; status?: number }
  | { success: false; code: string; message: string; status: number }

export async function listRemindersService(actor: Actor): Promise<ServiceResult<unknown>> {
  const data = await repo.listReminders(actor, actor.id)
  return { success: true, data }
}

export async function createReminderService(
  actor: Actor,
  rawBody: unknown
): Promise<ServiceResult<{ success: boolean }>> {
  const parsed = parseSchema(reminderSchema, {
    message: (rawBody as { message?: unknown })?.message,
    remindAt: (rawBody as { remindAt?: unknown })?.remindAt,
  })
  if (!parsed.ok) {
    return { success: false, code: 'VALIDATION_ERROR', message: parsed.error.error, status: 400 }
  }

  const result = await repo.createReminder(actor, {
    userId: actor.id,
    message: parsed.data.message,
    remindAt: new Date(parsed.data.remindAt).toISOString(),
  })

  if (result.error) {
    return { success: false, code: 'DB_ERROR', message: result.error, status: 400 }
  }

  return { success: true, data: { success: true }, status: 201 }
}

export async function updateReminderService(
  actor: Actor,
  id: string,
  rawBody: unknown
): Promise<ServiceResult<{ success: boolean }>> {
  const done = Boolean((rawBody as { done?: unknown })?.done)
  const result = await repo.updateReminder(actor, id, { done })
  if (result.error) {
    return { success: false, code: 'DB_ERROR', message: result.error, status: 400 }
  }

  return { success: true, data: { success: true } }
}

export async function deleteReminderService(
  actor: Actor,
  id: string
): Promise<ServiceResult<{ success: boolean }>> {
  const result = await repo.deleteReminder(actor, id)
  if (result.error) {
    return { success: false, code: 'DB_ERROR', message: result.error, status: 400 }
  }

  return { success: true, data: { success: true } }
}
