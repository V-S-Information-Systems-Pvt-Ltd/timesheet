// app/actions/timesheets.ts
// Server Actions for timesheet entry operations.
'use server'

import { addDaysISO, todayISO } from '@/lib/dates'
import { parseSchema, logEntrySchema, logYesterdaySchema } from '@/lib/validation-schemas'
import {
  type ActionResult,
  requireActiveActor,
  withWriteBudget,
} from './_shared'
import {
  createTimesheetEntry,
  updateTimesheetEntry,
  deleteTimesheetEntry,
  duplicateTimesheetEntry,
  deleteLastTimesheetEntryDomain,
  bulkUpdateTimesheetsDomain,
} from '@/lib/domain/timesheets'

export async function logEntry(input: {
  projectId: string
  activityTypeId: string
  hoursWorked: number
  workDone: string
  logDate: string
}): Promise<ActionResult> {
  const gate = await requireActiveActor()
  if ('error' in gate) return { error: gate.error }
  const actor = gate.actor

  return withWriteBudget(actor, async () => {
    const parsed = parseSchema(logEntrySchema, input)
    if (!parsed.ok) return { error: parsed.error.error, fieldErrors: parsed.error.fieldErrors }

    const result = await createTimesheetEntry(actor, {
      userId: actor.id,
      projectId: parsed.data.projectId,
      activityTypeId: parsed.data.activityTypeId,
      hoursWorked: parsed.data.hoursWorked,
      workDone: parsed.data.workDone,
      logDate: parsed.data.logDate,
    })

    if (!result.ok) {
      return { error: result.error.message }
    }
    return {}
  })
}

/**
 * Duplicate an existing entry: copy its project/activity/date/hours/description
 * as a new row for the same user. Same rules as logging: non-admins must be
 * inside the backfill window and the day's total must stay at or under 24h.
 */
export async function duplicateEntry(entryId: string): Promise<ActionResult> {
  const gate = await requireActiveActor()
  if ('error' in gate) return { error: gate.error }
  const actor = gate.actor

  return withWriteBudget(actor, async () => {
    const result = await duplicateTimesheetEntry(actor, entryId)
    if (!result.ok) {
      if (result.error.code === 'NOT_FOUND') return { error: 'Entry not found.' }
      if (result.error.code === 'FORBIDDEN') return { error: 'You can only duplicate your own entries.' }
      return { error: result.error.message }
    }
    return {}
  })
}

export async function logYesterday(input: {
  projectId: string
  activityTypeId: string
  hoursWorked: number
  workDone: string
  userId?: string
}): Promise<ActionResult> {
  const gate = await requireActiveActor()
  if ('error' in gate) return { error: gate.error }
  const actor = gate.actor

  return withWriteBudget(actor, async () => {
    const parsed = parseSchema(logYesterdaySchema, input)
    if (!parsed.ok) return { error: parsed.error.error, fieldErrors: parsed.error.fieldErrors }

    const today = todayISO()
    const yesterdayStr = addDaysISO(today, -1)

    const result = await createTimesheetEntry(actor, {
      userId: input.userId,
      projectId: parsed.data.projectId,
      activityTypeId: parsed.data.activityTypeId,
      hoursWorked: parsed.data.hoursWorked,
      workDone: parsed.data.workDone,
      logDate: yesterdayStr,
    })

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
  })
}

export async function deleteLastEntry(): Promise<ActionResult> {
  const gate = await requireActiveActor()
  if ('error' in gate) return { error: gate.error }
  const actor = gate.actor

  return withWriteBudget(actor, async () => {
    const result = await deleteLastTimesheetEntryDomain(actor)
    if (!result.ok) {
      return { error: result.error.message }
    }
    return {}
  })
}

export async function updateTimesheet(
  entryId: string,
  input: {
    projectId: string
    activityTypeId: string
    hoursWorked: number
    workDone: string
    logDate: string
  }
): Promise<ActionResult> {
  const gate = await requireActiveActor()
  if ('error' in gate) return { error: gate.error }
  const actor = gate.actor

  return withWriteBudget(actor, async () => {
    const parsed = parseSchema(logEntrySchema, input)
    if (!parsed.ok) return { error: parsed.error.error, fieldErrors: parsed.error.fieldErrors }

    const result = await updateTimesheetEntry(actor, entryId, {
      projectId: parsed.data.projectId,
      activityTypeId: parsed.data.activityTypeId,
      hoursWorked: parsed.data.hoursWorked,
      workDone: parsed.data.workDone,
      logDate: parsed.data.logDate,
    })

    if (!result.ok) {
      if (result.error.code === 'NOT_FOUND') return { error: 'Entry not found.' }
      if (result.error.code === 'FORBIDDEN') return { error: 'You can only modify your own entries.' }
      return { error: result.error.message }
    }
    return {}
  })
}

export async function deleteTimesheet(entryId: string): Promise<ActionResult> {
  const gate = await requireActiveActor()
  if ('error' in gate) return { error: gate.error }
  const actor = gate.actor

  return withWriteBudget(actor, async () => {
    const result = await deleteTimesheetEntry(actor, entryId)
    if (!result.ok) {
      if (result.error.code === 'NOT_FOUND') return { error: 'Entry not found.' }
      if (result.error.code === 'FORBIDDEN') return { error: 'You can only delete your own entries.' }
      return { error: result.error.message }
    }
    return {}
  })
}

/**
 * Bulk-edit a batch of timesheet entries (project / activity type change).
 * Validates and applies every row with the same rules as `updateTimesheet`,
 * but charges the per-user write budget ONCE for the whole batch and reports
 * per-row errors so the UI can tell the user which rows failed.
 */
export async function bulkUpdateTimesheets(
  entries: Array<{
    id: string
    projectId: string
    activityTypeId: string
    hoursWorked: number
    workDone: string
    logDate: string
  }>
): Promise<ActionResult & { updated?: number; errors?: string[] }> {
  const gate = await requireActiveActor()
  if ('error' in gate) return { error: gate.error }
  const actor = gate.actor

  if (!Array.isArray(entries) || entries.length === 0) return { error: 'No entries selected.' }
  if (entries.length > 500) return { error: 'Too many entries for one edit (max 500).' }

  // A batch that wrote nothing is not chargeable, so the reservation goes back.
  return withWriteBudget(
    actor,
    async (): Promise<ActionResult & { updated?: number; errors?: string[] }> => {
      const result = await bulkUpdateTimesheetsDomain(actor, entries)
      if (!result.ok) {
        return { error: result.error.message }
      }

      const { updated, errors } = result.data
      return {
        error: errors && errors.length > 0 && updated === 0 ? 'All edits failed.' : undefined,
        updated,
        errors: errors && errors.length > 0 ? errors : undefined,
      }
    },
    (result) => (result.updated ?? 0) > 0
  )
}
