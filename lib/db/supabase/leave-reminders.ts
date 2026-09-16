import 'server-only'

import type { GlobalReminder, LeaveEntry, Reminder } from '@/app/types'
import {
  canonicalEffectPayload,
} from '@/lib/idempotency-effect'
import {
  DuplicateDeliveryError,
  getStampScope,
  IdempotencyConflictError,
  UnrecoverableDeliveryError,
} from '@/lib/idempotency-key'
import { isAdminActor } from '@/lib/roles'
import { getMobileSupabaseClient } from '@/lib/supabase/bearer'
import { createClient } from '@/lib/supabase/server'
import type { Actor, DbCreateResult, DbWrite, LeafRowInput } from '../repository'
import type { LeaveListQuery, LeaveReminderPersistence } from '@/lib/domain/leave-reminders-port'

async function server() {
  const mobileClient = getMobileSupabaseClient()
  if (mobileClient) return mobileClient
  return createClient()
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

function writeReturningError<T>(
  data: T | null,
  err: { message?: string; code?: string } | null
): DbCreateResult<T> {
  if (!err && data) return { data, error: null }
  if (!err && !data) return { data: null, error: 'Record could not be created.' }
  if (err?.code === '23505') {
    return { data: null, error: 'A record with that value already exists.' }
  }
  if (err?.code === '23503') {
    return { data: null, error: 'This record is referenced by other data and cannot be changed.' }
  }
  return { data: null, error: err?.message || 'Database write failed.' }
}

async function executeSelectSingle(targetQuery: unknown): Promise<{
  data: unknown
  error: { message?: string; code?: string } | null
}> {
  const q = targetQuery as {
    select: () => {
      single: () => Promise<{
        data: unknown
        error: { message?: string; code?: string } | null
      }>
    }
  }
  return q.select().single()
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

interface EffectCapableClient {
  from(table: string): {
    select(cols: string): {
      eq(col: string, val: string): {
        eq(col: string, val: string): {
          limit(n: number): {
            maybeSingle(): Promise<{
              data: IdempotencyEffectRow | null
              error: { message: string } | null
            }>
          }
        }
      }
    }
  }
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

export const supabaseLeaveReminderPersistence: LeaveReminderPersistence = {
  async listLeaves(actor: Actor, opts: LeaveListQuery = {}): Promise<LeaveEntry[]> {
    const supabase = await server()
    let query = supabase.from('leaves').select('*').order('leave_date', { ascending: true })

    if (isAdminActor(actor)) {
      if (opts.userId) query = query.eq('user_id', opts.userId)
    } else {
      query = query.eq('user_id', actor.id)
    }

    if (opts.from) query = query.gte('leave_date', opts.from)
    if (opts.to) query = query.lte('leave_date', opts.to)
    query = query.limit(1000)

    const { data, error } = await query
    if (error) throw new Error(error.message)
    return (data as LeaveEntry[]) ?? []
  },

  async createLeaves(actor: Actor, rows: LeafRowInput[]): Promise<DbWrite> {
    if (rows.length === 0) return { error: null }
    if (!isAdminActor(actor)) {
      for (const row of rows) {
        if (row.userId !== actor.id) {
          return { error: 'You can only mark leave for yourself.' }
        }
      }
    }
    const supabase = await server()
    const scope = getStampScope()

    if (scope) {
      const rpcClient = supabase as unknown as RpcCapableClient
      const { error } = await rpcClient.rpc('create_leaves_idempotent', {
        p_key: scope.key,
        p_rows: canonicalEffectPayload('create_leave', { rows }, actor.id),
      })
      if (error) {
        await throwIfDuplicateEffect(supabase, scope, error)
        return writeError(error)
      }
      return { error: null }
    }

    const query = withIdempotencyEffectHeaders(
      supabase.from('leaves').insert(
        rows.map((r) => ({
          user_id: r.userId,
          leave_date: r.leaveDate,
          reason: r.reason,
        }))
      ),
      scope
    )
    const { error } = await query
    if (error) {
      await throwIfDuplicateEffect(supabase, scope, error)
      return writeError(error)
    }
    return { error: null }
  },

  async deleteLeave(actor: Actor, id: string): Promise<DbWrite> {
    const supabase = await server()
    const scope = getStampScope()
    await guardIdempotencyEffect(supabase, scope, canonicalEffectPayload('delete_leave', { id }, actor.id))
    let query = withIdempotencyEffectHeaders(supabase.from('leaves').delete(), scope)
    if (!isAdminActor(actor)) query = query.eq('user_id', actor.id)
    const { error } = await query.eq('id', id)
    await throwIfDuplicateEffect(supabase, scope, error)
    return writeError(error)
  },

  async listReminders(actor: Actor, _userId: string): Promise<Reminder[]> {
    const supabase = await server()
    const { data, error } = await supabase
      .from('reminders')
      .select('*')
      .eq('user_id', actor.id)
      .order('remind_at', { ascending: true })
      .limit(50)
    if (error) throw new Error(error.message)
    return (data as Reminder[]) ?? []
  },

  async createReminder(
    actor: Actor,
    input: { userId: string; message: string; remindAt: string }
  ): Promise<DbWrite> {
    const userId = isAdminActor(actor) ? input.userId : actor.id
    const supabase = await server()
    const scope = getStampScope()
    await guardIdempotencyEffect(
      supabase,
      scope,
      canonicalEffectPayload('create_reminder', { ...input, userId }, actor.id)
    )
    const query = withIdempotencyEffectHeaders(
      supabase.from('reminders').insert({
        user_id: userId,
        message: input.message,
        remind_at: input.remindAt,
      }),
      scope
    )
    const { error } = await query
    if (error) {
      await throwIfDuplicateEffect(supabase, scope, error)
      return writeError(error)
    }
    return { error: null }
  },

  async updateReminder(
    actor: Actor,
    id: string,
    input: { done: boolean }
  ): Promise<DbWrite> {
    const supabase = await server()
    const scope = getStampScope()
    await guardIdempotencyEffect(
      supabase,
      scope,
      canonicalEffectPayload('update_reminder', { id, done: input.done }, actor.id)
    )
    const query = withIdempotencyEffectHeaders(
      supabase
        .from('reminders')
        .update({ done: input.done })
        .eq('id', id)
        .eq('user_id', actor.id),
      scope
    )
    const { error } = await query
    await throwIfDuplicateEffect(supabase, scope, error)
    return writeError(error)
  },

  async deleteReminder(actor: Actor, id: string): Promise<DbWrite> {
    const supabase = await server()
    const scope = getStampScope()
    await guardIdempotencyEffect(supabase, scope, canonicalEffectPayload('delete_reminder', { id }, actor.id))
    const query = withIdempotencyEffectHeaders(
      supabase.from('reminders').delete().eq('id', id).eq('user_id', actor.id),
      scope
    )
    const { error } = await query
    await throwIfDuplicateEffect(supabase, scope, error)
    return writeError(error)
  },

  async listGlobalReminders(_actor: Actor): Promise<GlobalReminder[]> {
    const supabase = await server()
    const { data, error } = await supabase
      .from('global_reminders')
      .select('*')
      .order('remind_at', { ascending: true })
    if (error) throw new Error(error.message)
    return (data as GlobalReminder[]) ?? []
  },

  async listDueGlobalReminders(actor: Actor): Promise<GlobalReminder[]> {
    const supabase = await server()
    const now = new Date().toISOString()
    const { data, error } = await supabase
      .from('global_reminders')
      .select('*')
      .lte('remind_at', now)
      .order('remind_at', { ascending: true })
    if (error) throw new Error(error.message)
    if (!data || data.length === 0) return []

    const { data: dismissals } = await supabase
      .from('global_reminder_dismissals')
      .select('reminder_id')
      .eq('user_id', actor.id)
    const dismissed = new Set((dismissals ?? []).map((d) => d.reminder_id))

    return (data as GlobalReminder[]).filter((r) => !dismissed.has(r.id))
  },

  async createGlobalReminder(
    actor: Actor,
    input: { message: string; remindAt: string }
  ): Promise<DbCreateResult<GlobalReminder>> {
    if (!isAdminActor(actor)) return { data: null, error: 'You do not have permission to perform this action.' }
    const supabase = await server()
    const { data, error } = await executeSelectSingle(
      supabase.from('global_reminders').insert({ message: input.message, remind_at: input.remindAt })
    )
    return writeReturningError(data as GlobalReminder, error)
  },

  async updateGlobalReminder(
    actor: Actor,
    id: string,
    input: { message?: string; remindAt?: string }
  ): Promise<DbWrite> {
    if (!isAdminActor(actor)) return { error: 'You do not have permission to perform this action.' }
    const supabase = await server()
    const updates: { message?: string; remind_at?: string } = {}
    if (input.message !== undefined) updates.message = input.message.trim()
    if (input.remindAt !== undefined) updates.remind_at = input.remindAt
    if (Object.keys(updates).length === 0) return { error: null }

    const { error } = await supabase
      .from('global_reminders')
      .update(updates)
      .eq('id', id)
    return writeError(error)
  },

  async deleteGlobalReminder(actor: Actor, id: string): Promise<DbWrite> {
    if (!isAdminActor(actor)) return { error: 'You do not have permission to perform this action.' }
    const supabase = await server()
    const { error } = await supabase.from('global_reminders').delete().eq('id', id)
    return writeError(error)
  },

  async dismissGlobalReminder(actor: Actor, reminderId: string): Promise<DbWrite> {
    const supabase = await server()
    const { error } = await supabase
      .from('global_reminder_dismissals')
      .upsert({ user_id: actor.id, reminder_id: reminderId }, { onConflict: 'user_id,reminder_id' })
    return writeError(error)
  },
}
