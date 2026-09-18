// lib/db/native/timesheets.ts
// Native PostgreSQL implementation of TimesheetPersistence.
import 'server-only'

import { query } from '@/lib/db/pool'
import { canSeeAllActor, isAdminActor, isLeaderActor, hasPermission } from '@/lib/roles'
import { sanitizeWorkDone, type BackfillSettings } from '@/lib/validation'
import type { Timesheet, TimesheetRow } from '@/app/types'
import type {
  Actor,
  BulkTimesheetUpdate,
  BulkTimesheetUpdateResult,
  DbWrite,
  TimesheetInput,
  TimesheetListOptions,
  TimesheetListResult,
} from '@/lib/db/repository'
import type { TimesheetPersistence } from '@/lib/domain/timesheets-port'

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

function friendlyWriteError(err: unknown): string {
  const e = err as { code?: string; constraint?: string } | null
  if (e?.code === '23505') {
    if (e.constraint?.includes('leaves')) {
      return 'One or more of those leave dates is already marked.'
    }
    return 'A record with that value already exists.'
  }
  if (e?.code === '23503') {
    return 'This record is referenced by other data and cannot be changed.'
  }
  return 'Something went wrong. Please try again.'
}

async function write(sql: string, params?: unknown[]): Promise<DbWrite> {
  try {
    await query(sql, params)
    return { error: null }
  } catch (err) {
    return { error: friendlyWriteError(err) }
  }
}

export function timesheetScope(actor: Actor): { where: string; params: unknown[] } {
  if (canSeeAllActor(actor)) return { where: '', params: [] }
  if (isLeaderActor(actor)) {
    return {
      where: 'where (t.user_id = $1 or t.user_id = any(public.team_ids($1)))',
      params: [actor.id],
    }
  }
  return { where: 'where t.user_id = $1', params: [actor.id] }
}

export const nativeTimesheetPersistence: TimesheetPersistence = {
  async list(actor: Actor, opts: TimesheetListOptions = {}): Promise<TimesheetListResult> {
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
    let where = scopeWhere
    if (filterConds.length > 0) {
      where = scopeWhere
        ? `${scopeWhere} and ${filterConds.join(' and ')}`
        : `where ${filterConds.join(' and ')}`
    }

    let count = 0
    if (opts.includeCount !== false) {
      const countRows = await query<{ c: number }>(
        `select count(*)::int as c from public.timesheets t ${where}`,
        [...baseParams, ...filterParams]
      )
      count = countRows[0]?.c ?? 0
    }

    let sql = `select
        t.id, t.user_id, t.project_id, t.activity_type_id, t.log_date, t.hours_worked, t.work_done, t.created_at,
        p.name as project_name, pr.email as user_email, at.name as activity_type_name
      from public.timesheets t
      left join public.projects p on p.id = t.project_id
      left join public.profiles pr on pr.id = t.user_id
      left join public.activity_types at on at.id = t.activity_type_id
      ${where}
      order by t.log_date desc, t.id desc`

    const params = [...baseParams, ...filterParams]
    if (opts.from !== undefined || opts.to !== undefined) {
      const from = opts.from ?? 0
      const to = opts.to ?? from + 999
      const limit = to - from + 1
      sql += ` limit $${params.length + 1} offset $${params.length + 2}`
      params.push(limit, from)
    } else if (opts.limit !== undefined) {
      sql += ` limit $${params.length + 1}`
      params.push(opts.limit)
    }

    const rows = await query<TimesheetJoinedRow>(sql, params)
    return { rows: rows.map(mapTimesheet), count }
  },

  async getBackfillWindow(_actor: Actor): Promise<BackfillSettings> {
    const rows = await query<{
      backfill_window_days: number
      backfill_mode: 'days' | 'month_start'
      backfill_extra_days: number
    }>(
      'select backfill_window_days, backfill_mode, backfill_extra_days from public.app_settings where id = 1 limit 1'
    )
    const row = rows[0]
    return {
      mode: row?.backfill_mode === 'month_start' ? 'month_start' : 'days',
      windowDays:
        typeof row?.backfill_window_days === 'number' && row.backfill_window_days >= 0
          ? row.backfill_window_days
          : 1,
      extraDays:
        typeof row?.backfill_extra_days === 'number' && row.backfill_extra_days >= 0
          ? row.backfill_extra_days
          : 0,
    }
  },

  async getById(actor: Actor, id: string): Promise<TimesheetRow | null> {
    const where = canSeeAllActor(actor) ? 'id = $1' : 'id = $1 and user_id = $2'
    const params: unknown[] = canSeeAllActor(actor) ? [id] : [id, actor.id]
    const rows = await query<TimesheetJoinedRow>(
      `select
        t.id, t.user_id, t.project_id, t.activity_type_id, t.log_date, t.hours_worked, t.work_done, t.created_at,
        p.name as project_name, pr.email as user_email, at.name as activity_type_name
      from public.timesheets t
      left join public.projects p on p.id = t.project_id
      left join public.profiles pr on pr.id = t.user_id
      left join public.activity_types at on at.id = t.activity_type_id
      where t.${where}`,
      params
    )
    return rows[0] ? mapTimesheet(rows[0]) : null
  },

  async getByIds(actor: Actor, ids: string[]): Promise<TimesheetRow[]> {
    if (!ids || ids.length === 0) return []
    const where = canSeeAllActor(actor)
      ? 't.id = ANY($1::uuid[])'
      : 't.id = ANY($1::uuid[]) and t.user_id = $2'
    const params: unknown[] = canSeeAllActor(actor) ? [ids] : [ids, actor.id]
    const rows = await query<TimesheetJoinedRow>(
      `select
        t.id, t.user_id, t.project_id, t.activity_type_id, t.log_date, t.hours_worked, t.work_done, t.created_at,
        p.name as project_name, pr.email as user_email, at.name as activity_type_name
      from public.timesheets t
      left join public.projects p on p.id = t.project_id
      left join public.profiles pr on pr.id = t.user_id
      left join public.activity_types at on at.id = t.activity_type_id
      where ${where}`,
      params
    )
    return rows.map(mapTimesheet)
  },

  async getByUserDate(actor: Actor, userId: string, logDate: string): Promise<TimesheetRow | null> {
    if (!canSeeAllActor(actor) && userId !== actor.id) return null
    const rows = await query<TimesheetJoinedRow>(
      `select
        t.id, t.user_id, t.project_id, t.activity_type_id, t.log_date, t.hours_worked, t.work_done, t.created_at,
        p.name as project_name, pr.email as user_email, at.name as activity_type_name
      from public.timesheets t
      left join public.projects p on p.id = t.project_id
      left join public.profiles pr on pr.id = t.user_id
      left join public.activity_types at on at.id = t.activity_type_id
      where t.user_id = $1 and t.log_date = $2
      limit 1`,
      [userId, logDate]
    )
    return rows[0] ? mapTimesheet(rows[0]) : null
  },

  async countByProject(actor: Actor, projectId: string): Promise<number> {
    if (!hasPermission(actor, ['admin', 'pm'])) return 0
    const rows = await query<{ c: number }>(
      'select count(*)::int as c from public.timesheets where project_id = $1',
      [projectId]
    )
    return rows[0]?.c ?? 0
  },

  async getLatest(actor: Actor, userId: string): Promise<TimesheetRow | null> {
    if (!canSeeAllActor(actor) && userId !== actor.id) return null
    const rows = await query<TimesheetJoinedRow>(
      `select
        t.id, t.user_id, t.project_id, t.activity_type_id, t.log_date, t.hours_worked, t.work_done, t.created_at,
        p.name as project_name, pr.email as user_email, at.name as activity_type_name
      from public.timesheets t
      left join public.projects p on p.id = t.project_id
      left join public.profiles pr on pr.id = t.user_id
      left join public.activity_types at on at.id = t.activity_type_id
      where t.user_id = $1
      order by t.log_date desc, t.created_at desc
      limit 1`,
      [userId]
    )
    return rows[0] ? mapTimesheet(rows[0]) : null
  },

  async sumHoursForUserDate(
    actor: Actor,
    userId: string,
    logDate: string,
    excludeEntryId?: string
  ): Promise<number> {
    if (!canSeeAllActor(actor) && userId !== actor.id) return 0
    const rows = await query<{ h: number }>(
      `select coalesce(sum(hours_worked), 0)::float8 as h
       from public.timesheets
       where user_id = $1 and log_date = $2 and ($3::uuid is null or id <> $3)`,
      [userId, logDate, excludeEntryId ?? null]
    )
    return Number(rows[0]?.h ?? 0)
  },

  async sumHoursForUserDates(
    actor: Actor,
    userDatePairs: Array<{ userId: string; logDate: string }>
  ): Promise<Map<string, number>> {
    const totals = new Map<string, number>()
    if (!userDatePairs || userDatePairs.length === 0) return totals

    const distinctMap = new Map<string, { userId: string; logDate: string }>()
    for (const p of userDatePairs) {
      const key = `${p.userId}:${p.logDate}`
      totals.set(key, 0)
      distinctMap.set(key, p)
    }

    const distinctPairs = Array.from(distinctMap.values())
    const PAIR_BATCH_SIZE = 500
    for (let offset = 0; offset < distinctPairs.length; offset += PAIR_BATCH_SIZE) {
      const chunk = distinctPairs.slice(offset, offset + PAIR_BATCH_SIZE)
      const uIds = chunk.map((p) => p.userId)
      const lDates = chunk.map((p) => p.logDate)

      const params: unknown[] = [uIds, lDates]
      let whereClause = ''
      if (!canSeeAllActor(actor)) {
        whereClause = 'where t.user_id = $3'
        params.push(actor.id)
      }

      const rows = await query<{ user_id: string; log_date: string; total: string | number }>(
        `select t.user_id, t.log_date, coalesce(sum(t.hours_worked), 0)::float8 as total
         from public.timesheets t
         join (
           select u.u_id, d.l_date
           from unnest($1::uuid[]) with ordinality as u(u_id, n)
           join unnest($2::date[]) with ordinality as d(l_date, n) using (n)
         ) as v on t.user_id = v.u_id and t.log_date = v.l_date
         ${whereClause}
         group by t.user_id, t.log_date`,
        params
      )

      for (const r of rows) {
        totals.set(`${r.user_id}:${r.log_date}`, Number(r.total) || 0)
      }
    }
    return totals
  },

  async create(actor: Actor, input: TimesheetInput): Promise<DbWrite> {
    const targetId = input.userId
    if (!isAdminActor(actor)) {
      if (targetId !== actor.id) return { error: 'You can only log your own entries.' }
      if (!actor.isActive) return { error: 'Your account is not active.' }
    }
    try {
      const rows = await query<{ id: string }>(
        `insert into public.timesheets (user_id, project_id, activity_type_id, log_date, hours_worked, work_done)
         values ($1, $2, $3, $4, $5, $6) returning id`,
        [
          targetId,
          input.projectId,
          input.activityTypeId,
          input.logDate,
          input.hoursWorked,
          sanitizeWorkDone(input.workDone),
        ]
      )
      return { id: rows[0]?.id, error: null }
    } catch (err) {
      return { error: friendlyWriteError(err) }
    }
  },

  async update(actor: Actor, id: string, input: TimesheetInput): Promise<DbWrite> {
    if (isAdminActor(actor)) {
      return write(
        `update public.timesheets
         set project_id = $1, activity_type_id = $2, log_date = $3, hours_worked = $4, work_done = $5
         where id = $6`,
        [
          input.projectId,
          input.activityTypeId,
          input.logDate,
          input.hoursWorked,
          sanitizeWorkDone(input.workDone),
          id,
        ]
      )
    }
    return write(
      `update public.timesheets
       set project_id = $1, activity_type_id = $2, log_date = $3, hours_worked = $4, work_done = $5
       where id = $6 and user_id = $7
         and exists (
           select 1 from public.app_settings s
           where s.id = 1
             and log_date <= current_date
             and (
               (s.backfill_mode = 'days' and log_date >= current_date - s.backfill_window_days)
               or (s.backfill_mode = 'month_start' and log_date >= date_trunc('month', current_date)::date - s.backfill_extra_days)
             )
              and $3::date <= current_date
              and (
                (s.backfill_mode = 'days' and $3::date >= current_date - s.backfill_window_days)
                or (s.backfill_mode = 'month_start' and $3::date >= date_trunc('month', current_date)::date - s.backfill_extra_days)
              )
          )`,
      [
        input.projectId,
        input.activityTypeId,
        input.logDate,
        input.hoursWorked,
        sanitizeWorkDone(input.workDone),
        id,
        actor.id,
      ]
    )
  },

  async remove(actor: Actor, id: string): Promise<DbWrite> {
    if (isAdminActor(actor)) {
      return write('delete from public.timesheets where id = $1', [id])
    }
    return write(
      `delete from public.timesheets as t
       where t.id = $1 and t.user_id = $2
         and exists (
           select 1 from public.app_settings s
           where s.id = 1
             and t.log_date <= current_date
             and (
               (s.backfill_mode = 'days' and t.log_date >= current_date - s.backfill_window_days)
               or (s.backfill_mode = 'month_start' and t.log_date >= date_trunc('month', current_date)::date - s.backfill_extra_days)
             )
         )`,
      [id, actor.id]
    )
  },

  async bulkUpdate(
    actor: Actor,
    rows: BulkTimesheetUpdate[]
  ): Promise<BulkTimesheetUpdateResult> {
    const empty: BulkTimesheetUpdateResult = { updated: 0, rowErrors: [], error: null }
    if (!Array.isArray(rows) || rows.length === 0) return empty

    const canEditAll = isAdminActor(actor)
    const params: unknown[] = []
    const valueTuples: string[] = []

    rows.forEach((row, index) => {
      const base = index * 6
      params.push(
        row.id,
        row.projectId,
        row.activityTypeId || null,
        row.logDate,
        row.hoursWorked,
        sanitizeWorkDone(row.workDone)
      )
      valueTuples.push(
        `($${base + 1}::uuid, $${base + 2}::uuid, $${base + 3}::uuid, $${base + 4}::date, $${base + 5}::numeric, $${base + 6}::text)`
      )
    })

    let scope = 't.id = v.id'
    if (!canEditAll) {
      params.push(actor.id)
      const actorIdx = params.length
      scope = `t.id = v.id and t.user_id = $${actorIdx}
         and exists (
           select 1 from public.app_settings s
           where s.id = 1
             and v.log_date <= current_date
             and (
               (s.backfill_mode = 'days' and v.log_date >= current_date - s.backfill_window_days)
               or (s.backfill_mode = 'month_start' and v.log_date >= date_trunc('month', current_date)::date - s.backfill_extra_days)
             )
             and t.log_date <= current_date
             and (
               (s.backfill_mode = 'days' and t.log_date >= current_date - s.backfill_window_days)
               or (s.backfill_mode = 'month_start' and t.log_date >= date_trunc('month', current_date)::date - s.backfill_extra_days)
             )
         )`
    }

    try {
      const res = await query<{ id: string }>(
        `update public.timesheets as t
         set project_id = v.project_id,
             activity_type_id = v.activity_type_id,
             log_date = v.log_date,
             hours_worked = v.hours_worked,
             work_done = v.work_done
         from (values ${valueTuples.join(', ')})
           as v(id, project_id, activity_type_id, log_date, hours_worked, work_done)
         where ${scope}
         returning t.id`,
        params
      )
      const updatedIds = new Set(res.map((r) => r.id))
      const rowErrors: Array<{ id: string; error: string }> = []
      for (const row of rows) {
        if (!updatedIds.has(row.id)) {
          rowErrors.push({
            id: row.id,
            error: canEditAll ? 'not found' : 'you can only modify your own entries',
          })
        }
      }
      return {
        updated: res.length,
        rowErrors,
        error: rowErrors.length === rows.length ? 'All edits failed.' : null,
      }
    } catch (err) {
      return { ...empty, error: friendlyWriteError(err) }
    }
  },
}
