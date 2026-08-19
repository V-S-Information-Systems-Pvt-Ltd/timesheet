// app/api/data/reports/route.ts
// Server-side report aggregation for large datasets.
// Accepts project, from, to, and groupBy query params. from/to are DATES
// (YYYY-MM-DD) and are applied at the data layer via dateFrom/dateTo — they are
// NOT pagination offsets, so aggregation reflects the true requested range.

import { json, requireActive, serverError } from '@/app/api/_http'
import { repo } from '@/lib/db'
import { isValidISODate } from '@/lib/validation'
import { todayISO } from '@/lib/dates'
import type { Timesheet } from '@/app/types'

const GROUP_BYS = ['user', 'project', 'activity'] as const
type GroupBy = (typeof GROUP_BYS)[number]

function groupKey(t: Timesheet, groupBy: GroupBy): string {
  if (groupBy === 'project') return t.projects?.name ?? 'Unknown project'
  if (groupBy === 'activity') return t.activity_types?.name ?? '(no type)'
  return t.profiles?.email ?? 'Unknown'
}

export async function GET(request: Request) {
  try {
    const auth = await requireActive()
    if (!auth.ok) return auth.response

    const url = new URL(request.url)
    const projectId = url.searchParams.get('project') ?? undefined
    const from = url.searchParams.get('from') ?? undefined
    const to = url.searchParams.get('to') ?? todayISO()
    const rawGroupBy = url.searchParams.get('groupBy') ?? 'user'

    if (from && !isValidISODate(from)) {
      return json({ error: 'Invalid "from" date. Use YYYY-MM-DD.' }, 400)
    }
    if (to && !isValidISODate(to)) {
      return json({ error: 'Invalid "to" date. Use YYYY-MM-DD.' }, 400)
    }
    if (!GROUP_BYS.includes(rawGroupBy as GroupBy)) {
      return json({ error: `Invalid "groupBy". Use one of: ${GROUP_BYS.join(', ')}.` }, 400)
    }
    const groupBy = rawGroupBy as GroupBy

    // Fetch every row in the date range (date-filtered in SQL/Supabase). The
    // server has the full picture, so reports don't depend on client pagination.
    const { rows } = await repo.listTimesheets(auth.actor, { dateFrom: from, dateTo: to })

    let filtered = rows
    if (projectId) {
      filtered = filtered.filter(t => t.project_id === projectId)
    }

    const byGroup = new Map<
      string,
      { label: string; hours: number; entries: number }
    >()
    for (const t of filtered) {
      const label = groupKey(t, groupBy)
      const existing = byGroup.get(label)
      const hours = Number(t.hours_worked) || 0
      if (existing) {
        existing.hours += hours
        existing.entries++
      } else {
        byGroup.set(label, { label, hours, entries: 1 })
      }
    }

    const totals = {
      totalHours: filtered.reduce((sum, t) => sum + (Number(t.hours_worked) || 0), 0),
      totalEntries: filtered.length,
      byGroup: Array.from(byGroup.values()).sort((a, b) => b.hours - a.hours),
    }

    return json({ data: totals })
  } catch (err) {
    return serverError(err)
  }
}
