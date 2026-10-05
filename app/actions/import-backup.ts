// app/actions/import-backup.ts
// Server Actions for CSV timesheet imports and database backup/restore.
'use server'

import { operationsDeps } from '@/lib/db/operations'
import {
  deleteUserTimesheetsData,
  exportBackupData,
  restoreBackupFromJson,
} from '@/lib/domain/operations'
import { importTimesheetsForActor } from '@/lib/import-timesheets'
import type { CsvTimesheetRow } from '@vsis/contracts'
import type { BackupCreatedCounts, BackupPayload } from '@/app/types'
import { type ActionResult, requireActor, requireMutatingActor } from './_shared'

export type { CsvTimesheetRow } from '@vsis/contracts'

/** Admin: delete all timesheet entries belonging to a user (deactivate flow). */
export async function deleteUserTimesheets(userId: string): Promise<ActionResult> {
  const gate = await requireMutatingActor(['admin'])
  if ('error' in gate) return { error: gate.error }

  const result = await deleteUserTimesheetsData(gate.actor, userId, operationsDeps())
  return result.ok ? {} : { error: result.error.message }
}

/** Admin: import timesheet rows; unknown references and bad rows are reported. */
export async function importTimesheets(
  rows: CsvTimesheetRow[]
): Promise<ActionResult & { imported?: number; skipped?: number; errors?: string[] }> {
  const gate = await requireMutatingActor(['admin'])
  if ('error' in gate) return { error: gate.error }
  return importTimesheetsForActor(gate.actor, rows)
}

const MAX_BACKUP_SIZE = 20 * 1024 * 1024 // 20 MB

/** Admin: export all work data as a backup payload (JSON). */
export async function exportBackup(): Promise<{ payload: BackupPayload | null; error?: string }> {
  const gate = await requireActor(['admin'])
  if ('error' in gate) return { payload: null, error: gate.error }

  const outcome = await exportBackupData(gate.actor, operationsDeps())
  if (!outcome.ok) return { payload: null, error: outcome.error.message }
  return { payload: outcome.data.payload, error: outcome.data.error ?? undefined }
}

/** Admin: validate a backup JSON document and merge it into the database. */
export async function restoreBackup(
  json: string
): Promise<
  ActionResult & {
    created?: BackupCreatedCounts
    skipped?: number
  }
> {
  const gate = await requireMutatingActor(['admin'])
  if ('error' in gate) return { error: gate.error }

  if (typeof json !== 'string' || json.length === 0) return { error: 'No backup file selected.' }
  if (json.length > MAX_BACKUP_SIZE) return { error: 'Backup file is too large.' }

  // Parse, validate and atomically restore through the operations coordinator.
  // The whole restore is one provider transaction; a failure returns no counts.
  const outcome = await restoreBackupFromJson(gate.actor, json, operationsDeps())
  if (!outcome.ok) return { error: outcome.error.message }
  return {
    created: outcome.data.created,
    skipped: outcome.data.skipped,
  }
}
