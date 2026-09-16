import 'server-only'

import type {
  Actor,
  ReportBucket,
  ReportTotalsInput,
  TimesheetListResult,
} from '@/lib/db/repository'
import { isValidISODate } from '@/lib/validation'
import { canSeeAllActor, isLeaderActor } from '@/lib/roles'
import type { ReportGroupBy, ReportingPersistence } from './reporting-port'

/** Canonical grouping axes accepted by every report transport. */
export const REPORT_GROUP_BYS: readonly ReportGroupBy[] = ['user', 'project', 'activity']

/**
 * Explicit dependencies for the reporting application module: narrow read
 * persistence plus a clock. Transports compose these at the server entry
 * boundary; the module never resolves a global repository, cookies, headers or
 * a service-role client.
 */
export interface ReportingDeps {
  persistence: ReportingPersistence
  clock: () => string
}

/** Canonical totals shape returned by every transport's report aggregate. */
export interface ReportTotals {
  totalHours: number
  totalEntries: number
  byGroup: ReportBucket[]
}

/** Raw report-totals fields as extracted by a transport, before validation. */
export interface RawReportTotalsQuery {
  projectId?: string | null
  userId?: string | null
  from?: string | null
  to?: string | null
  groupBy?: string | null
}

export type ReportTotalsQueryResolution =
  | { ok: true; filters: ReportTotalsInput; groupBy: ReportGroupBy }
  | { ok: false; message: string }

/**
 * Shared validation and defaulting for the report-totals query, used by the web
 * (`/api/data/reports`) and versioned (`/api/v1/reports`) transports. Each
 * transport keeps its distinct parameter spellings and default group axis; the
 * date/group validation and filter shape live here so they cannot drift.
 */
export function resolveReportTotalsQuery(
  raw: RawReportTotalsQuery,
  defaults: { defaultGroupBy: ReportGroupBy; clock: () => string }
): ReportTotalsQueryResolution {
  const rawGroupBy = raw.groupBy ?? defaults.defaultGroupBy
  if (!REPORT_GROUP_BYS.includes(rawGroupBy as ReportGroupBy)) {
    return { ok: false, message: `Invalid "groupBy". Use one of: ${REPORT_GROUP_BYS.join(', ')}.` }
  }

  const from = raw.from ?? undefined
  const to = raw.to ?? defaults.clock()
  if (from && !isValidISODate(from)) {
    return { ok: false, message: 'Invalid "from" date. Use YYYY-MM-DD.' }
  }
  if (to && !isValidISODate(to)) {
    return { ok: false, message: 'Invalid "to" date. Use YYYY-MM-DD.' }
  }

  return {
    ok: true,
    filters: {
      projectId: raw.projectId ?? undefined,
      userId: raw.userId ?? undefined,
      from,
      to,
    },
    groupBy: rawGroupBy as ReportGroupBy,
  }
}

/**
 * Scoped grouped aggregates with the totals reduced from the returned buckets.
 * The scope itself is applied inside the persistence adapter (RLS RPC or SQL
 * scope), never in this reducer.
 */
export async function getReportTotals(
  actor: Actor,
  filters: ReportTotalsInput,
  groupBy: ReportGroupBy,
  deps: ReportingDeps
): Promise<ReportTotals> {
  const byGroup = await deps.persistence.getGroupedReportTotals(actor, filters, groupBy)
  return {
    totalHours: byGroup.reduce((sum, b) => sum + (Number(b.hours) || 0), 0),
    totalEntries: byGroup.reduce((sum, b) => sum + b.entries, 0),
    byGroup,
  }
}

/** Raw timesheet CSV export query as extracted by a transport. */
export interface RawReportExportQuery {
  project?: string | null
  user?: string | null
  from?: string | null
  to?: string | null
}

/** Scoped filters plus the derived filename for a CSV export. */
export interface ReportExportScope {
  filters: {
    userId?: string
    projectId?: string
    dateFrom?: string
    dateTo?: string
  }
  filename: string
}

/**
 * Server-side scope enforcement and filename derivation for the streaming CSV
 * export. Ordinary users are pinned to their own `userId`, so a forged query
 * string cannot widen the export beyond their RLS/SQL-visible rows; admins and
 * leaders may keep an explicit user filter. Filename derivation is shared while
 * the actual download/save mechanism stays platform-local in each transport.
 */
export function resolveReportExportScope(
  actor: Actor,
  query: RawReportExportQuery,
  deps: ReportingDeps
): ReportExportScope {
  const today = deps.clock()
  const projectId = query.project && query.project !== 'all' ? query.project : undefined
  let userId = query.user && query.user !== 'all' ? query.user : undefined
  if (!canSeeAllActor(actor) && !isLeaderActor(actor)) {
    userId = actor.id
  }
  const dateFrom = query.from || undefined
  const dateTo = query.to || today

  const cleanFrom = (query.from || 'all').replace(/-/g, '')
  const cleanTo = (query.to || today).replace(/-/g, '')

  return {
    filters: { userId, projectId, dateFrom, dateTo },
    filename: `timesheets_${cleanFrom}_${cleanTo}.csv`,
  }
}

/**
 * One scoped page of timesheet rows for the streaming CSV export. The caller
 * owns the paging loop and chunk encoding; scope is supplied by
 * `resolveReportExportScope`, so this stays a thin, provider-neutral read.
 */
export async function listReportCsvPage(
  actor: Actor,
  scope: ReportExportScope['filters'],
  page: { from: number; to: number; includeCount: boolean },
  deps: ReportingDeps
): Promise<TimesheetListResult> {
  return deps.persistence.listTimesheets(actor, { ...scope, ...page })
}
