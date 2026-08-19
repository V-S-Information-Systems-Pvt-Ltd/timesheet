// app/api/data/import/route.ts
// REST endpoint for CSV import of timesheet rows. Delegates to the
// importTimesheets server action (admin-only, 10/day/user rate limit).
import { json, requireActive, serverError } from '@/app/api/_http'
import { importTimesheets, type CsvTimesheetRow } from '@/app/actions'

export async function POST(request: Request) {
  try {
    const auth = await requireActive()
    if (!auth.ok) return auth.response

    const body = await request.json().catch(() => ({})) as unknown
    const rows = (body as { rows?: unknown })?.rows
    if (!Array.isArray(rows)) return json({ error: 'rows must be an array.' }, 400)
    if (rows.length === 0) return json({ error: 'No rows to import.' }, 400)

    const result = await importTimesheets(rows as CsvTimesheetRow[])
    const status = result.error ? 400 : 200
    return json(result, status)
  } catch (err) {
    return serverError(err)
  }
}
