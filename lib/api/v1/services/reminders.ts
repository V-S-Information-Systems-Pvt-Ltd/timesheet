import type { Actor } from '@/lib/db/repository'
import { leaveReminderDeps } from '@/lib/db/leave-reminders'
import {
  listReminders,
  createReminder,
  updateReminder,
  deleteReminder,
  type LeaveReminderDomainError,
} from '@/lib/domain/leave-reminders'
import type { MobileServiceResult } from './_result'

/** Map a leave/reminders domain error to the versioned `/api/v1` envelope. */
function mapDomainError<T>(err: LeaveReminderDomainError): MobileServiceResult<T> {
  switch (err.code) {
    case 'RATE_LIMITED':
      return { success: false, code: 'RATE_LIMITED', message: err.message, status: 429 }
    case 'FORBIDDEN':
      return { success: false, code: 'FORBIDDEN', message: err.message, status: 403 }
    case 'STORAGE_ERROR':
      return { success: false, code: 'DB_ERROR', message: err.message, status: 400 }
    case 'VALIDATION_ERROR':
    default:
      return { success: false, code: 'VALIDATION_ERROR', message: err.message, status: 400 }
  }
}

export async function listRemindersService(actor: Actor): Promise<MobileServiceResult<unknown>> {
  const result = await listReminders(actor, leaveReminderDeps())
  if (!result.ok) return mapDomainError(result.error)
  return { success: true, data: result.data }
}

export async function createReminderService(
  actor: Actor,
  rawBody: unknown
): Promise<MobileServiceResult<{ success: boolean }>> {
  const result = await createReminder(
    actor,
    {
      message: (rawBody as { message?: unknown })?.message,
      remindAt: (rawBody as { remindAt?: unknown })?.remindAt,
    },
    leaveReminderDeps()
  )
  if (!result.ok) return mapDomainError(result.error)
  return { success: true, data: { success: true }, status: 201 }
}

export async function updateReminderService(
  actor: Actor,
  id: string,
  rawBody: unknown
): Promise<MobileServiceResult<{ success: boolean }>> {
  const result = await updateReminder(
    actor,
    id,
    { done: (rawBody as { done?: unknown })?.done },
    leaveReminderDeps()
  )
  if (!result.ok) return mapDomainError(result.error)
  return { success: true, data: { success: true } }
}

export async function deleteReminderService(
  actor: Actor,
  id: string
): Promise<MobileServiceResult<{ success: boolean }>> {
  const result = await deleteReminder(actor, id, leaveReminderDeps())
  if (!result.ok) return mapDomainError(result.error)
  return { success: true, data: { success: true } }
}
