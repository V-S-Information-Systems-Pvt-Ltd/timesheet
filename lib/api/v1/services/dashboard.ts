import 'server-only'

import { repo } from '@/lib/db'
import type { Actor } from '@/lib/db/repository'
import {
  mapActorDto,
  mapTimesheetDto,
  type MobileDashboardDto,
} from '@/lib/api/v1/contracts'

export type { MobileDashboardDto }

function day(value: Date): string {
  return value.toISOString().slice(0, 10)
}

export async function getDashboardService(actor: Actor): Promise<MobileDashboardDto> {
  const today = new Date()
  const todayString = day(today)
  const start = new Date(today)
  start.setUTCDate(start.getUTCDate() - 6)

  // Fetch user's latest 20 entries and 7-day window in parallel without count queries
  const [{ rows: recentEntries }, { rows: weekRows }] = await Promise.all([
    repo.listTimesheets(actor, {
      userId: actor.id,
      limit: 20,
      includeCount: false,
    }),
    repo.listTimesheets(actor, {
      userId: actor.id,
      dateFrom: day(start),
      dateTo: todayString,
      limit: 100,
      includeCount: false,
    }),
  ])

  const todayHours = weekRows
    .filter((row) => row.log_date === todayString)
    .reduce((total, row) => total + Number(row.hours_worked), 0)
  const weekHours = weekRows.reduce((total, row) => total + Number(row.hours_worked), 0)

  return {
    actor: mapActorDto(actor),
    today: { date: todayString, hours: todayHours },
    week: { from: day(start), to: todayString, hours: weekHours },
    recentEntries: recentEntries.map(mapTimesheetDto),
    quickActions: ['create-timesheet'],
  }
}
