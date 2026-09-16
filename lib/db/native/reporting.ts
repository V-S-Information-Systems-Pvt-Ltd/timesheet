import 'server-only'

import type { Timesheet } from '@/app/types'
import { canSeeAllActor, isLeaderActor } from '@/lib/roles'
import { query } from '../pool'
import type {
  Actor,
  ReportBucket,
  ReportTotalsInput,
  TimesheetListOptions,
  TimesheetListResult,
} from '../repository'
import type { ReportGroupBy, ReportingPersistence } from '@/lib/domain/reporting-port'

interface TimesheetJoinedRow {
  id: string
  user_id: string
  project_id: string
  activity_type_id: string | null
  log_date: string
  hours_worked: string | number
  work_done: string
  created_at: string
  project_name: string | null
  user_email: string | null
  activity_type_name: string | null
}

function mapTimesheet(r: TimesheetJoinedRow): Timesheet {
  return {
    id: r.id,
    user_id: r.user_id,
    project_id: r.project_id,
    activity_type_id: r.activity_type_id,
    log_date: r.log_date,
    hours_worked: Number(r.hours_worked),
    work_done: r.work_done,
    created_at: r.created_at,
    projects: r.project_name != null ? { name: r.project_name } : null,
    profiles: r.user_email != null ? { email: r.user_email } : null,
    activity_types: r.activity_type_name != null ? { name: r.activity_type_name } : null,
  }
}

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

export const nativeReportingPersistence: ReportingPersistence = {
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

  async listTimesheets(actor: Actor, opts: TimesheetListOptions = {}): Promise<TimesheetListResult> {
    const { where: scopeWhere, params: baseParams } = timesheetScope(actor)

    const filterConds: string[] = []
    const filterParams: unknown[] = []
    if (opts.userId) {
      filterParams.push(opts.userId)
      filterConds.push(`t.user_id = $${baseParams.length + filterParams.length}`)
    }
    if (opts.projectId) {
      filterParams.push(opts.projectId)
      filterConds.push(`t.project_id = $${baseParams.length + filterParams.length}`)
    }
    if (opts.dateFrom) {
      filterParams.push(opts.dateFrom)
      filterConds.push(`t.log_date >= $${baseParams.length + filterParams.length}`)
    }
    if (opts.dateTo) {
      filterParams.push(opts.dateTo)
      filterConds.push(`t.log_date <= $${baseParams.length + filterParams.length}`)
    }

    const allConds: string[] = []
    if (scopeWhere) allConds.push(scopeWhere.replace(/^where\s+/i, ''))
    if (filterConds.length) allConds.push(...filterConds)
    const where = allConds.length ? `where ${allConds.join(' and ')}` : ''

    const allParams = [...baseParams, ...filterParams]

    const countPromise =
      opts.includeCount !== false
        ? query<{ count: string | number }>(
            `select count(*)::int as count from public.timesheets t ${where}`,
            allParams
          )
        : Promise.resolve([{ count: 0 }])

    let paginationClause = ''
    const pageParams = [...allParams]
    if (opts.from !== undefined && opts.to !== undefined) {
      const limit = opts.to - opts.from + 1
      pageParams.push(limit, opts.from)
      paginationClause = `limit $${pageParams.length - 1} offset $${pageParams.length}`
    } else if (opts.limit !== undefined) {
      pageParams.push(opts.limit)
      paginationClause = `limit $${pageParams.length}`
    }

    const rowsPromise = query<TimesheetJoinedRow>(
      `select t.id, t.user_id, t.project_id, t.activity_type_id, t.log_date,
              t.hours_worked, t.work_done, t.created_at,
              p.name as project_name,
              pr.email as user_email,
              at.name as activity_type_name
       from public.timesheets t
       left join public.projects p on p.id = t.project_id
       left join public.profiles pr on pr.id = t.user_id
       left join public.activity_types at on at.id = t.activity_type_id
       ${where}
       order by t.log_date desc, t.created_at desc
       ${paginationClause}`,
      pageParams
    )

    const [countRows, dataRows] = await Promise.all([countPromise, rowsPromise])
    return {
      rows: dataRows.map(mapTimesheet),
      count: Number(countRows[0]?.count ?? 0),
    }
  },
}
