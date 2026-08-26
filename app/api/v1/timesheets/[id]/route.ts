import { requireMobileActor, json, serverError, apiError } from '@/app/api/v1/_http'
import { repo } from '@/lib/db'
import { parseSchema, logEntrySchema } from '@/lib/validation-schemas'
import { todayISO } from '@/lib/dates'
import { isWithinBackfillWindow, sanitizeWorkDone } from '@/lib/validation'
import { isAdminActor } from '@/lib/roles'

export const runtime = 'nodejs'

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireMobileActor(request)
    if (!auth.ok) return auth.response
    const { id } = await params

    const existing = await repo.getTimesheet(auth.actor, id)
    if (!existing) {
      return apiError('NOT_FOUND', 'Timesheet entry not found.', 404)
    }

    const canEditOthers = isAdminActor(auth.actor)
    if (existing.user_id !== auth.actor.id && !canEditOthers) {
      return apiError('FORBIDDEN', 'You can only edit your own entries.', 403)
    }

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return apiError('VALIDATION_ERROR', 'A JSON request body is required.', 400)
    }

    const parsed = parseSchema(logEntrySchema, body)
    if (!parsed.ok) {
      return apiError('VALIDATION_ERROR', parsed.error.error, 400)
    }

    if (!canEditOthers) {
      const settings = await repo.getBackfillWindow(auth.actor)
      if (!isWithinBackfillWindow(parsed.data.logDate, todayISO(), settings)) {
        return apiError('VALIDATION_ERROR', 'This date is outside the writable backfill window.', 400)
      }
    }

    const total = await repo.sumHoursForUserDate(auth.actor, existing.user_id, parsed.data.logDate)
    const existingHours = existing.log_date === parsed.data.logDate ? Number(existing.hours_worked) : 0
    if (total - existingHours + parsed.data.hoursWorked > 24) {
      return apiError('VALIDATION_ERROR', 'Daily total would exceed 24 hours.', 400)
    }

    const result = await repo.updateTimesheet(auth.actor, id, {
      userId: existing.user_id,
      projectId: parsed.data.projectId,
      activityTypeId: parsed.data.activityTypeId,
      hoursWorked: parsed.data.hoursWorked,
      workDone: sanitizeWorkDone(parsed.data.workDone),
      logDate: parsed.data.logDate,
    })

    if (result.error) return apiError('DB_ERROR', result.error, 400)
    return json({ data: { success: true }, error: null })
  } catch (err) {
    return serverError(err)
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireMobileActor(request)
    if (!auth.ok) return auth.response
    const { id } = await params

    const existing = await repo.getTimesheet(auth.actor, id)
    if (!existing) {
      return apiError('NOT_FOUND', 'Timesheet entry not found.', 404)
    }

    const canDeleteOthers = isAdminActor(auth.actor)
    if (existing.user_id !== auth.actor.id && !canDeleteOthers) {
      return apiError('FORBIDDEN', 'You can only delete your own entries.', 403)
    }

    if (!canDeleteOthers) {
      const settings = await repo.getBackfillWindow(auth.actor)
      if (!isWithinBackfillWindow(existing.log_date, todayISO(), settings)) {
        return apiError('VALIDATION_ERROR', 'This entry is outside the writable backfill window.', 400)
      }
    }

    const result = await repo.deleteTimesheet(auth.actor, id)
    if (result.error) return apiError('DB_ERROR', result.error, 400)
    return json({ data: { success: true }, error: null })
  } catch (err) {
    return serverError(err)
  }
}
