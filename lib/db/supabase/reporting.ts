import 'server-only'

import type { Timesheet } from '@/app/types'
import { createClient } from '@/lib/supabase/server'
import { getMobileSupabaseClient } from '@/lib/supabase/bearer'
import type {
  Actor,
  ReportBucket,
  ReportTotalsInput,
  TimesheetListOptions,
  TimesheetListResult,
} from '../repository'
import type { ReportGroupBy, ReportingPersistence } from '@/lib/domain/reporting-port'

async function server() {
  const mobileClient = getMobileSupabaseClient()
  if (mobileClient) return mobileClient
  return createClient()
}

export const supabaseReportingPersistence: ReportingPersistence & {
  getGroupedReportTotals(
    actor: Actor,
    input: ReportTotalsInput,
    groupBy: ReportGroupBy,
    listTimesheetsFn?: (actor: Actor, opts: TimesheetListOptions) => Promise<TimesheetListResult>
  ): Promise<ReportBucket[]>
} = {
  async getGroupedReportTotals(
    actor: Actor,
    input: ReportTotalsInput,
    groupBy: ReportGroupBy,
    listTimesheetsFn?: (actor: Actor, opts: TimesheetListOptions) => Promise<TimesheetListResult>
  ): Promise<ReportBucket[]> {
    if (!input.userId) {
      const supabase = await server()
      const { data, error } = await supabase.rpc('get_grouped_report_totals', {
        p_group_by: groupBy,
        p_project_id: input.projectId ?? null,
        p_from: input.from ?? null,
        p_to: input.to ?? null,
      })
      if (error) throw new Error(error.message)
      return (data ?? []) as ReportBucket[]
    }

    // User-filtered requests cannot use the grouped RPC because its contract has
    // no user-id argument. Page through the same RLS-scoped list query instead.
    const listFn = listTimesheetsFn ?? ((a, opts) => this.listTimesheets(a, opts))
    const allRows: Timesheet[] = []
    const PAGE_SIZE = 1000
    let from = 0
    for (;;) {
      const { rows, count } = await listFn(actor, {
        userId: input.userId,
        projectId: input.projectId,
        dateFrom: input.from,
        dateTo: input.to,
        from,
        to: from + PAGE_SIZE - 1,
        includeCount: true,
      })
      allRows.push(...rows)
      if (rows.length === 0) break
      from += rows.length
      if (count > 0 && from >= count) break
    }
    const map = new Map<string, { label: string; hours: number; entries: number }>()
    for (const r of allRows) {
      if (input.projectId && r.project_id !== input.projectId) continue
      let label = 'Unknown'
      if (groupBy === 'project') label = r.projects?.name ?? 'Unknown project'
      else if (groupBy === 'activity') label = r.activity_types?.name ?? '(no type)'
      else label = r.profiles?.email ?? 'Unknown'

      const existing = map.get(label) ?? { label, hours: 0, entries: 0 }
      existing.hours += Number(r.hours_worked) || 0
      existing.entries += 1
      map.set(label, existing)
    }

    return Array.from(map.values()).sort((a, b) => b.hours - a.hours)
  },

  async listTimesheets(
    actor: Actor,
    opts: TimesheetListOptions = {}
  ): Promise<TimesheetListResult> {
    const supabase = await server()
    let query = supabase
      .from('timesheets')
      .select(
        '*, projects(name), profiles(email), activity_types(name)',
        { count: opts.includeCount !== false ? 'exact' : undefined }
      )

    if (opts.userId) query = query.eq('user_id', opts.userId)
    if (opts.projectId) query = query.eq('project_id', opts.projectId)
    if (opts.dateFrom) query = query.gte('log_date', opts.dateFrom)
    if (opts.dateTo) query = query.lte('log_date', opts.dateTo)

    query = query.order('log_date', { ascending: false }).order('created_at', { ascending: false })

    if (opts.from !== undefined && opts.to !== undefined) {
      query = query.range(opts.from, opts.to)
    } else if (opts.limit !== undefined) {
      query = query.limit(opts.limit)
    }

    const { data, count, error } = await query
    if (error) throw new Error(error.message)
    return {
      rows: (data as Timesheet[]) ?? [],
      count: count ?? 0,
    }
  },
}
