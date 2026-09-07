import { withMobileActor, json, serverError, apiError } from '@/app/api/v1/_http'
import { parseSchema, timesheetQuerySchema, logEntrySchema } from '@/lib/validation-schemas'
import { listTimesheetsService, createTimesheetService } from '@/lib/api/v1/services/timesheets'
import type { TimesheetListOptions } from '@/lib/db/repository'
import { withIdempotency } from '@/lib/idempotency'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  return withMobileActor(request, async (auth) => {
    try {
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

      const options: TimesheetListOptions = {
        from: parsed.data.from,
        to: parsed.data.to,
        limit: parsed.data.limit,
        userId: parsed.data.userId,
        dateFrom: parsed.data.dateFrom,
        dateTo: parsed.data.dateTo,
      }

      const result = await listTimesheetsService(auth.actor, options)
      if (!result.ok) {
        return apiError(result.error.code, result.error.message, result.error.status)
      }
      return json({ data: result.data, error: null })
    } catch (err) {
      return serverError(err)
    }
  })
}

export async function POST(request: Request) {
  return withMobileActor(request, async (auth) => {
    try {
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

      return await withIdempotency(request, auth.actor.id, 'create_timesheet', parsed.data, async () => {
        const result = await createTimesheetService(auth.actor, parsed.data)
        if (!result.ok) {
          return apiError(result.error.code, result.error.message, result.error.status)
        }
        return json({ data: result.data, error: null }, 201)
      })
    } catch (err) {
      return serverError(err)
    }
  })
}
