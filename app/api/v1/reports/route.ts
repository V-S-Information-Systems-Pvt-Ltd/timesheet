import { requireMobileActor, json, serverError, apiError } from '@/app/api/v1/_http'
import { repo } from '@/lib/db'
import { isValidISODate } from '@/lib/validation'
import { todayISO } from '@/lib/dates'

export const runtime = 'nodejs'

const GROUP_BYS = ['user', 'project', 'activity'] as const
type GroupBy = (typeof GROUP_BYS)[number]

export async function GET(request: Request) {
  try {
    const auth = await requireMobileActor(request)
    if (!auth.ok) return auth.response

    const url = new URL(request.url)
    const projectId = url.searchParams.get('project') ?? undefined
    const from = url.searchParams.get('from') ?? undefined
    const to = url.searchParams.get('to') ?? todayISO()
    const rawGroupBy = url.searchParams.get('groupBy') ?? 'project'

    if (from && !isValidISODate(from)) {
      return apiError('VALIDATION_ERROR', 'Invalid "from" date. Use YYYY-MM-DD.', 400)
    }
    if (to && !isValidISODate(to)) {
      return apiError('VALIDATION_ERROR', 'Invalid "to" date. Use YYYY-MM-DD.', 400)
    }
    if (!GROUP_BYS.includes(rawGroupBy as GroupBy)) {
      return apiError('VALIDATION_ERROR', `Invalid "groupBy". Use one of: ${GROUP_BYS.join(', ')}.`, 400)
    }
    const groupBy = rawGroupBy as GroupBy

    const byGroup = await repo.getGroupedReportTotals(auth.actor, { projectId, from, to }, groupBy)

    const totals = {
      totalHours: byGroup.reduce((sum, b) => sum + (Number(b.hours) || 0), 0),
      totalEntries: byGroup.reduce((sum, b) => sum + b.entries, 0),
      byGroup,
    }

    return json({ data: totals, error: null })
  } catch (err) {
    return serverError(err)
  }
}
