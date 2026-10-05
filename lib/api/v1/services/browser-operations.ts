import 'server-only'

import type { BackupPayload } from '@/app/types'
import { operationsDeps } from '@/lib/db/operations'
import type { Actor } from '@/lib/db/types'
import { deleteUserTimesheetsData, exportBackupData } from '@/lib/domain/operations'
import type { MobileServiceResult } from './_result'

function failure<T>(error: { code: string; message: string }): MobileServiceResult<T> {
  return {
    success: false,
    code: error.code,
    message: error.message,
    status: error.code === 'FORBIDDEN' ? 403 : error.code === 'STORAGE_ERROR' ? 500 : 400,
  }
}

export async function exportBackupBrowser(
  actor: Actor
): Promise<MobileServiceResult<BackupPayload | null>> {
  const outcome = await exportBackupData(actor, operationsDeps())
  if (!outcome.ok) return failure(outcome.error)
  if (outcome.data.error) {
    return { success: false, code: 'STORAGE_ERROR', message: outcome.data.error, status: 500 }
  }
  return { success: true, data: outcome.data.payload }
}

export async function deleteUserTimesheetsBrowser(
  actor: Actor,
  userId: string
): Promise<MobileServiceResult<{ success: true }>> {
  const outcome = await deleteUserTimesheetsData(actor, userId, operationsDeps())
  return outcome.ok
    ? { success: true, data: { success: true } }
    : failure(outcome.error)
}
