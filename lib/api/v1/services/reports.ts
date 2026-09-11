import { repo } from '@/lib/db'
import type { Actor } from '@/lib/db/repository'
import { isValidISODate } from '@/lib/validation'
import { todayISO } from '@/lib/dates'
import type { MobileServiceResult } from './_result'

import type { ReportTotalsDto } from '@/lib/api/v1/contracts'

const GROUP_BYS = ['user', 'project', 'activity'] as const
export type GroupBy = (typeof GROUP_BYS)[number]

export async function getReportsService(
  actor: Actor,
  searchParams: URLSearchParams
): Promise<MobileServiceResult<ReportTotalsDto>> {
  const projectId = searchParams.get('project') ?? undefined
  const userId = searchParams.get('userId') ?? searchParams.get('user') ?? undefined
  const from = searchParams.get('from') ?? undefined
  const to = searchParams.get('to') ?? todayISO()
  const rawGroupBy = searchParams.get('groupBy') ?? 'project'

  if (from && !isValidISODate(from)) {
    return { success: false, code: 'VALIDATION_ERROR', message: 'Invalid "from" date. Use YYYY-MM-DD.', status: 400 }
  }
  if (to && !isValidISODate(to)) {
    return { success: false, code: 'VALIDATION_ERROR', message: 'Invalid "to" date. Use YYYY-MM-DD.', status: 400 }
  }
  if (!GROUP_BYS.includes(rawGroupBy as GroupBy)) {
    return {
      success: false,
      code: 'VALIDATION_ERROR',
      message: `Invalid "groupBy". Use one of: ${GROUP_BYS.join(', ')}.`,
      status: 400,
    }
  }
  const groupBy = rawGroupBy as GroupBy

  const byGroup = await repo.getGroupedReportTotals(actor, { projectId, userId, from, to }, groupBy)

  const totals = {
    totalHours: byGroup.reduce((sum, b) => sum + (Number(b.hours) || 0), 0),
    totalEntries: byGroup.reduce((sum, b) => sum + b.entries, 0),
    byGroup,
  }

  return { success: true, data: totals }
}
