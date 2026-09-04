import { requireMobileActor, json, serverError, apiError } from '@/app/api/v1/_http'
import { parseSchema, timesheetQuerySchema, logEntrySchema } from '@/lib/validation-schemas'
import { listTimesheetsService, createTimesheetService } from '@/lib/api/v1/services/timesheets'
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

    const result = await listTimesheetsService(auth.actor, options)
    if (!result.ok) {
      return apiError(result.error.code, result.error.message, result.error.status)
    }
    return json({ data: result.data, error: null })
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

    const result = await createTimesheetService(auth.actor, parsed.data)
    if (!result.ok) {
      return apiError(result.error.code, result.error.message, result.error.status)
    }

    return json({ data: result.data, error: null }, 201)
  } catch (err) {
    return serverError(err)
  }
}
