// app/actions/timesheets.ts
// Server Actions for timesheet entry operations.
'use server'

import { addDaysISO, todayISO } from '@/lib/dates'
import { isValidISODate } from '@/lib/validation'
import { parseSchema, timesheetMutationSchema, logYesterdaySchema } from '@/lib/validation-schemas'
import { timesheetDeps } from '@/lib/db/timesheets'
import {
  type ActionResult,
  requireMutatingActiveActor,
} from './_shared'
import {
  createTimesheetEntry,
  updateTimesheetEntry,
  deleteTimesheetEntry,
  duplicateTimesheetEntry,
  deleteLastTimesheetEntryDomain,
  bulkUpdateTimesheetsDomain,
  type DomainTimesheetInput,
  type BulkUpdateTimesheetItem,
} from '@/lib/domain/timesheets'

export async function logEntry(input: DomainTimesheetInput): Promise<ActionResult> {
  const gate = await requireMutatingActiveActor()
  if ('error' in gate) return { error: gate.error }
  const actor = gate.actor

  const parsed = parseSchema(timesheetMutationSchema, input)
  if (!parsed.ok) return { error: parsed.error.error, fieldErrors: parsed.error.fieldErrors }

  const result = await createTimesheetEntry(
    actor,
    {
      ...parsed.data,
      userId: actor.id,
    },
    timesheetDeps()
  )

  if (!result.ok) {
    return { error: result.error.message }
  }
  return {}
}

/**
 * Duplicate an existing entry: copy its project/activity/hours/description as a
 * new row for the same user. By default the copy lands on the source entry's
 * date; pass `targetDate` (YYYY-MM-DD) to duplicate onto a chosen day. Same
 * rules as logging: non-admins must be inside the backfill window and the day's
 * total must stay at or under 24h.
 */
export async function duplicateEntry(entryId: string, targetDate?: string): Promise<ActionResult> {
  const gate = await requireMutatingActiveActor()
  if ('error' in gate) return { error: gate.error }
  const actor = gate.actor

  if (targetDate !== undefined && !isValidISODate(targetDate)) {
    return { error: 'Invalid date. Use YYYY-MM-DD.' }
  }

  const result = await duplicateTimesheetEntry(actor, entryId, targetDate, timesheetDeps())
  if (!result.ok) {
    if (result.error.code === 'NOT_FOUND') return { error: 'Entry not found.' }
    if (result.error.code === 'FORBIDDEN') return { error: 'You can only duplicate your own entries.' }
    return { error: result.error.message }
  }
  return {}
}

export async function logYesterday(input: Omit<DomainTimesheetInput, 'logDate'>): Promise<ActionResult> {
  const gate = await requireMutatingActiveActor()
  if ('error' in gate) return { error: gate.error }
  const actor = gate.actor

  const parsed = parseSchema(logYesterdaySchema, input)
  if (!parsed.ok) return { error: parsed.error.error, fieldErrors: parsed.error.fieldErrors }

  const today = todayISO()
  const yesterdayStr = addDaysISO(today, -1)

  const result = await createTimesheetEntry(
    actor,
    {
      ...parsed.data,
      logDate: yesterdayStr,
    },
    timesheetDeps()
  )

  if (!result.ok) {
    if (result.error.code === 'FORBIDDEN') {
      return { error: 'Only admins can backfill for other users.' }
    }
    if (result.error.code === 'OUTSIDE_WINDOW') {
      return { error: 'Yesterday is outside the writable backfill window.' }
    }
    if (result.error.code === 'DAILY_HOURS_EXCEEDED') {
      return {
        error: `Daily total would exceed 24 hours (${result.error.details?.currentTotal}h already logged for yesterday).`,
      }
    }
    return { error: result.error.message }
  }
  return {}
}

export async function deleteLastEntry(): Promise<ActionResult> {
  const gate = await requireMutatingActiveActor()
  if ('error' in gate) return { error: gate.error }
  const actor = gate.actor

  const result = await deleteLastTimesheetEntryDomain(actor, timesheetDeps())
  if (!result.ok) {
    return { error: result.error.message }
  }
  return {}
}

export async function updateTimesheet(
  entryId: string,
  input: DomainTimesheetInput
): Promise<ActionResult> {
  const gate = await requireMutatingActiveActor()
  if ('error' in gate) return { error: gate.error }
  const actor = gate.actor

  const parsed = parseSchema(timesheetMutationSchema, input)
  if (!parsed.ok) return { error: parsed.error.error, fieldErrors: parsed.error.fieldErrors }

  const result = await updateTimesheetEntry(
    actor,
    entryId,
    parsed.data,
    timesheetDeps()
  )

  if (!result.ok) {
    if (result.error.code === 'NOT_FOUND') return { error: 'Entry not found.' }
    if (result.error.code === 'FORBIDDEN') return { error: 'You can only modify your own entries.' }
    return { error: result.error.message }
  }
  return {}
}

export async function deleteTimesheet(entryId: string): Promise<ActionResult> {
  const gate = await requireMutatingActiveActor()
  if ('error' in gate) return { error: gate.error }
  const actor = gate.actor

  const result = await deleteTimesheetEntry(actor, entryId, timesheetDeps())
  if (!result.ok) {
    if (result.error.code === 'NOT_FOUND') return { error: 'Entry not found.' }
    if (result.error.code === 'FORBIDDEN') return { error: 'You can only delete your own entries.' }
    return { error: result.error.message }
  }
  return {}
}

/**
 * Bulk-edit a batch of timesheet entries (project / activity type change).
 * Validates and applies every row with the same rules as `updateTimesheet`,
 * but charges the per-user write budget ONCE for the whole batch and reports
 * per-row errors so the UI can tell the user which rows failed.
 */
export async function bulkUpdateTimesheets(
  entries: BulkUpdateTimesheetItem[]
): Promise<ActionResult & { updated?: number; errors?: string[] }> {
  const gate = await requireMutatingActiveActor()
  if ('error' in gate) return { error: gate.error }
  const actor = gate.actor

  if (!Array.isArray(entries) || entries.length === 0) return { error: 'No entries selected.' }
  if (entries.length > 500) return { error: 'Too many entries for one edit (max 500).' }

  const result = await bulkUpdateTimesheetsDomain(actor, entries, timesheetDeps())
  if (!result.ok) {
    return { error: result.error.message }
  }

  const { updated, errors } = result.data
  return {
    error: errors && errors.length > 0 && updated === 0 ? 'All edits failed.' : undefined,
    updated,
    errors: errors && errors.length > 0 ? errors : undefined,
  }
}
