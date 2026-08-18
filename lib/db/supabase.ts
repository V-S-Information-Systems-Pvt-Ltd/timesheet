// lib/db/supabase.ts
// Supabase implementation of the Repository interface. This is a thin mapping
// onto the Supabase server client; Row Level Security in Postgres does the
// heavy lifting for row-level authorization, while the actor-based role checks
// mirror the application logic in app/actions.ts.

import { createClient } from '@/lib/supabase/server'
import { getAdminClient } from '@/lib/supabase/admin'
import type { Json } from '@/lib/supabase/database.types'
import type {
  ActivityType,
  BackupPayload,
  BackupRestoreResult,
  GlobalReminder,
  LeaveEntry,
  Project,
  Reminder,
  Timesheet,
  TimesheetRow,
  User,
} from '@/app/types'
import type { BackfillSettings } from '@/lib/validation'
import type {
  CreateUserInput,
  DbWrite,
  LeafRowInput,
  Repository,
  TimesheetInput,
  TimesheetListOptions,
  TimesheetListResult,
} from './repository'

async function server() {
  return createClient()
}

const TS_SELECT = '*, projects(name), profiles(email), activity_types(name)'

/**
 * Translate PostgREST errors into user-facing messages. Known PostgreSQL
 * error codes become friendly text; anything else falls back to the raw
 * message (auth and RLS errors are already readable).
 */
function writeError(err: { message: string; code?: string } | null): DbWrite {
  if (!err) return { error: null }
  if (err.code === '23505') return { error: 'A record with that value already exists.' }
  if (err.code === '23503') {
    return { error: 'This record is referenced by other data and cannot be changed.' }
  }
  return { error: err.message }
}

export const supabaseRepository: Repository = {
  // --- profiles ---

  async getProfileById(id) {
    const supabase = await server()
    const { data, error } = await supabase.from('profiles').select('*').eq('id', id).maybeSingle()
    if (error) throw new Error(error.message)
    return (data as User | null) ?? null
  },

  async getProfileByEmail(email) {
    const supabase = await server()
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('email', email)
      .maybeSingle()
    if (error) throw new Error(error.message)
    return (data as User | null) ?? null
  },

  async listProfiles(_actor) {
    const supabase = await server()
    const { data, error } = await supabase.from('profiles').select('*').limit(500)
    if (error) throw new Error(error.message)
    return (data as User[]) ?? []
  },

  async createUser(_actor, input: CreateUserInput) {
    let adminClient
    try {
      adminClient = getAdminClient()
    } catch (err) {
      return { error: (err as Error).message }
    }

    const { data: authUser, error: authError } = await adminClient.auth.admin.createUser({
      email: input.email,
      password: input.password,
      email_confirm: true,
      user_metadata: { name: input.name },
    })
    if (authError) return { error: authError.message }
    if (!authUser.user) return { error: 'Failed to create user.' }

    const { error } = await adminClient.from('profiles').upsert(
      {
        id: authUser.user.id,
        email: input.email,
        name: input.name,
        department: input.department,
        title: input.title,
        role: input.role,
        is_active: input.isActive,
        manager_id: input.managerId,
      },
      { onConflict: 'id' }
    )
    return writeError(error)
  },

  async updateUserStatus(_actor, userId, isActive) {
    const supabase = await server()
    const { error } = await supabase.from('profiles').update({ is_active: isActive }).eq('id', userId)
    return writeError(error)
  },

  async updateUserRole(_actor, userId, role) {
    const supabase = await server()
    const { error } = await supabase.from('profiles').update({ role }).eq('id', userId)
    return writeError(error)
  },

  // --- projects ---

  async listProjects(_actor) {
    const supabase = await server()
    const { data, error } = await supabase.from('projects').select('*')
    if (error) throw new Error(error.message)
    return (data as Project[]) ?? []
  },

  async createProject(_actor, name) {
    const supabase = await server()
    const { error } = await supabase.from('projects').insert({ name })
    return writeError(error)
  },

  async renameProject(_actor, id, name) {
    const supabase = await server()
    const { error } = await supabase.from('projects').update({ name }).eq('id', id)
    return writeError(error)
  },

  async setProjectSO(_actor, id, soNumber) {
    const supabase = await server()
    const { error } = await supabase
      .from('projects')
      .update({ so_number: soNumber || null })
      .eq('id', id)
    return writeError(error)
  },

  async setProjectTelegramNo(_actor, id, telegramNo) {
    const supabase = await server()
    // RLS: projects_update_manager (admin or pm).
    const { error } = await supabase
      .from('projects')
      .update({ telegram_no: telegramNo })
      .eq('id', id)
    return writeError(error)
  },

  async deleteProject(_actor, id) {
    const supabase = await server()
    const { count, error: countError } = await supabase
      .from('timesheets')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', id)
    if (countError) return { error: countError.message }
    if (count && count > 0) {
      return { error: `Cannot delete: ${count} entries reference this project.` }
    }
    const { error } = await supabase.from('projects').delete().eq('id', id)
    return writeError(error)
  },

  // --- timesheets ---

  async listTimesheets(_actor, opts: TimesheetListOptions = {}) {
    const supabase = await server()
    let query = supabase
      .from('timesheets')
      .select(TS_SELECT, { count: 'exact' })
      .order('log_date', { ascending: false })
    if (opts.from !== undefined || opts.to !== undefined) {
      const from = opts.from ?? 0
      const to = opts.to ?? from + 999
      query = query.range(from, to)
    } else if (opts.limit !== undefined) {
      query = query.limit(opts.limit)
    }
    const { data, error, count } = await query
    if (error) throw new Error(error.message)
    const result: TimesheetListResult = {
      rows: (data as Timesheet[]) ?? [],
      count: count ?? 0,
    }
    return result
  },

  async getTimesheet(_actor, id) {
    const supabase = await server()
    const { data, error } = await supabase.from('timesheets').select(TS_SELECT).eq('id', id).maybeSingle()
    if (error) throw new Error(error.message)
    return (data as TimesheetRow | null) ?? null
  },

  async findTimesheetByUserDate(_actor, userId, logDate) {
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

  async getLatestTimesheet(_actor, userId) {
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

  async createTimesheet(_actor, input: TimesheetInput) {
    const supabase = await server()
    const { error } = await supabase.from('timesheets').insert({
      user_id: input.userId,
      project_id: input.projectId,
      activity_type_id: input.activityTypeId,
      hours_worked: input.hoursWorked,
      work_done: input.workDone,
      log_date: input.logDate,
    })
    return writeError(error)
  },

  async updateTimesheet(_actor, id, input: TimesheetInput) {
    const supabase = await server()
    const { error } = await supabase.from('timesheets').update({
      project_id: input.projectId,
      activity_type_id: input.activityTypeId,
      hours_worked: input.hoursWorked,
      work_done: input.workDone,
      log_date: input.logDate,
    }).eq('id', id)
    return writeError(error)
  },

  async deleteTimesheet(_actor, id) {
    const supabase = await server()
    const { error } = await supabase.from('timesheets').delete().eq('id', id)
    return writeError(error)
  },

  async countTimesheetsByProject(_actor, projectId) {
    const supabase = await server()
    const { count, error } = await supabase
      .from('timesheets')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', projectId)
    if (error) throw new Error(error.message)
    return count ?? 0
  },

  // --- leaves ---

  async listLeaves(actor, opts = {}) {
    const supabase = await server()
    let query = supabase.from('leaves').select('*').order('leave_date', { ascending: true })

    if (actor.role === 'admin') {
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

  async createLeaves(_actor, rows: LeafRowInput[]) {
    const supabase = await server()
    const { error } = await supabase.from('leaves').insert(
      rows.map((r) => ({ user_id: r.userId, leave_date: r.leaveDate, reason: r.reason }))
    )
    return writeError(error)
  },

  async deleteLeave(_actor, id) {
    const supabase = await server()
    const { error } = await supabase.from('leaves').delete().eq('id', id)
    return writeError(error)
  },

  // --- reminders ---

  async listReminders(_actor, userId) {
    const supabase = await server()
    const { data, error } = await supabase
      .from('reminders')
      .select('*')
      .eq('user_id', userId)
      .order('remind_at', { ascending: true })
      .limit(50)
    if (error) throw new Error(error.message)
    return (data as Reminder[]) ?? []
  },

  async createReminder(_actor, input) {
    const supabase = await server()
    const { error } = await supabase.from('reminders').insert({
      user_id: input.userId,
      message: input.message,
      remind_at: input.remindAt,
    })
    return writeError(error)
  },

  async updateReminder(_actor, id, input) {
    const supabase = await server()
    const { error } = await supabase.from('reminders').update({ done: input.done }).eq('id', id)
    return writeError(error)
  },

  async deleteReminder(_actor, id) {
    const supabase = await server()
    const { error } = await supabase.from('reminders').delete().eq('id', id)
    return writeError(error)
  },

  // --- profile self-service / admin name ---

  async updateMyProfile(_actor, input) {
    const supabase = await server()
    const { error } = await supabase
      .from('profiles')
      .update({ department: input.department, title: input.title })
      .eq('id', _actor.id)
    return writeError(error)
  },

  async updateUserName(_actor, userId, name) {
    const supabase = await server()
    const { error } = await supabase.from('profiles').update({ name }).eq('id', userId)
    return writeError(error)
  },

  async updateUserManager(_actor, userId, managerId) {
    // RLS: profiles_update_admin (admin only).
    const supabase = await server()
    const { error } = await supabase
      .from('profiles')
      .update({ manager_id: managerId })
      .eq('id', userId)
    return writeError(error)
  },

  // --- activity types ---

  async listActivityTypes(_actor) {
    const supabase = await server()
    const { data, error } = await supabase
      .from('activity_types')
      .select('*')
      .eq('is_active', true)
      .order('name')
    if (error) throw new Error(error.message)
    return (data as ActivityType[]) ?? []
  },

  async listAllActivityTypes(_actor) {
    const supabase = await server()
    const { data, error } = await supabase.from('activity_types').select('*').order('name')
    if (error) throw new Error(error.message)
    return (data as ActivityType[]) ?? []
  },

  async createActivityType(_actor, name) {
    const supabase = await server()
    const { error } = await supabase.from('activity_types').insert({ name })
    return writeError(error)
  },

  async renameActivityType(_actor, id, name) {
    const supabase = await server()
    const { error } = await supabase.from('activity_types').update({ name }).eq('id', id)
    return writeError(error)
  },

  async setActivityTypeActive(_actor, id, isActive) {
    const supabase = await server()
    const { error } = await supabase.from('activity_types').update({ is_active: isActive }).eq('id', id)
    return writeError(error)
  },

  async setActivityTypeTelegramNo(_actor, id, telegramNo) {
    const supabase = await server()
    // RLS: activity_types_update_admin.
    const { error } = await supabase
      .from('activity_types')
      .update({ telegram_no: telegramNo })
      .eq('id', id)
    return writeError(error)
  },

  // --- global reminders ---

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

  async createGlobalReminder(_actor, input) {
    const supabase = await server()
    const { error } = await supabase
      .from('global_reminders')
      .insert({ message: input.message, remind_at: input.remindAt })
    return writeError(error)
  },

  async deleteGlobalReminder(_actor, id) {
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

  async setBackfillWindow(_actor, settings) {
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

  // --- dashboard layout (own profile) ---

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

  // --- super-admin data lifecycle (service role bypasses RLS) ---

  async deleteUser(_actor, userId) {
    const admin = getAdminClient()
    // timesheets.user_id has no ON DELETE CASCADE in supabase — clear them first.
    const { error: tsError } = await admin.from('timesheets').delete().eq('user_id', userId)
    if (tsError) return { error: tsError.message }
    const { error: profileError } = await admin.from('profiles').delete().eq('id', userId)
    if (profileError) return { error: profileError.message }
    // Best effort: remove the auth identity too (leaves/reminders cascade).
    const { error: authError } = await admin.auth.admin.deleteUser(userId)
    return authError ? { error: authError.message } : { error: null }
  },

  async deleteActivityType(_actor, id) {
    const admin = getAdminClient()
    const { error } = await admin.from('activity_types').delete().eq('id', id)
    return writeError(error)
  },

  async deleteUserTimesheets(_actor, userId) {
    const admin = getAdminClient()
    const { error } = await admin.from('timesheets').delete().eq('user_id', userId)
    return writeError(error)
  },

  async resetTimesheets(_actor) {
    const admin = getAdminClient()
    const { error } = await admin.from('timesheets').delete().not('id', 'is', null)
    return writeError(error)
  },

  async resetActivityData(_actor) {
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
    const { error } = await admin.from('activity_types').insert([
      { name: 'R&D' },
      { name: 'Meeting' },
      { name: 'Certification' },
      { name: 'Presales support' },
      { name: 'Documentation' },
    ])
    return writeError(error)
  },

  async importTimesheets(_actor, rows) {
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
          work_done: r.workDone,
        }))
      )
      .select('id')
    if (error) return { imported: 0, skipped: rows.length, error: error.message }
    const imported = data?.length ?? 0
    return { imported, skipped: rows.length - imported, error: null }
  },

  // --- backup & restore (admin) ---

  async exportBackup(actor) {
    if (actor.role !== 'admin') {
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
    if (actor.role !== 'admin') {
      return { ...empty, error: 'You do not have permission to perform this action.' }
    }
    const admin = getAdminClient()
    const created = { ...empty.created }
    let skipped = 0

    // Projects: create missing by name.
    const projectIdByName = new Map<string, string>()
    const { data: existingProjects, error: projErr } = await admin.from('projects').select('id, name').limit(1000)
    if (projErr) return { ...empty, error: projErr.message }
    for (const p of existingProjects ?? []) projectIdByName.set(p.name, p.id)
    for (const p of payload.projects) {
      if (projectIdByName.has(p.name)) continue
      const { data: ins, error } = await admin.from('projects').insert({
        name: p.name,
        so_number: p.so_number,
        telegram_no: p.telegram_no,
      }).select('id').single()
      if (error) return { ...empty, error: error.message }
      projectIdByName.set(p.name, ins.id)
      created.projects++
    }

    // Activity types: create missing by name.
    const typeIdByName = new Map<string, string>()
    const { data: existingTypes, error: typeErr } = await admin.from('activity_types').select('id, name').limit(1000)
    if (typeErr) return { ...empty, error: typeErr.message }
    for (const t of existingTypes ?? []) typeIdByName.set(t.name, t.id)
    for (const t of payload.activityTypes) {
      if (typeIdByName.has(t.name)) continue
      const { data: ins, error } = await admin.from('activity_types').insert({
        name: t.name,
        is_active: t.is_active,
        telegram_no: t.telegram_no,
      }).select('id').single()
      if (error) return { ...empty, error: error.message }
      typeIdByName.set(t.name, ins.id)
      created.activityTypes++
    }

    // Users: match by email; unknown emails are skipped.
    const userByEmail = new Map<string, string>()
    const { data: existingUsers, error: usersErr } = await admin.from('profiles').select('id, email').limit(1000)
    if (usersErr) return { ...empty, error: usersErr.message }
    for (const u of existingUsers ?? []) userByEmail.set(u.email.toLowerCase(), u.id)

    // Timesheets: skip exact duplicates; enforce the 24h daily cap.
    const existingKeys = new Set<string>()
    const totals = new Map<string, number>()
    for (let from = 0; ; from += 1000) {
      const { data, error } = await admin
        .from('timesheets')
        .select('user_id, log_date, project_id, activity_type_id, hours_worked')
        .range(from, from + 999)
      if (error) return { ...empty, error: error.message }
      if (!data || data.length === 0) break
      for (const r of data) {
        existingKeys.add(`${r.user_id}|${r.log_date}|${r.project_id}|${r.activity_type_id ?? ''}|${Number(r.hours_worked)}`)
        const k = `${r.user_id}|${r.log_date}`
        totals.set(k, (totals.get(k) ?? 0) + Number(r.hours_worked))
      }
      if (data.length < 1000) break
    }
    for (const t of payload.timesheets) {
      const userId = userByEmail.get(t.email)
      const projectId = projectIdByName.get(t.project)
      if (!userId || !projectId) { skipped++; continue }
      const typeId = t.activity_type ? (typeIdByName.get(t.activity_type) ?? null) : null
      const key = `${userId}|${t.log_date}|${projectId}|${typeId ?? ''}|${t.hours_worked}`
      if (existingKeys.has(key)) { skipped++; continue }
      const k = `${userId}|${t.log_date}`
      const current = totals.get(k) ?? 0
      if (current + t.hours_worked > 24) { skipped++; continue }
      const { error } = await admin.from('timesheets').insert({
        user_id: userId,
        project_id: projectId,
        activity_type_id: typeId,
        log_date: t.log_date,
        hours_worked: t.hours_worked,
        work_done: t.work_done || 'restored entry',
      })
      if (error) return { ...empty, error: error.message }
      totals.set(k, current + t.hours_worked)
      existingKeys.add(key)
      created.timesheets++
    }

    // Leaves: unique (user_id + leave_date). Pre-load existing keys and skip
    // duplicates instead of aborting the restore — a re-run of the same
    // backup must be idempotent, mirroring the native backend's
    // ON CONFLICT DO NOTHING.
    const existingLeafKeys = new Set<string>()
    for (let from = 0; ; from += 1000) {
      const { data, error } = await admin
        .from('leaves')
        .select('user_id, leave_date')
        .range(from, from + 999)
      if (error) return { ...empty, error: error.message }
      if (!data || data.length === 0) break
      for (const r of data) existingLeafKeys.add(`${r.user_id}|${r.leave_date}`)
      if (data.length < 1000) break
    }
    for (const l of payload.leaves) {
      const userId = userByEmail.get(l.email)
      if (!userId) { skipped++; continue }
      const key = `${userId}|${l.leave_date}`
      if (existingLeafKeys.has(key)) { skipped++; continue }
      const { data, error } = await admin
        .from('leaves')
        .insert({ user_id: userId, leave_date: l.leave_date, reason: l.reason })
        .select('id')
      if (error) {
        // Unique violation (Postgres 23505 / PostgREST 409): the leave was
        // inserted concurrently — count it as skipped, never fail the restore.
        if (error.code === '23505') {
          skipped++
          continue
        }
        return { ...empty, error: error.message }
      }
      if (data && data.length > 0) created.leaves++
      else skipped++
    }

    for (const r of payload.reminders) {
      const userId = userByEmail.get(r.email)
      if (!userId) { skipped++; continue }
      const { error } = await admin.from('reminders').insert({
        user_id: userId,
        message: r.message,
        remind_at: r.remind_at,
        done: r.done,
      })
      if (error) return { ...empty, error: error.message }
      created.reminders++
    }

    for (const g of payload.globalReminders) {
      const { error } = await admin.from('global_reminders').insert({ message: g.message, remind_at: g.remind_at })
      if (error) return { ...empty, error: error.message }
      created.globalReminders++
    }

    return { created, skipped, error: null }
  },

  // --- daily hour totals (multi-entry per day, capped at 24h) ---

  async sumHoursForUserDate(_actor, userId, logDate, excludeEntryId) {
    const supabase = await server()
    let query = supabase
      .from('timesheets')
      .select('id, hours_worked')
      .eq('user_id', userId)
      .eq('log_date', logDate)
    if (excludeEntryId) query = query.neq('id', excludeEntryId)
    const { data, error } = await query
    if (error) throw new Error(error.message)
    return (data ?? []).reduce((acc, r) => acc + (Number(r.hours_worked) || 0), 0)
  },

  async getTimesheetDailyTotals(_actor) {
    const supabase = await server()
    const totals = new Map<string, { userId: string; logDate: string; hours: number }>()
    // PostgREST caps rows at 1000 per request — page through the table.
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from('timesheets')
        .select('user_id, log_date, hours_worked')
        .range(from, from + 999)
      if (error) throw new Error(error.message)
      if (!data || data.length === 0) break
      for (const r of data) {
        const key = `${r.user_id}|${r.log_date}`
        const entry = totals.get(key)
        if (entry) entry.hours += Number(r.hours_worked) || 0
        else totals.set(key, { userId: r.user_id, logDate: r.log_date, hours: Number(r.hours_worked) || 0 })
      }
      if (data.length < 1000) break
    }
    return [...totals.values()]
  },
}
