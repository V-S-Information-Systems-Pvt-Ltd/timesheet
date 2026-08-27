import { requireMobileActor, json, serverError } from '@/app/api/v1/_http'
import { listMobileActorTimesheets } from '@/lib/db/mobile-timesheets'

import { withRequestLogging } from '../_observability'
export const runtime = 'nodejs'

function day(value: Date): string {
  return value.toISOString().slice(0, 10)
}

export const GET = withRequestLogging('GET /api/v1/dashboard', async (request: Request) => {
  try {
    const auth = await requireMobileActor(request)
    if (!auth.ok) return auth.response

    const today = new Date()
    const todayString = day(today)
    const start = new Date(today)
    start.setUTCDate(start.getUTCDate() - 6)
    const { rows } = await listMobileActorTimesheets(auth.actor, {
      dateFrom: day(start),
      dateTo: todayString,
      limit: 20,
    })
    const todayHours = rows
      .filter((row) => row.log_date === todayString)
      .reduce((total, row) => total + Number(row.hours_worked), 0)
    const weekHours = rows.reduce((total, row) => total + Number(row.hours_worked), 0)

    return json({
      data: {
        actor: {
          id: auth.actor.id,
          email: auth.actor.email,
          role: auth.actor.role,
          permissionRole: auth.actor.permission_role,
          hierarchyRole: auth.actor.hierarchy_role,
        },
        today: { date: todayString, hours: todayHours },
        week: { from: day(start), to: todayString, hours: weekHours },
        recentEntries: rows,
        quickActions: ['create-timesheet'],
      },
      error: null,
    })
  } catch (err) {
    return serverError(err)
  }
})
