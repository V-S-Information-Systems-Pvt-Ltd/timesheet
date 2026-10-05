import 'server-only'

import { canSeeAllActor, isLeaderActor } from '@/lib/roles'
import { query } from '../pool'
import type { Actor, ReportBucket, ReportTotalsInput } from '../types'
import type { ReportGroupBy, ReportingPersistence } from '@/lib/domain/reporting-port'

function timesheetScope(actor: Actor): { where: string; params: unknown[] } {
  if (canSeeAllActor(actor)) return { where: '', params: [] }
  if (isLeaderActor(actor)) {
    return {
      where: 'where (t.user_id = $1 or t.user_id = any(public.team_ids($1)))',
      params: [actor.id],
    }
  }
  return { where: 'where t.user_id = $1', params: [actor.id] }
}

/** The composition root supplies the canonical scoped list, without cross-domain imports. */
export function createNativeReportingPersistence(
  listTimesheets: ReportingPersistence['listTimesheets']
): ReportingPersistence {
  return {
    listTimesheets,

    async getGroupedReportTotals(
      actor: Actor,
      input: ReportTotalsInput,
      groupBy: ReportGroupBy
    ): Promise<ReportBucket[]> {
      const { where, params } = timesheetScope(actor)

      const conds: string[] = []
      if (where) conds.push(where.slice('where '.length))
      if (input.projectId) {
        params.push(input.projectId)
        conds.push(`t.project_id = $${params.length}`)
      }
      if (input.userId) {
        params.push(input.userId)
        conds.push(`t.user_id = $${params.length}`)
      }
      if (input.from) {
        params.push(input.from)
        conds.push(`t.log_date >= $${params.length}`)
      }
      if (input.to) {
        params.push(input.to)
        conds.push(`t.log_date <= $${params.length}`)
      }
      const whereClause = conds.length ? `where ${conds.join(' and ')}` : ''

      const labelExpr =
        groupBy === 'project'
          ? 'coalesce(p.name, \'Unknown project\')'
          : groupBy === 'activity'
            ? 'coalesce(at.name, \'(no type)\')'
            : 'coalesce(pr.email, \'Unknown\')'

      const rows = await query<{ label: string; hours: number; entries: number }>(
        `select ${labelExpr} as label, coalesce(sum(t.hours_worked), 0)::float8 as hours, count(*)::int as entries
         from public.timesheets t
         left join public.projects p on p.id = t.project_id
         left join public.activity_types at on at.id = t.activity_type_id
         left join public.profiles pr on pr.id = t.user_id
         ${whereClause}
         group by ${labelExpr}
         order by hours desc`,
        params
      )
      return rows.map((r) => ({ label: r.label, hours: Number(r.hours), entries: r.entries }))
    },
  }
}
