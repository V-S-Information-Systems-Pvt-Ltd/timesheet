import 'server-only'

import { reportGroupLabel, matchesReportClassification } from '@/lib/reports'
import type { Timesheet } from '@/app/types'
import { createClient } from '@/lib/supabase/server'
import { getMobileSupabaseClient } from '@/lib/supabase/bearer'
import type { Actor, ReportBucket, ReportTotalsInput } from '../types'
import type { ReportGroupBy, ReportingPersistence } from '@/lib/domain/reporting-port'

async function server() {
  const mobileClient = getMobileSupabaseClient()
  if (mobileClient) return mobileClient
  return createClient()
}

/** The composition root supplies the canonical scoped list, without cross-domain imports. */
export function createSupabaseReportingPersistence(
  listTimesheets: ReportingPersistence['listTimesheets']
): ReportingPersistence {
  const persistence: ReportingPersistence = {
    listTimesheets,

    async getGroupedReportTotals(
      actor: Actor,
      input: ReportTotalsInput,
      groupBy: ReportGroupBy
    ): Promise<ReportBucket[]> {
      if (!input.userId) {
        const supabase = await server()
        const { data, error } = await supabase.rpc('get_grouped_report_totals', {
          p_group_by: groupBy,
          p_project_id: input.projectId ?? null,
          p_from: input.from ?? null,
          p_to: input.to ?? null,
          p_entry_type: input.entryType ?? null,
          p_activity_code: input.activityCode ?? null,
        })
        if (error) throw new Error(error.message)
        return (data ?? []) as ReportBucket[]
      }

      // User-filtered requests cannot use the grouped RPC because its contract has
      // no user-id argument. Page through the same RLS-scoped list query instead.
      const allRows: Timesheet[] = []
      const PAGE_SIZE = 1000
      let from = 0
      for (;;) {
        const { rows, count } = await persistence.listTimesheets(actor, {
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
        if (!matchesReportClassification(r, input.entryType, input.activityCode)) continue
        const label = reportGroupLabel(r, groupBy)

        const existing = map.get(label) ?? { label, hours: 0, entries: 0 }
        existing.hours += Number(r.hours_worked) || 0
        existing.entries += 1
        map.set(label, existing)
      }

      return Array.from(map.values()).sort((a, b) => b.hours - a.hours)
    },
  }
  return persistence
}
