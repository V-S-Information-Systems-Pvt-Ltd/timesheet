// lib/db/supabase/timesheets.ts
// Supabase PostgREST & RPC implementation of TimesheetPersistence.
import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { getMobileSupabaseClient } from '@/lib/supabase/bearer'
import { getAdminClient } from '@/lib/supabase/admin'
import { canSeeAllActor, isAdminActor, isLeaderActor, hasPermission } from '@/lib/roles'
import { sanitizeWorkDone, type BackfillSettings } from '@/lib/validation'
import { logger, extractError } from '@/lib/logger'
import {
  getStampScope,
  DuplicateDeliveryError,
  UnrecoverableDeliveryError,
  IdempotencyConflictError,
} from '@/lib/idempotency-key'
import { canonicalEffectPayload } from '@/lib/idempotency-effect'
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

async function server() {
  const mobileClient = getMobileSupabaseClient()
  if (mobileClient) return mobileClient
  return createClient()
}

const TS_SELECT = '*, projects(name), profiles(email), activity_types(name)'

export async function getSubordinateIds(supabase: unknown, leaderId: string): Promise<string[]> {
  const client = supabase as {
    rpc: (
      name: string,
      args: Record<string, unknown>
    ) => Promise<{ data: unknown; error: { message: string } | null }>
  }
  try {
    const { data, error } = await client.rpc('team_ids', { root_id: leaderId })
    if (error) {
      logger.error('team_ids RPC error', { leaderId, error: error.message })
      throw new Error(`Subordinate lookup failed: ${error.message}`)
    }
    if (Array.isArray(data)) {
      return data.map((x) =>
        typeof x === 'string'
          ? x
          : x && typeof x === 'object' && 'subordinate_id' in x
            ? String((x as { subordinate_id: unknown }).subordinate_id)
            : x && typeof x === 'object' && 'id' in x
              ? String((x as { id: unknown }).id)
              : String(x)
      )
    }
    return []
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Subordinate lookup failed:')) throw err
    logger.error('Failed to lookup subordinate IDs', { leaderId, error: extractError(err) })
    throw new Error(`Subordinate lookup failed: ${extractError(err)}`)
  }
}

function writeError(err: { message?: string; code?: string; details?: string } | null): DbWrite {
  if (!err) return { error: null }
  const message = err.message ?? ''
  if (err.code === '23505') {
    if (message.includes('leaves') || err.details?.includes('leaves')) {
      return { error: 'One or more of those leave dates is already marked.' }
    }
    return { error: 'A record with that value already exists.' }
  }
  if (err.code === '23503') {
    return { error: 'This record is referenced by other data and cannot be changed.' }
  }
  return { error: 'Something went wrong. Please try again.' }
}

interface IdempotencyEffectRow {
  response_status: number
  effect_fingerprint: string | null
  resource_id: string | null
}

interface RpcCapableClient {
  rpc(
    name: string,
    args: Record<string, unknown>
  ): Promise<{ data: unknown; error: { message: string } | null }>
}

async function readIdempotencyEffect(
  supabase: EffectCapableClient,
  key: string,
  operation: string
): Promise<IdempotencyEffectRow | null> {
  const { data, error } = await supabase
    .from('idempotency_effects')
    .select('response_status, effect_fingerprint, resource_id')
    .eq('key', key)
    .eq('operation', operation)
    .limit(1)
    .maybeSingle()
  if (error) {
    throw new Error(`Idempotency effect lookup failed: ${error.message}`)
  }
  return data
}

async function computeEffectFingerprint(
  supabase: unknown,
  operation: string,
  payload: unknown
): Promise<string> {
  const client = supabase as RpcCapableClient
  const { data, error } = await client.rpc('idempotency_effect_fingerprint', {
    p_operation: operation,
    p_payload: payload,
  })
  if (error) {
    throw new Error(`Idempotency fingerprint failed: ${error.message}`)
  }
  if (typeof data !== 'string' || data.length === 0) {
    throw new Error('Idempotency fingerprint returned no value.')
  }
  return data
}

interface EffectQueryBuilder {
  eq(col: string, val: string): EffectQueryBuilder
  limit(n: number): EffectQueryBuilder
  maybeSingle(): Promise<{
    data: IdempotencyEffectRow | null
    error: { message: string } | null
  }>
}

interface EffectCapableClient {
  from(table: string): { select(cols: string): EffectQueryBuilder }
}

function effectClient(supabase: unknown): EffectCapableClient {
  return supabase as EffectCapableClient
}

function withIdempotencyEffectHeaders<T>(query: T, scope: ReturnType<typeof getStampScope>): T {
  if (!scope) return query
  const headerable = query as T & {
    setHeader?: (name: string, value: string) => unknown
  }
  if (typeof headerable.setHeader !== 'function') {
    throw new Error('Supabase PostgREST builder does not support request headers.')
  }
  headerable.setHeader('x-vsis-idempotency-key', scope.key)
  headerable.setHeader('x-vsis-idempotency-operation', scope.operation)
  return query
}

async function guardIdempotencyEffect(
  supabase: unknown,
  scope: ReturnType<typeof getStampScope>,
  payload: unknown
): Promise<void> {
  if (!scope) return
  const existing = await readIdempotencyEffect(effectClient(supabase), scope.key, scope.operation)
  if (!existing) {
    if (scope.recoverOnly) throw new UnrecoverableDeliveryError(scope.operation, scope.key)
    return
  }
  if (existing.effect_fingerprint) {
    const incoming = await computeEffectFingerprint(supabase, scope.operation, payload)
    if (incoming !== existing.effect_fingerprint) {
      throw new IdempotencyConflictError(scope.operation, scope.key)
    }
  }
  throw new DuplicateDeliveryError(scope.operation, scope.key)
}

async function throwIfDuplicateEffect(
  supabase: unknown,
  scope: ReturnType<typeof getStampScope>,
  error: { code?: string; message?: string } | null
): Promise<void> {
  if (!scope) return
  if (error?.message?.startsWith('IDEMPOTENCY_CONFLICT')) {
    throw new IdempotencyConflictError(scope.operation, scope.key)
  }
  if (error?.code === '23505') {
    const existing = await readIdempotencyEffect(effectClient(supabase), scope.key, scope.operation)
    if (existing) throw new DuplicateDeliveryError(scope.operation, scope.key)
  }
}

export const supabaseTimesheetPersistence: TimesheetPersistence = {
  async list(actor: Actor, opts: TimesheetListOptions = {}): Promise<TimesheetListResult> {
    const supabase = await server()
    let query = supabase
      .from('timesheets')
      .select(TS_SELECT, opts.includeCount === false ? {} : { count: 'exact' })
      .order('log_date', { ascending: false })
      .order('id', { ascending: false })

    if (!canSeeAllActor(actor)) {
      if (isLeaderActor(actor)) {
        const teamIds = await getSubordinateIds(supabase, actor.id)
        const ids = [actor.id, ...teamIds]
        query = query.in('user_id', ids)
      } else {
        query = query.eq('user_id', actor.id)
      }
    }
    if (opts.userId) {
      query = query.eq('user_id', opts.userId)
    }

    if (opts.projectId) query = query.eq('project_id', opts.projectId)
    if (opts.dateFrom) query = query.gte('log_date', opts.dateFrom)
    if (opts.dateTo) query = query.lte('log_date', opts.dateTo)
    if (opts.from !== undefined || opts.to !== undefined) {
      const from = opts.from ?? 0
      const to = opts.to ?? from + 999
      query = query.range(from, to)
    } else if (opts.limit !== undefined) {
      query = query.limit(opts.limit)
    }
    const { data, error, count } = await query
    if (error) throw new Error(error.message)
    return {
      rows: (data as Timesheet[]) ?? [],
      count: count ?? 0,
    }
  },

  async getBackfillWindow(_actor: Actor): Promise<BackfillSettings> {
    const supabase = await server()
    const { data } = await supabase
      .from('app_settings')
      .select('backfill_window_days, backfill_mode, backfill_extra_days')
      .eq('id', 1)
      .limit(1)
      .maybeSingle()
    return {
      mode: data?.backfill_mode === 'month_start' ? 'month_start' : 'days',
      windowDays:
        data && typeof data.backfill_window_days === 'number' && data.backfill_window_days >= 0
          ? data.backfill_window_days
          : 1,
      extraDays:
        data && typeof data.backfill_extra_days === 'number' && data.backfill_extra_days >= 0
          ? data.backfill_extra_days
          : 0,
    }
  },

  async getById(actor: Actor, id: string): Promise<TimesheetRow | null> {
    const supabase = await server()
    let query = supabase.from('timesheets').select(TS_SELECT).eq('id', id)
    if (!canSeeAllActor(actor)) {
      if (isLeaderActor(actor)) {
        const teamIds = await getSubordinateIds(supabase, actor.id)
        query = query.in('user_id', [actor.id, ...teamIds])
      } else {
        query = query.eq('user_id', actor.id)
      }
    }
    const { data, error } = await query.maybeSingle()
    if (error) throw new Error(error.message)
    return (data as TimesheetRow | null) ?? null
  },

  async getByIds(actor: Actor, ids: string[]): Promise<TimesheetRow[]> {
    if (!ids || ids.length === 0) return []
    const supabase = await server()
    let query = supabase.from('timesheets').select(TS_SELECT).in('id', ids)
    if (!canSeeAllActor(actor)) {
      query = query.eq('user_id', actor.id)
    }
    const { data, error } = await query
    if (error) throw new Error(error.message)
    return ((data as Timesheet[]) ?? []).map((t) => ({
      id: t.id,
      user_id: t.user_id,
      project_id: t.project_id,
      activity_type_id: t.activity_type_id,
      log_date: t.log_date,
      hours_worked: Number(t.hours_worked),
      work_done: t.work_done,
      created_at: t.created_at,
      profiles: t.profiles,
      projects: t.projects,
      activity_types: t.activity_types,
    }))
  },

  async getByUserDate(actor: Actor, userId: string, logDate: string): Promise<TimesheetRow | null> {
    if (!canSeeAllActor(actor) && userId !== actor.id) {
      if (isLeaderActor(actor)) {
        const supabase = await server()
        const teamIds = await getSubordinateIds(supabase, actor.id)
        if (!teamIds.includes(userId)) return null
      } else {
        return null
      }
    }
    const supabase = await server()
    const { data, error } = await supabase
      .from('timesheets')
      .select('id, user_id, project_id, activity_type_id, log_date, hours_worked, work_done, created_at')
      .eq('user_id', userId)
      .eq('log_date', logDate)
      .limit(1)
      .maybeSingle()
    if (error) throw new Error(error.message)
    return (data as TimesheetRow | null) ?? null
  },

  async countByProject(actor: Actor, projectId: string): Promise<number> {
    if (!hasPermission(actor, ['admin', 'pm'])) return 0
    const supabase = await server()
    const { count, error } = await supabase
      .from('timesheets')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', projectId)
    if (error) throw new Error(error.message)
    return count ?? 0
  },

  async getLatest(actor: Actor, userId: string): Promise<TimesheetRow | null> {
    if (!canSeeAllActor(actor) && userId !== actor.id) {
      if (isLeaderActor(actor)) {
        const supabase = await server()
        const teamIds = await getSubordinateIds(supabase, actor.id)
        if (!teamIds.includes(userId)) return null
      } else {
        return null
      }
    }
    const supabase = await server()
    const { data, error } = await supabase
      .from('timesheets')
      .select('id, user_id, project_id, activity_type_id, log_date, hours_worked, work_done, created_at')
      .eq('user_id', userId)
      .order('log_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) throw new Error(error.message)
    return (data as TimesheetRow | null) ?? null
  },

  async sumHoursForUserDate(
    actor: Actor,
    userId: string,
    logDate: string,
    excludeEntryId?: string
  ): Promise<number> {
    if (!canSeeAllActor(actor) && userId !== actor.id) return 0
    const supabase = await server()
    const PAGE_SIZE = 1000
    let total = 0
    let from = 0

    for (;;) {
      let query = supabase
        .from('timesheets')
        .select('id, hours_worked', { count: 'exact' })
        .eq('user_id', userId)
        .eq('log_date', logDate)
      if (excludeEntryId) query = query.neq('id', excludeEntryId)
      query = query.order('id', { ascending: true }).range(from, from + PAGE_SIZE - 1)

      const { data, error, count } = await query
      if (error) throw new Error(error.message)

      const rows = (data as Array<{ hours_worked: number }>) || []
      total += rows.reduce((acc, row) => acc + (Number(row.hours_worked) || 0), 0)

      if (rows.length === 0) break
      from += rows.length
      if (typeof count === 'number' && from >= count) break
    }

    return total
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
    const PAIR_BATCH_SIZE = 200
    const supabase = await server()
    const PAGE_SIZE = 1000
    for (let offset = 0; offset < distinctPairs.length; offset += PAIR_BATCH_SIZE) {
      const chunk = distinctPairs.slice(offset, offset + PAIR_BATCH_SIZE)
      const chunkKeySet = new Set(chunk.map((p) => `${p.userId}:${p.logDate}`))
      const userIds = Array.from(new Set(chunk.map((p) => p.userId)))
      const logDates = Array.from(new Set(chunk.map((p) => p.logDate)))

      let from = 0

      for (;;) {
        let query = supabase
          .from('timesheets')
          .select('user_id, log_date, hours_worked', { count: 'exact' })
          .in('user_id', userIds)
          .in('log_date', logDates)
        query = query.order('id', { ascending: true }).range(from, from + PAGE_SIZE - 1)

        if (!canSeeAllActor(actor)) {
          query = query.eq('user_id', actor.id)
        }

        const { data, error, count } = await query
        if (error) throw new Error(error.message)

        const rows = (data as Array<{ user_id: string; log_date: string; hours_worked: number }>) || []
        for (const row of rows) {
          const key = `${row.user_id}:${row.log_date}`
          if (chunkKeySet.has(key)) {
            totals.set(key, (totals.get(key) || 0) + (Number(row.hours_worked) || 0))
          }
        }

        if (rows.length === 0) break
        from += rows.length
        if (typeof count === 'number' && from >= count) break
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
    const scope = getStampScope()
    const supabase = await server()
    await guardIdempotencyEffect(
      supabase,
      scope,
      canonicalEffectPayload('create_timesheet', input, actor.id)
    )
    const query = withIdempotencyEffectHeaders(
      supabase
        .from('timesheets')
        .insert({
          user_id: targetId,
          project_id: input.projectId,
          activity_type_id: input.activityTypeId,
          hours_worked: input.hoursWorked,
          work_done: sanitizeWorkDone(input.workDone),
          log_date: input.logDate,
        })
        .select('id')
        .maybeSingle(),
      scope
    )
    const { data, error } = await query
    if (error) {
      await throwIfDuplicateEffect(supabase, scope, error)
      return writeError(error)
    }
    const id = data ? (data as unknown as { id?: string }).id : undefined
    return { id, error: null }
  },

  async update(actor: Actor, id: string, input: TimesheetInput): Promise<DbWrite> {
    const scope = getStampScope()
    const supabase = await server()
    await guardIdempotencyEffect(
      supabase,
      scope,
      canonicalEffectPayload('update_timesheet', { id, ...input }, actor.id)
    )
    let query = withIdempotencyEffectHeaders(
      supabase
        .from('timesheets')
        .update({
          project_id: input.projectId,
          activity_type_id: input.activityTypeId,
          hours_worked: input.hoursWorked,
          work_done: sanitizeWorkDone(input.workDone),
          log_date: input.logDate,
        })
        .eq('id', id),
      scope
    )
    if (!isAdminActor(actor)) {
      query = query.eq('user_id', actor.id)
    }
    const { error } = await query
    await throwIfDuplicateEffect(supabase, scope, error)
    return writeError(error)
  },

  async remove(actor: Actor, id: string): Promise<DbWrite> {
    const scope = getStampScope()
    const supabase = await server()
    await guardIdempotencyEffect(
      supabase,
      scope,
      canonicalEffectPayload('delete_timesheet', { id }, actor.id)
    )
    let query = withIdempotencyEffectHeaders(
      supabase.from('timesheets').delete().eq('id', id),
      scope
    )
    if (!isAdminActor(actor)) {
      query = query.eq('user_id', actor.id)
    }
    const { error } = await query
    await throwIfDuplicateEffect(supabase, scope, error)
    return writeError(error)
  },

  async bulkUpdate(
    actor: Actor,
    rows: BulkTimesheetUpdate[]
  ): Promise<BulkTimesheetUpdateResult> {
    const empty = { updated: 0, rowErrors: [], error: null }
    if (!Array.isArray(rows) || rows.length === 0) return empty
    const admin = getAdminClient()
    const canEditAll = canSeeAllActor(actor)
    const idParams = rows.map((r) => r.id)
    const { data: owners, error: ownerErr } = await admin
      .from('timesheets')
      .select('id, user_id')
      .in('id', idParams)
    if (ownerErr) return { ...empty, error: ownerErr.message }
    const ownerByRow = new Map((owners ?? []).map((r) => [r.id, r.user_id]))
    const applicable = rows.filter((r) => canEditAll || ownerByRow.get(r.id) === actor.id)
    const rowErrors: Array<{ id: string; error: string }> = []
    for (const r of rows) {
      if (!canEditAll && ownerByRow.get(r.id) !== actor.id) {
        rowErrors.push({ id: r.id, error: 'you can only modify your own entries' })
      } else if (!ownerByRow.has(r.id)) {
        rowErrors.push({ id: r.id, error: 'not found' })
      }
    }
    if (applicable.length === 0) {
      return {
        updated: 0,
        rowErrors,
        error: rowErrors.length === rows.length ? 'All edits failed.' : null,
      }
    }
    const payload = applicable.map((r) => ({
      id: r.id,
      project_id: r.projectId,
      activity_type_id: r.activityTypeId,
      log_date: r.logDate,
      hours_worked: r.hoursWorked,
      work_done: sanitizeWorkDone(r.workDone),
    }))

    const { data, error: rpcErr } = await admin.rpc('bulk_update_timesheets', {
      p_actor_id: actor.id,
      p_can_edit_all: canEditAll,
      p_rows: payload,
    })

    if (rpcErr) {
      return { ...empty, rowErrors, error: rpcErr.message }
    }
    const updatedIds = new Set(((data ?? []) as Array<{ updated_id: string }>).map((r) => r.updated_id))
    for (const r of applicable) {
      if (!updatedIds.has(r.id)) {
        rowErrors.push({
          id: r.id,
          error: canEditAll ? 'not found' : 'you can only modify your own entries',
        })
      }
    }
    return { updated: updatedIds.size, rowErrors, error: rowErrors.length === rows.length ? 'All edits failed.' : null }
  },
}
