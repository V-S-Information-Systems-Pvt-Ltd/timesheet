// app/api/data/timesheets/route.ts
import { json, requireActive, serverError } from '@/app/api/_http'
import { repo } from '@/lib/db'
import { parseSchema, timesheetQuerySchema } from '@/lib/validation-schemas'
import type { TimesheetListOptions } from '@/lib/db/repository'

export async function GET(request: Request) {
  try {
    const auth = await requireActive()
    if (!auth.ok) return auth.response

    const url = new URL(request.url)
    const raw: Record<string, unknown> = {}
    for (const key of ['from', 'to', 'limit', 'userId', 'dateFrom', 'dateTo'] as const) {
      const v = url.searchParams.get(key)
      if (v !== null) raw[key] = v
    }

    const parsed = parseSchema(timesheetQuerySchema, raw)
    if (!parsed.ok) return json({ error: parsed.error.error, fieldErrors: parsed.error.fieldErrors }, 400)

    const opts: TimesheetListOptions = {}
    if (parsed.data.from !== undefined) opts.from = parsed.data.from
    if (parsed.data.to !== undefined) opts.to = parsed.data.to
    if (parsed.data.limit !== undefined) opts.limit = parsed.data.limit
    if (parsed.data.userId !== undefined) opts.userId = parsed.data.userId
    if (parsed.data.dateFrom !== undefined) opts.dateFrom = parsed.data.dateFrom
    if (parsed.data.dateTo !== undefined) opts.dateTo = parsed.data.dateTo

    const { rows, count } = await repo.listTimesheets(auth.actor, opts)
    return json({ data: rows, count })
  } catch (err) {
    return serverError(err)
  }
}
