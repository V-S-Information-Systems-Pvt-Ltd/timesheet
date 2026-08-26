import { requireMobileActor, json, serverError, apiError } from '@/app/api/v1/_http'
import { repo } from '@/lib/db'
import { parseSchema, timesheetQuerySchema, logEntrySchema } from '@/lib/validation-schemas'
import { todayISO } from '@/lib/dates'
import { isWithinBackfillWindow, sanitizeWorkDone } from '@/lib/validation'
import { isAdminActor } from '@/lib/roles'
import type { TimesheetListOptions } from '@/lib/db/repository'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  try {
    const auth = await requireMobileActor(request)
    if (!auth.ok) return auth.response

    const url = new URL(request.url)
    const raw: Record<string, unknown> = {}
    for (const key of ['from', 'to', 'limit', 'userId', 'dateFrom', 'dateTo'] as const) {
      const value = url.searchParams.get(key)
      if (value !== null) raw[key] = value
    }
    const parsed = parseSchema(timesheetQuerySchema, raw)
    if (!parsed.ok) {
      return apiError('VALIDATION_ERROR', parsed.error.error, 400)
    }

    const options: TimesheetListOptions = {}
    if (parsed.data.from !== undefined) options.from = parsed.data.from
    if (parsed.data.to !== undefined) options.to = parsed.data.to
    if (parsed.data.limit !== undefined) options.limit = parsed.data.limit
    if (parsed.data.userId !== undefined) options.userId = parsed.data.userId
    if (parsed.data.dateFrom !== undefined) options.dateFrom = parsed.data.dateFrom
    if (parsed.data.dateTo !== undefined) options.dateTo = parsed.data.dateTo

    const result = await repo.listTimesheets(auth.actor, options)
    return json({ data: result, error: null })
  } catch (err) {
    return serverError(err)
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireMobileActor(request)
    if (!auth.ok) return auth.response

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

    const today = todayISO()
    const settings = await repo.getBackfillWindow(auth.actor)
    if (!isAdminActor(auth.actor) && !isWithinBackfillWindow(parsed.data.logDate, today, settings)) {
      return apiError('VALIDATION_ERROR', 'This date is outside the writable backfill window.', 400)
    }

    const total = await repo.sumHoursForUserDate(auth.actor, auth.actor.id, parsed.data.logDate)
    if (total + parsed.data.hoursWorked > 24) {
      return apiError(
        'VALIDATION_ERROR',
        `Daily total would exceed 24 hours (${total}h already logged on ${parsed.data.logDate}).`,
        400
      )
    }

    const result = await repo.createTimesheet(auth.actor, {
      userId: auth.actor.id,
      projectId: parsed.data.projectId,
      activityTypeId: parsed.data.activityTypeId,
      hoursWorked: parsed.data.hoursWorked,
      workDone: sanitizeWorkDone(parsed.data.workDone),
      logDate: parsed.data.logDate,
    })

    if (result.error) {
      return apiError('DB_ERROR', result.error, 400)
    }

    return json({ data: { success: true }, error: null }, 201)
  } catch (err) {
    return serverError(err)
  }
}
