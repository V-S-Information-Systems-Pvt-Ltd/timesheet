// app/api/data/reports/route.ts
// Server-side report aggregation for large datasets.
// Accepts project, from, and to query params and returns hours grouped by user.

import { json, requireActive, serverError } from '@/app/api/_http'
import { repo } from '@/lib/db'
import { isValidISODate } from '@/lib/validation'
import { todayISO } from '@/lib/dates'

export async function GET(request: Request) {
  try {
    const auth = await requireActive()
    if (!auth.ok) return auth.response

    const url = new URL(request.url)
    const projectId = url.searchParams.get('project') ?? undefined
    const from = url.searchParams.get('from') ?? undefined
    const to = url.searchParams.get('to') ?? todayISO()

    if (from && !isValidISODate(from)) {
      return json({ error: 'Invalid "from" date. Use YYYY-MM-DD.' }, 400)
    }
    if (to && !isValidISODate(to)) {
      return json({ error: 'Invalid "to" date. Use YYYY-MM-DD.' }, 400)
    }

    const opts = { from: from ? Number(from) : undefined, to: to ? Number(to) : undefined, limit: 10000 }
    const { rows } = await repo.listTimesheets(auth.actor, opts)

    let filtered = rows
    if (projectId) {
      filtered = filtered.filter(t => t.project_id === projectId)
    }
    if (from) {
      filtered = filtered.filter(t => t.log_date >= from)
    }
    if (to) {
      filtered = filtered.filter(t => t.log_date <= to)
    }

    const byUser = new Map<string, { email: string; hours: number; entries: number }>()
    for (const t of filtered) {
      const email = t.profiles?.email ?? 'Unknown'
      const existing = byUser.get(email)
      if (existing) {
        existing.hours += Number(t.hours_worked) || 0
        existing.entries++
      } else {
        byUser.set(email, { email, hours: Number(t.hours_worked) || 0, entries: 1 })
      }
    }

    const totals = {
      totalHours: filtered.reduce((sum, t) => sum + (Number(t.hours_worked) || 0), 0),
      totalEntries: filtered.length,
      byUser: Array.from(byUser.values()).sort((a, b) => b.hours - a.hours),
    }

    return json({ data: totals })
  } catch (err) {
    return serverError(err)
  }
}
