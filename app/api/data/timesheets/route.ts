// app/api/data/timesheets/route.ts
import { json, requireSignedIn, serverError } from '@/app/api/_http'
import { repo } from '@/lib/db'
import type { TimesheetListOptions } from '@/lib/db/repository'

export async function GET(request: Request) {
  try {
    const auth = await requireSignedIn()
    if (!auth.ok) return auth.response

    const url = new URL(request.url)
    const opts: TimesheetListOptions = {}
    if (url.searchParams.get('from') !== null) opts.from = Number(url.searchParams.get('from'))
    if (url.searchParams.get('to') !== null) opts.to = Number(url.searchParams.get('to'))
    if (url.searchParams.get('limit') !== null) opts.limit = Number(url.searchParams.get('limit'))

    const { rows, count } = await repo.listTimesheets(auth.actor, opts)
    return json({ data: rows, count })
  } catch (err) {
    return serverError(err)
  }
}
