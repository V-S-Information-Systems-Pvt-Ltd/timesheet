// lib/db/supabase.ts
// Supabase implementation of the Repository interface. This is a thin mapping
// onto the Supabase server client; Row Level Security in Postgres does the
// heavy lifting for row-level authorization, while the actor-based role checks
// mirror the application logic in app/actions.ts.

import { createClient } from '@/lib/supabase/server'
import { getAdminClient } from '@/lib/supabase/admin'
import { isAdminActor } from '@/lib/roles'
import { isSuperAdmin } from '@/lib/auth/super-admin'
import { supabaseTimesheetPersistence } from './supabase/timesheets'
import { supabaseReferencePersistence } from './supabase/reference'
import { supabasePeopleIdentity, supabasePeoplePersistence } from './supabase/people'
import { supabaseReportingPersistence } from './supabase/reporting'
import { logger } from '@/lib/logger'
import type { Json } from '@/lib/supabase/database.types'
import type {
  AdminDashboardLayout,
  BackupPayload,
  BackupRestoreResult,
  DashboardLayout,
  GlobalReminder,
  LeaveEntry,
  MobileLayout,
  Reminder,
  WhitelistedDomain,
} from '@/app/types'
import { DEFAULT_ADMIN_LAYOUT, DEFAULT_DASHBOARD_LAYOUT } from '@/app/constants'
import { DEFAULT_MOBILE_LAYOUT } from '@/lib/layout'
import { normalizeBranding } from '@/lib/branding'
import type { BackfillSettings } from '@/lib/validation'
import { sanitizeWorkDone } from '@/lib/validation'
import { getStampScope, DuplicateDeliveryError, UnrecoverableDeliveryError, IdempotencyConflictError } from '@/lib/idempotency-key'
import { canonicalEffectPayload } from '@/lib/idempotency-effect'
import type {
  CreateUserInput,
  DbCreateResult,
  DbWrite,
  LeafRowInput,
  Repository,
  TimesheetInput,
  TimesheetListOptions,
} from './repository'

// Default to the user-scoped server client (createClient), so Postgres RLS
// executes under the authenticated user's session context. Privileged operations
// that genuinely require the service role (e.g. Supabase Auth admin, bulk restore/import,
// rate-limit token bucket, service-role only RPCs) explicitly call getAdminClient().
import { getMobileSupabaseClient } from '@/lib/supabase/bearer'

async function server() {
  const mobileClient = getMobileSupabaseClient()
  if (mobileClient) return mobileClient
  return createClient()
}



/**
 * Translate PostgREST errors into user-facing messages. Known PostgreSQL
 * error codes become friendly text; unknown codes return a generic message
 * and are logged through logger.error so internal database/schema details
 * never leak to clients.
 */
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
  logger.error('Supabase write error', { error: err.message, code: err.code, details: err.details })
  return { error: 'Something went wrong. Please try again.' }
}

function writeReturningError<T>(
  data: T | null,
  err: { message: string; code?: string; details?: string } | null
): DbCreateResult<T> {
  if (err) {
    return { data: null, error: writeError(err).error ?? 'Database operation failed.' }
  }
  if (!data) {
    return { data: null, error: 'Record could not be created.' }
  }
  return { data, error: null }
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

interface RpcCapableClient {
  rpc(
    name: string,
    args: Record<string, unknown>
  ): Promise<{ data: unknown; error: { message?: string } | null }>
}

interface IdempotencyEffectRow {
  response_status: number
  effect_fingerprint: string | null
  resource_id: string | null
}

/**
 * Immutable effect evidence for keyed offline deliveries (T19.2). The trigger
 * writes this record in the exact business-write transaction and RLS exposes
 * only the authenticated actor's records to the bearer client.
 */
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

/**
 * Ask Postgres for the canonical fingerprint of the incoming request. The same
 * SQL function hashes the stored business row, so comparing the two proves the
 * reused key carries the same payload (DB-2) without a TS/SQL hash-parity gap.
 */
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
  // Existence alone is not proof of the same request (DB-2). Compare the
  // canonical fingerprint Postgres computes for this incoming payload against
  // the row-derived fingerprint stored with the committed effect.
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
  // Different-payload key reuse: the trigger refuses before writing and maps to
  // a conflict, distinct from a same-payload replay.
  if (error?.message?.startsWith('IDEMPOTENCY_CONFLICT')) {
    throw new IdempotencyConflictError(scope.operation, scope.key)
  }
  if (error?.code === '23505') {
    const existing = await readIdempotencyEffect(effectClient(supabase), scope.key, scope.operation)
    if (existing) throw new DuplicateDeliveryError(scope.operation, scope.key)
  }
}

interface DynamicQueryWithSingle {
  select?(columns?: string): {
    single?(): Promise<{ data: unknown; error: { message: string; code?: string; details?: string } | null }>
  }
}

async function executeSelectSingle(targetQuery: unknown): Promise<{
  data: unknown
  error: { message: string; code?: string; details?: string } | null
}> {
  let target = targetQuery as DynamicQueryWithSingle
  if (typeof target?.select === 'function') {
    const selected = target.select('*')
    if (typeof selected?.single === 'function') {
      target = selected.single() as unknown as DynamicQueryWithSingle
    }
  }
  return target as unknown as Promise<{
    data: unknown
    error: { message: string; code?: string; details?: string } | null
  }>
}

export const supabaseRepository: Repository = {
  // --- profiles ---

  async getProfileById(id) {
    return supabasePeoplePersistence.getProfileById(id)
  },

  async getProfileByEmail(email) {
    return supabasePeoplePersistence.getProfileByEmail(email)
  },

  async listProfiles(actor) {
    return supabasePeoplePersistence.listProfiles(actor)
  },

  async createUser(actor, input: CreateUserInput) {
    return supabasePeopleIdentity.createAccount(actor, input)
  },

  async updateUserStatus(actor, userId, isActive) {
    return supabasePeoplePersistence.updateUserStatus(actor, userId, isActive)
  },

  async updateUserRoles(actor, userId, permissionRole, hierarchyRole) {
    return supabasePeoplePersistence.updateUserRoles(actor, userId, permissionRole, hierarchyRole)
  },

  async updateUser(actor, userId, input) {
    return supabasePeoplePersistence.updateUser(actor, userId, input)
  },

  // --- projects ---

  async listProjects(actor) {
    return supabaseReferencePersistence.listProjects(actor)
  },

  async createProject(actor, nameOrInput, options) {
    return supabaseReferencePersistence.createProject(actor, nameOrInput, options)
  },

  async renameProject(actor, id, name) {
    return supabaseReferencePersistence.renameProject(actor, id, name)
  },

  async setProjectSO(actor, id, soNumber) {
    return supabaseReferencePersistence.setProjectSO(actor, id, soNumber)
  },

  async setProjectTelegramNo(actor, id, telegramNo) {
    return supabaseReferencePersistence.setProjectTelegramNo(actor, id, telegramNo)
  },

  async deleteProject(actor, id) {
    return supabaseReferencePersistence.deleteProject(actor, id)
  },

  // --- timesheets ---

  async listTimesheets(actor, opts: TimesheetListOptions = {}) {
    return supabaseTimesheetPersistence.list(actor, opts)
  },

  async getTimesheet(actor, id) {
    return supabaseTimesheetPersistence.getById(actor, id)
  },

  async getTimesheetsByIds(actor, ids) {
    return supabaseTimesheetPersistence.getByIds(actor, ids)
  },

  async findTimesheetByUserDate(actor, userId, logDate) {
    return supabaseTimesheetPersistence.getByUserDate(actor, userId, logDate)
  },

  async getLatestTimesheet(actor, userId) {
    return supabaseTimesheetPersistence.getLatest(actor, userId)
  },

  async createTimesheet(actor, input: TimesheetInput) {
    return supabaseTimesheetPersistence.create(actor, input)
  },

  async updateTimesheet(actor, id, input: TimesheetInput) {
    return supabaseTimesheetPersistence.update(actor, id, input)
  },

  async deleteTimesheet(actor, id) {
    return supabaseTimesheetPersistence.remove(actor, id)
  },

  async countTimesheetsByProject(actor, projectId) {
    return supabaseTimesheetPersistence.countByProject(actor, projectId)
  },

  // --- leaves ---

  async listLeaves(actor, opts = {}) {
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

  async createLeaves(actor, rows: LeafRowInput[]) {
    if (rows.length === 0) return { error: null }
    // Non-admins may only mark leave for themselves, mirroring the native
    // adapter. The service-role client bypasses RLS, so enforce it here.
    if (!isAdminActor(actor)) {
      for (const row of rows) {
        if (row.userId !== actor.id) {
          return { error: 'You can only mark leave for yourself.' }
        }
      }
    }
    const supabase = await server()
    const scope = getStampScope()

    // Keyed create_leave goes through the focused RPC so the FULL batch is
    // fingerprinted and claimed atomically (DB-3): a replay with a changed
    // later row is a conflict, not a silent replay. RLS still applies because
    // the RPC is SECURITY INVOKER.
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

    const query = withIdempotencyEffectHeaders(supabase.from('leaves').insert(
      rows.map((r) => ({
        user_id: r.userId,
        leave_date: r.leaveDate,
        reason: r.reason,
      }))
    ), scope)
    const { error } = await query
    if (error) {
      await throwIfDuplicateEffect(supabase, scope, error)
      return writeError(error)
    }
    return { error: null }
  },

  async deleteLeave(actor, id) {
    const supabase = await server()
    const scope = getStampScope()
    await guardIdempotencyEffect(supabase, scope, canonicalEffectPayload('delete_leave', { id }, actor.id))
    // Admin delete is unconstrained; everyone else may only delete their own.
    let query = withIdempotencyEffectHeaders(supabase.from('leaves').delete(), scope)
    if (!isAdminActor(actor)) query = query.eq('user_id', actor.id)
    const { error } = await query.eq('id', id)
    await throwIfDuplicateEffect(supabase, scope, error)
    return writeError(error)
  },

  // --- reminders ---

  async listReminders(actor, _userId) {
    // Reminders are own-only regardless of any caller-supplied userId,
    // mirroring the native adapter.
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

  async createReminder(actor, input) {
    // Admins may create reminders for other users; everyone else's reminders
    // are scoped to themselves (native parity).
    const userId = isAdminActor(actor) ? input.userId : actor.id
    const supabase = await server()
    const scope = getStampScope()
    await guardIdempotencyEffect(
      supabase,
      scope,
      canonicalEffectPayload('create_reminder', { ...input, userId }, actor.id)
    )
    const query = withIdempotencyEffectHeaders(supabase.from('reminders').insert({
      user_id: userId,
      message: input.message,
      remind_at: input.remindAt,
    }), scope)
    const { error } = await query
    if (error) {
      await throwIfDuplicateEffect(supabase, scope, error)
      return writeError(error)
    }
    return { error: null }
  },

  async updateReminder(actor, id, input) {
    const supabase = await server()
    const scope = getStampScope()
    await guardIdempotencyEffect(
      supabase,
      scope,
      canonicalEffectPayload('update_reminder', { id, done: input.done }, actor.id)
    )
    const query = withIdempotencyEffectHeaders(supabase
      .from('reminders')
      .update({ done: input.done })
      .eq('id', id)
      .eq('user_id', actor.id), scope)
    const { error } = await query
    await throwIfDuplicateEffect(supabase, scope, error)
    return writeError(error)
  },

  async deleteReminder(actor, id) {
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

  // --- profile self-service / admin name ---

  async updateMyProfile(actor, input) {
    return supabasePeoplePersistence.updateMyProfile(actor, input)
  },

  async updateUserName(actor, userId, name) {
    return supabasePeoplePersistence.updateUserName(actor, userId, name)
  },

  async updateUserManager(actor, userId, managerId) {
    return supabasePeoplePersistence.updateUserManager(actor, userId, managerId)
  },

  // --- activity types ---

  async listActivityTypes(actor) {
    return supabaseReferencePersistence.listActivityTypes(actor)
  },

  async listAllActivityTypes(actor) {
    return supabaseReferencePersistence.listAllActivityTypes(actor)
  },

  async createActivityType(actor, nameOrInput, options) {
    return supabaseReferencePersistence.createActivityType(actor, nameOrInput, options)
  },

  async renameActivityType(actor, id, name) {
    return supabaseReferencePersistence.renameActivityType(actor, id, name)
  },

  async setActivityTypeActive(actor, id, isActive) {
    return supabaseReferencePersistence.setActivityTypeActive(actor, id, isActive)
  },

  async setActivityTypeTelegramNo(actor, id, telegramNo) {
    return supabaseReferencePersistence.setActivityTypeTelegramNo(actor, id, telegramNo)
  },

  // --- global reminders ---

  // Global reminders are visible to all authenticated actors; per-user dismissal is handled separately.
  async listGlobalReminders(_actor) {
    const supabase = await server()
    const { data, error } = await supabase
      .from('global_reminders')
      .select('*')
      .order('remind_at', { ascending: true })
    if (error) throw new Error(error.message)
    return (data as GlobalReminder[]) ?? []
  },

  async listDueGlobalReminders(actor) {
    const supabase = await server()
    // Fetch all reminders due now, then subtract the ones the user dismissed.
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

  async createGlobalReminder(actor, input) {
    if (!isAdminActor(actor)) return { data: null, error: 'You do not have permission to perform this action.' }
    const supabase = await server()
    const { data, error } = await executeSelectSingle(
      supabase.from('global_reminders').insert({ message: input.message, remind_at: input.remindAt })
    )
    return writeReturningError(data as GlobalReminder, error)
  },

  async updateGlobalReminder(actor, id, input) {
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

  async deleteGlobalReminder(actor, id) {
    if (!isAdminActor(actor)) return { error: 'You do not have permission to perform this action.' }
    const supabase = await server()
    const { error } = await supabase.from('global_reminders').delete().eq('id', id)
    return writeError(error)
  },

  async dismissGlobalReminder(actor, reminderId) {
    const supabase = await server()
    const { error } = await supabase
      .from('global_reminder_dismissals')
      .upsert({ user_id: actor.id, reminder_id: reminderId }, { onConflict: 'user_id,reminder_id' })
    return writeError(error)
  },

  // --- app settings ---

  // App settings (backfill window) are readable by all authenticated actors.
  async getBackfillWindow(_actor): Promise<BackfillSettings> {
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

  async setBackfillWindow(actor, settings) {
    if (!isAdminActor(actor)) return { error: 'You do not have permission to perform this action.' }
    const supabase = await server()
    const { error } = await supabase
      .from('app_settings')
      .update({
        backfill_window_days: settings.windowDays,
        backfill_mode: settings.mode,
        backfill_extra_days: settings.extraDays,
        updated_at: new Date().toISOString(),
      })
      .eq('id', 1)
    return writeError(error)
  },

  // Default layouts are readable by all authenticated actors.
  async getDefaultLayouts(_actor) {
    const supabase = await server()
    const { data, error } = await supabase
      .from('app_settings')
      .select('default_dashboard_layout, default_admin_layout, default_mobile_layout')
      .maybeSingle()
    if (error) {
      return { data: null, error: error.message }
    }
    return {
      data: {
        dashboard: (data?.default_dashboard_layout as DashboardLayout | null) ?? DEFAULT_DASHBOARD_LAYOUT,
        admin: (data?.default_admin_layout as AdminDashboardLayout | null) ?? DEFAULT_ADMIN_LAYOUT,
        mobile: (data?.default_mobile_layout as MobileLayout | null) ?? DEFAULT_MOBILE_LAYOUT,
      },
      error: null,
    }
  },

  async setDefaultLayouts(actor, layouts) {
    if (!isSuperAdmin(actor)) return { error: 'You do not have permission to perform this action.' }
    const supabase = await server()
    const payload: {
      default_dashboard_layout: Json
      default_admin_layout: Json
      default_mobile_layout?: Json | null
      updated_at: string
    } = {
      default_dashboard_layout: layouts.dashboard as unknown as Json,
      default_admin_layout: layouts.admin as unknown as Json,
      updated_at: new Date().toISOString(),
    }
    if (layouts.mobile !== undefined) {
      payload.default_mobile_layout = (layouts.mobile as unknown as Json) ?? null
    }
    const { error } = await supabase
      .from('app_settings')
      .update(payload)
      .eq('id', 1)
    return writeError(error)
  },

  // Branding settings are readable by all authenticated actors.
  async getBranding(_actor) {
    const supabase = await server()
    const { data, error } = await supabase
      .from('app_settings')
      .select('app_name, primary_color, logo_url')
      .eq('id', 1)
      .maybeSingle()

    if (error) return { data: null, error: error.message }
    return { data: normalizeBranding(data), error: null }
  },

  async setBranding(actor, branding) {
    if (!isSuperAdmin(actor)) return { error: 'You do not have permission to perform this action.' }
    const supabase = await server()
    const { error } = await supabase
      .from('app_settings')
      .update({
        app_name: branding.appName,
        primary_color: branding.primaryColor,
        logo_url: branding.logoUrl,
        updated_at: new Date().toISOString(),
      })
      .eq('id', 1)
    return writeError(error)
  },

  // --- dashboard & mobile layout (own profile) ---

  async setDashboardLayout(actor, layout) {
    const supabase = await server()
    // RLS: profiles_update_own_details allows own-row updates.
    const { error } = await supabase
      .from('profiles')
      .update({ dashboard_layout: layout as unknown as Json })
      .eq('id', actor.id)
    return writeError(error)
  },

  async setAdminLayout(actor, layout) {
    const supabase = await server()
    const { error } = await supabase
      .from('profiles')
      .update({ admin_layout: layout as unknown as Json })
      .eq('id', actor.id)
    return writeError(error)
  },

  async setMobileLayout(actor, layout) {
    const supabase = await server()
    const { error } = await supabase
      .from('profiles')
      .update({ mobile_layout: (layout as unknown as Json) ?? null })
      .eq('id', actor.id)
    return writeError(error)
  },

  async getMobileLayout(actor) {
    const supabase = await server()
    const { data, error } = await supabase
      .from('profiles')
      .select('mobile_layout')
      .eq('id', actor.id)
      .maybeSingle()
    if (error) return { data: null, error: error.message }
    return { data: (data?.mobile_layout as MobileLayout | null) ?? null, error: null }
  },

  // --- super-admin data lifecycle (service role bypasses RLS) ---

  async deleteUser(actor, userId) {
    return supabasePeopleIdentity.deleteAccount(actor, userId)
  },

  async deleteActivityType(actor, id) {
    return supabaseReferencePersistence.deleteActivityType(actor, id)
  },

  async deleteUserTimesheets(actor, userId) {
    if (!isAdminActor(actor)) return { error: 'You do not have permission to perform this action.' }
    const admin = getAdminClient()
    const { error } = await admin.from('timesheets').delete().eq('user_id', userId)
    return writeError(error)
  },

  async resetTimesheets(actor) {
    if (!isAdminActor(actor)) return { error: 'You do not have permission to perform this action.' }
    const admin = getAdminClient()
    const { error } = await admin.from('timesheets').delete().not('id', 'is', null)
    return writeError(error)
  },

  async resetActivityData(actor) {
    if (!isAdminActor(actor)) return { error: 'You do not have permission to perform this action.' }
    const admin = getAdminClient()
    for (const table of ['timesheets', 'leaves', 'reminders', 'global_reminder_dismissals'] as const) {
      const { error } = await admin.from(table).delete().not('id', 'is', null).select('id')
      if (error) return { error: error.message }
    }
    const { error } = await admin.from('activity_types').upsert(
      [
        { name: 'R&D' },
        { name: 'Meeting' },
        { name: 'Certification' },
        { name: 'Presales support' },
        { name: 'Documentation' },
      ],
      { onConflict: 'name', ignoreDuplicates: true }
    )
    return writeError(error)
  },

  async resetAllData(actor) {
    if (!isAdminActor(actor)) return { error: 'You do not have permission to perform this action.' }
    const admin = getAdminClient()
    for (const table of [
      'timesheets',
      'leaves',
      'reminders',
      'global_reminder_dismissals',
      'global_reminders',
      'activity_types',
      'projects',
    ] as const) {
      const { error } = await admin.from(table).delete().not('id', 'is', null).select('id')
      if (error) return { error: error.message }
    }
    // Keep the acting profile so the session survives the reset.
    const { error: profileError } = await admin.from('profiles').delete().neq('id', actor.id).select('id')
    if (profileError) return { error: profileError.message }
    const { error: seedError } = await admin.from('projects').insert({ name: 'Internal', telegram_no: 1000 })
    if (seedError) return { error: seedError.message }
    const { error: seedTypesError } = await admin.from('activity_types').insert([
      { name: 'R&D' },
      { name: 'Meeting' },
      { name: 'Certification' },
      { name: 'Presales support' },
      { name: 'Documentation' },
    ])
    return writeError(seedTypesError)
  },

  async importTimesheets(actor, rows) {
    if (!isAdminActor(actor)) {
      return { imported: 0, skipped: rows.length, error: 'You do not have permission to perform this action.' }
    }
    const admin = getAdminClient()
    if (rows.length === 0) return { imported: 0, skipped: 0, error: null }
    // Callers validate the 24h daily cap before inserting; rows are inserted
    // as-is (multiple entries per user per day are allowed).
    const { data, error } = await admin
      .from('timesheets')
      .insert(
        rows.map(r => ({
          user_id: r.userId,
          project_id: r.projectId,
          activity_type_id: r.activityTypeId,
          log_date: r.logDate,
          hours_worked: r.hoursWorked,
          work_done: sanitizeWorkDone(r.workDone),
        }))
      )
      .select('id')
    if (error) return { imported: 0, skipped: rows.length, error: error.message }
    const imported = data?.length ?? 0
    return { imported, skipped: rows.length - imported, error: null }
  },

  async bulkUpdateTimesheets(actor, rows) {
    return supabaseTimesheetPersistence.bulkUpdate(actor, rows)
  },

  // --- backup & restore (admin) ---

  async exportBackup(actor) {
    if (!isAdminActor(actor)) {
      return { payload: null, error: 'You do not have permission to perform this action.' }
    }
    const admin = getAdminClient()

    const pageAll = async (table: 'timesheets' | 'leaves') => {
      const out: Record<string, unknown>[] = []
      for (let from = 0; ; from += 1000) {
        const { data, error } = await admin.from(table).select('*').range(from, from + 999)
        if (error) return { rows: out, error: error.message }
        if (!data || data.length === 0) break
        out.push(...data)
        if (data.length < 1000) break
      }
      return { rows: out, error: null }
    }

    const [projects, types, users, timesheets, leaves, reminders, globals] = await Promise.all([
      admin.from('projects').select('id, name, so_number, telegram_no').order('name').limit(1000),
      admin.from('activity_types').select('id, name, is_active, telegram_no').order('name').limit(1000),
      admin.from('profiles').select('id, email').limit(1000),
      pageAll('timesheets'),
      pageAll('leaves'),
      admin.from('reminders').select('user_id, message, remind_at, done').order('remind_at').limit(1000),
      admin.from('global_reminders').select('message, remind_at').order('remind_at').limit(1000),
    ])
    if (projects.error || types.error || users.error || timesheets.error || leaves.error || reminders.error || globals.error) {
      const raw =
        projects.error ?? types.error ?? users.error ?? timesheets.error ?? leaves.error ?? reminders.error ?? globals.error
      const errText: string | null =
        typeof raw === 'string' ? raw : raw && 'message' in raw ? String((raw as { message: unknown }).message) : 'Export failed.'
      return { payload: null, error: errText ?? 'Export failed.' }
    }
    const pRows = (projects.data ?? []) as Array<{ id: string; name: string; so_number: string | null; telegram_no: number | null }>
    const tRows = (types.data ?? []) as Array<{ id: string; name: string; is_active: boolean; telegram_no: number | null }>
    const uRows = (users.data ?? []) as Array<{ id: string; email: string }>
    const tsRows = timesheets.rows as Array<{
      user_id: string
      project_id: string
      activity_type_id: string | null
      log_date: string
      hours_worked: number
      work_done: string
    }>
    const lRows = leaves.rows as Array<{ user_id: string; leave_date: string; reason: string }>
    const rRows = (reminders.data ?? []) as Array<{ user_id: string; message: string; remind_at: string; done: boolean }>
    const gRows = (globals.data ?? []) as Array<{ message: string; remind_at: string }>

    const emailById = new Map(uRows.map(u => [u.id, u.email]))
    const projectNameById = new Map(pRows.map(p => [p.id, p.name]))
    const typeNameById = new Map(tRows.map(t => [t.id, t.name]))

    const payload: BackupPayload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      projects: pRows.map(p => ({ name: p.name, so_number: p.so_number, telegram_no: p.telegram_no })),
      activityTypes: tRows.map(t => ({ name: t.name, is_active: t.is_active, telegram_no: t.telegram_no })),
      timesheets: tsRows.map(t => ({
        email: emailById.get(t.user_id) ?? '',
        log_date: t.log_date,
        project: projectNameById.get(t.project_id) ?? '',
        activity_type: t.activity_type_id ? (typeNameById.get(t.activity_type_id) ?? null) : null,
        hours_worked: Number(t.hours_worked),
        work_done: t.work_done,
      })),
      leaves: lRows.map(l => ({ email: emailById.get(l.user_id) ?? '', leave_date: l.leave_date, reason: l.reason })),
      reminders: rRows.map(r => ({
        email: emailById.get(r.user_id) ?? '',
        message: r.message,
        remind_at: r.remind_at,
        done: r.done,
      })),
      globalReminders: gRows.map(g => ({ message: g.message, remind_at: g.remind_at })),
    }
    return { payload, error: null }
  },

  async restoreBackup(actor, payload) {
    const empty: BackupRestoreResult = {
      created: { projects: 0, activityTypes: 0, timesheets: 0, leaves: 0, reminders: 0, globalReminders: 0 },
      skipped: 0,
      error: null,
    }
    if (!isAdminActor(actor)) {
      return { ...empty, error: 'You do not have permission to perform this action.' }
    }

    const sanitizedTimesheets = payload.timesheets.map((t) => ({
      ...t,
      work_done: sanitizeWorkDone(t.work_done) || 'restored entry',
    }))

    const sanitizedPayload = {
      ...payload,
      timesheets: sanitizedTimesheets,
    }

    const admin = getAdminClient()
    const { data, error } = await (admin as unknown as { rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }> }).rpc('restore_backup_tx', {
      p_payload: sanitizedPayload,
    })

    if (error) {
      return { ...empty, error: error.message }
    }

    const res = data as BackupRestoreResult
    return {
      created: res?.created ?? empty.created,
      skipped: res?.skipped ?? 0,
      error: null,
    }
  },

  // --- daily hour totals (multi-entry per day, capped at 24h) ---

  async sumHoursForUserDate(actor, userId, logDate, excludeEntryId) {
    return supabaseTimesheetPersistence.sumHoursForUserDate(actor, userId, logDate, excludeEntryId)
  },

  async sumHoursForUserDates(actor, userDatePairs) {
    return supabaseTimesheetPersistence.sumHoursForUserDates(actor, userDatePairs)
  },

  async getGroupedReportTotals(actor, input, groupBy) {
    return supabaseReportingPersistence.getGroupedReportTotals(
      actor,
      input,
      groupBy,
      (a, opts) => this.listTimesheets(a, opts)
    )
  },

  async writeAuditLog(actor, input) {
    return supabasePeoplePersistence.writeAuditLog(actor, input)
  },

  // --- shared rate limiting ---
  //
  // Routed through service_role-only SECURITY DEFINER RPCs rather than table
  // access. A rate-limit row is not owned by the subject it counts, and the
  // pre-authentication gates must increment one with no session at all, so
  // there is no RLS policy that could express this correctly. The table is
  // revoked from public/anon/authenticated and only the RPCs can touch it.
  //
  // getAdminClient() (not `server()`) because a service-role key is required:
  // falling back to the anon SSR client would be denied by those grants.

  async reserveRateLimit(input) {
    const admin = getAdminClient()
    const { data, error } = await admin.rpc('reserve_rate_limit', {
      p_bucket: input.bucket,
      p_subject_hash: input.subjectHash,
      p_window_start: input.windowStart.toISOString(),
      p_reset_at: input.resetAt.toISOString(),
      p_limit: input.limit,
    })
    // Throw rather than returning "at limit": the caller's failure policy
    // (fail-closed vs. degraded local fallback) must distinguish a storage
    // outage from an exhausted budget.
    if (error) throw new Error(error.message)

    const count = typeof data === 'number' ? data : Number(data ?? 0)
    // The RPC returns -1 when the window is already at its limit.
    if (count < 0) return { reserved: false, count: input.limit }
    return { reserved: true, count }
  },

  async releaseRateLimit(input) {
    const admin = getAdminClient()
    const { error } = await admin.rpc('release_rate_limit', {
      p_bucket: input.bucket,
      p_subject_hash: input.subjectHash,
      p_window_start: input.windowStart.toISOString(),
    })
    if (error) throw new Error(error.message)
  },

  async cleanupRateLimits(before) {
    const admin = getAdminClient()
    const { data, error } = await admin.rpc('cleanup_rate_limits', {
      p_before: before.toISOString(),
    })
    if (error) throw new Error(error.message)
    return typeof data === 'number' ? data : Number(data ?? 0)
  },

  // --- email domain whitelist ---

  async listWhitelistedDomains(actor) {
    return supabaseReferencePersistence.listWhitelistedDomains(actor)
  },

  async addWhitelistedDomain(actor, domain, autoActivate) {
    return supabaseReferencePersistence.addWhitelistedDomain(actor, domain, autoActivate)
  },

  async updateWhitelistedDomain(actor, id, autoActivate) {
    return supabaseReferencePersistence.updateWhitelistedDomain(actor, id, autoActivate)
  },

  async deleteWhitelistedDomain(actor, id) {
    return supabaseReferencePersistence.deleteWhitelistedDomain(actor, id)
  },

  async findWhitelistedDomain(domain) {
    const clean = domain.trim().toLowerCase().replace(/^@/, '')
    // Signup is unauthenticated, while the whitelist is intentionally hidden
    // from anonymous clients by RLS. Keep this exact-domain lookup server-only
    // and privileged rather than exposing the table through an anon policy.
    const { data, error } = await getAdminClient()
      .from('whitelisted_domains')
      .select('id, domain, auto_activate, created_at')
      .eq('domain', clean)
      .limit(1)
      .maybeSingle()
    if (error) throw new Error(error.message)
    return (data as WhitelistedDomain | null) ?? null
  },

  // --- hierarchy & reporting structure ---

  async updateUserHierarchy(actor, userId, data) {
    return supabasePeoplePersistence.updateUserHierarchy(actor, userId, data)
  },

  // --- titles management ---

  async listTitles() {
    return supabaseReferencePersistence.listTitles()
  },

  async listTitleRecords() {
    return supabaseReferencePersistence.listTitleRecords()
  },

  async addTitle(actor, name, hierarchyRole = 'user') {
    return supabaseReferencePersistence.addTitle(actor, name, hierarchyRole)
  },

  async deleteTitle(actor, name) {
    return supabaseReferencePersistence.deleteTitle(actor, name)
  },

  async reclassifyTitle(actor, name, hierarchyRole, syncUsers = false) {
    return supabaseReferencePersistence.reclassifyTitle(actor, name, hierarchyRole, syncUsers)
  },

  async getTitleImpact(actor, name, proposedRole) {
    return supabaseReferencePersistence.getTitleImpact(actor, name, proposedRole)
  },
}



