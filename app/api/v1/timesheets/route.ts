import { requireMobileActor, json, serverError, apiError } from '@/app/api/v1/_http'
import { listMobileActorTimesheets } from '@/lib/db/mobile-timesheets'
import { parseSchema, timesheetQuerySchema } from '@/lib/validation-schemas'
import type { TimesheetListOptions } from '@/lib/db/repository'

import { withRequestLogging } from '../_observability'
export const runtime = 'nodejs'

export const GET = withRequestLogging('GET /api/v1/timesheets', async (request: Request) => {
  try {
    const auth = await requireMobileActor(request)
    if (!auth.ok) return auth.response

    const url = new URL(request.url)
    const raw: Record<string, unknown> = {}
    for (const key of ['from', 'to', 'limit', 'dateFrom', 'dateTo'] as const) {
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
    if (parsed.data.dateFrom !== undefined) options.dateFrom = parsed.data.dateFrom
    if (parsed.data.dateTo !== undefined) options.dateTo = parsed.data.dateTo

    const result = await listMobileActorTimesheets(auth.actor, options)
    return json({ data: result, error: null })
  } catch (err) {
    return serverError(err)
  }
})
