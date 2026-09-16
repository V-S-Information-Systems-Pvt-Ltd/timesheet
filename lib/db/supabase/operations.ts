import 'server-only'

import { getAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { getMobileSupabaseClient } from '@/lib/supabase/bearer'
import { isAdminActor } from '@/lib/roles'
import { logger } from '@/lib/logger'
import type { Json } from '@/lib/supabase/database.types'
import type {
  BackupExportResult,
  BackupPayload,
  BackupRestoreResult,
} from '@/app/types'
import { sanitizeWorkDone } from '@/lib/validation'
import type {
  Actor,
  DbWrite,
  ImportResult,
  RateLimitReleaseInput,
  RateLimitReserveInput,
  RateLimitReserveResult,
  TimesheetInput,
} from '../repository'
import type {
  OperationsAuditEntry,
  OperationsPersistence,
} from '@/lib/domain/operations-port'

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
  logger.error('Supabase write error', { error: err.message, code: err.code, details: err.details })
  return { error: 'Something went wrong. Please try again.' }
}

export interface SupabaseOperationsPersistence extends OperationsPersistence {
  reserveRateLimit(input: RateLimitReserveInput): Promise<RateLimitReserveResult>
  releaseRateLimit(input: RateLimitReleaseInput): Promise<void>
  cleanupRateLimits(before: Date): Promise<number>
}

export const supabaseOperationsPersistence: SupabaseOperationsPersistence = {
  // --- super-admin data lifecycle (service role bypasses RLS) ---

  async deleteUserTimesheets(actor: Actor, userId: string): Promise<DbWrite> {
    if (!isAdminActor(actor)) return { error: 'You do not have permission to perform this action.' }
    const admin = getAdminClient()
    const { error } = await admin.from('timesheets').delete().eq('user_id', userId)
    return writeError(error)
  },

  async resetTimesheets(actor: Actor): Promise<DbWrite> {
    if (!isAdminActor(actor)) return { error: 'You do not have permission to perform this action.' }
    const admin = getAdminClient()
    const { error } = await admin.from('timesheets').delete().not('id', 'is', null)
    return writeError(error)
  },

  async resetActivityData(actor: Actor): Promise<DbWrite> {
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

  async resetAllData(actor: Actor): Promise<DbWrite> {
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

  async importTimesheets(actor: Actor, rows: TimesheetInput[]): Promise<ImportResult> {
    if (!isAdminActor(actor)) {
      return { imported: 0, skipped: rows.length, error: 'You do not have permission to perform this action.' }
    }
    const admin = getAdminClient()
    if (rows.length === 0) return { imported: 0, skipped: 0, error: null }
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

  // --- backup & restore (admin) ---

  async exportBackup(actor: Actor): Promise<BackupExportResult> {
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

  async restoreBackup(actor: Actor, payload: BackupPayload): Promise<BackupRestoreResult> {
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

  async writeAuditLog(actor: Actor, entry: OperationsAuditEntry): Promise<DbWrite> {
    try {
      const supabase = await server()
      const { error } = await supabase.from('audit_logs').insert({
        actor_id: actor.id,
        actor_email: actor.email,
        action: entry.action,
        target_id: entry.targetId ?? null,
        detail: (entry.detail as Json) ?? null,
      })
      if (!error) return { error: null }
    } catch {
      // Fallback to admin client below
    }
    const admin = getAdminClient()
    const { error } = await admin.from('audit_logs').insert({
      actor_id: actor.id,
      actor_email: actor.email,
      action: entry.action,
      target_id: entry.targetId ?? null,
      detail: (entry.detail as Json) ?? null,
    })
    return writeError(error)
  },

  // --- shared rate limiting ---

  async reserveRateLimit(input: RateLimitReserveInput): Promise<RateLimitReserveResult> {
    const admin = getAdminClient()
    const { data, error } = await admin.rpc('reserve_rate_limit', {
      p_bucket: input.bucket,
      p_subject_hash: input.subjectHash,
      p_window_start: input.windowStart.toISOString(),
      p_reset_at: input.resetAt.toISOString(),
      p_limit: input.limit,
    })
    if (error) throw new Error(error.message)

    const count = typeof data === 'number' ? data : Number(data ?? 0)
    if (count < 0) return { reserved: false, count: input.limit }
    return { reserved: true, count }
  },

  async releaseRateLimit(input: RateLimitReleaseInput): Promise<void> {
    const admin = getAdminClient()
    const { error } = await admin.rpc('release_rate_limit', {
      p_bucket: input.bucket,
      p_subject_hash: input.subjectHash,
      p_window_start: input.windowStart.toISOString(),
    })
    if (error) throw new Error(error.message)
  },

  async cleanupRateLimits(before: Date): Promise<number> {
    const admin = getAdminClient()
    const { data, error } = await admin.rpc('cleanup_rate_limits', {
      p_before: before.toISOString(),
    })
    if (error) throw new Error(error.message)
    return typeof data === 'number' ? data : Number(data ?? 0)
  },
}
