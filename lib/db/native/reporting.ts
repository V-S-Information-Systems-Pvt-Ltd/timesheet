import 'server-only'

import { ENTRY_TYPE_LABELS, ACTIVITY_LABELS } from '@vsis/contracts'
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
      if (input.entryType === 'legacy') conds.push('t.entry_type is null')
      else if (input.entryType) { params.push(input.entryType); conds.push(`t.entry_type = $${params.length}`) }
      if (input.activityCode) { params.push(input.activityCode); conds.push(`t.activity_code = $${params.length}`) }
      const whereClause = conds.length ? `where ${conds.join(' and ')}` : ''

      // CASE labels come from the same shared taxonomy as the fallback/UI.
      const quote = (value: string) => `'${value.replace(/'/g, "''")}'`
      const typeLabel = `case t.entry_type ${Object.entries(ENTRY_TYPE_LABELS).map(([code, label]) => `when ${quote(code)} then ${quote(label)}`).join(' ')} else 'Legacy' end`
      const activityLabel = `case t.activity_code ${Object.entries(ACTIVITY_LABELS).map(([code, label]) => `when ${quote(code)} then ${quote(label)}`).join(' ')} else '(no type)' end`
      const labelExpr = groupBy === 'type' ? typeLabel
        : groupBy === 'project' ? `case when t.entry_type in ('support', 'internal') then (${typeLabel}) || ' — no project' else coalesce(p.name, 'Unknown project') end`
        : groupBy === 'activity' ? `case when t.entry_type is null then 'Legacy · ' || coalesce(at.name, '(no type)') else (${typeLabel}) || ' · ' || (${activityLabel}) end`
        : "coalesce(pr.email, 'Unknown')"

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
