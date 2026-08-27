import { requireMobileActor, json, serverError } from '@/app/api/v1/_http'
import { repo } from '@/lib/db'

export const runtime = 'nodejs'

function day(value: Date): string {
  return value.toISOString().slice(0, 10)
}

export async function GET(request: Request) {
  try {
    const auth = await requireMobileActor(request)
    if (!auth.ok) return auth.response

    const today = new Date()
    const todayString = day(today)
    const start = new Date(today)
    start.setUTCDate(start.getUTCDate() - 6)

    // 1. Fetch the user's latest recent entries (regardless of how long ago they were logged)
    const { rows: recentEntries } = await repo.listTimesheets(auth.actor, {
      limit: 20,
    })

    // 2. Fetch the 7-day window entries to calculate today and this week's hours accurately
    const { rows: weekRows } = await repo.listTimesheets(auth.actor, {
      dateFrom: day(start),
      dateTo: todayString,
      limit: 100,
    })

    const todayHours = weekRows
      .filter((row) => row.log_date === todayString)
      .reduce((total, row) => total + Number(row.hours_worked), 0)
    const weekHours = weekRows.reduce((total, row) => total + Number(row.hours_worked), 0)

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
        recentEntries,
        quickActions: ['create-timesheet'],
      },
      error: null,
    })
  } catch (err) {
    return serverError(err)
  }
}
