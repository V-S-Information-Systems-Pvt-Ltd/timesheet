// app/api/data/timesheets/route.ts
import { json, requireActive, serverError } from '@/app/api/_http'
import { repo } from '@/lib/db'
import type { TimesheetListOptions } from '@/lib/db/repository'

export async function GET(request: Request) {
  try {
    const auth = await requireActive()
    if (!auth.ok) return auth.response

    const url = new URL(request.url)
    const opts: TimesheetListOptions = {}
    for (const key of ['from', 'to', 'limit'] as const) {
      const raw = url.searchParams.get(key)
      if (raw === null) continue
      const value = Number(raw)
      if (!Number.isInteger(value) || value < 0) {
        return json({ error: `Invalid "${key}" parameter.` }, 400)
      }
      opts[key] = value
    }

    const { rows, count } = await repo.listTimesheets(auth.actor, opts)
    return json({ data: rows, count })
  } catch (err) {
    return serverError(err)
  }
}
