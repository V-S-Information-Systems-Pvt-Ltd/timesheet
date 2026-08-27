import 'server-only'

import { repo } from '@/lib/db'
import type { Actor } from '@/lib/db/repository'
import type { Timesheet } from '@/app/types'

export interface MobileDashboardDto {
  actor: {
    id: string
    email: string
    role: string
    permissionRole: string
    hierarchyRole: string
    isActive: boolean
  }
  today: { date: string; hours: number }
  week: { from: string; to: string; hours: number }
  recentEntries: Timesheet[]
  quickActions: string[]
}

function day(value: Date): string {
  return value.toISOString().slice(0, 10)
}

export async function getDashboardService(actor: Actor): Promise<MobileDashboardDto> {
  const today = new Date()
  const todayString = day(today)
  const start = new Date(today)
  start.setUTCDate(start.getUTCDate() - 6)

  // 1. Fetch user's latest 20 entries
  const { rows: recentEntries } = await repo.listTimesheets(actor, {
    limit: 20,
  })

  // 2. Fetch the 7-day window rows to accurately calculate today and this week's hours
  const { rows: weekRows } = await repo.listTimesheets(actor, {
    dateFrom: day(start),
    dateTo: todayString,
    limit: 100,
  })

  const todayHours = weekRows
    .filter((row) => row.log_date === todayString)
    .reduce((total, row) => total + Number(row.hours_worked), 0)
  const weekHours = weekRows.reduce((total, row) => total + Number(row.hours_worked), 0)

  return {
    actor: {
      id: actor.id,
      email: actor.email,
      role: actor.role,
      permissionRole: actor.permission_role,
      hierarchyRole: actor.hierarchy_role,
      isActive: actor.isActive,
    },
    today: { date: todayString, hours: todayHours },
    week: { from: day(start), to: todayString, hours: weekHours },
    recentEntries,
    quickActions: ['create-timesheet'],
  }
}
