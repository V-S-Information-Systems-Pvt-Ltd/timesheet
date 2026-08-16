// lib/db/supabase.ts
// Supabase implementation of the Repository interface. This is a thin mapping
// onto the Supabase server client; Row Level Security in Postgres does the
// heavy lifting for row-level authorization, while the actor-based role checks
// mirror the application logic in app/actions.ts.

import { createClient } from '@/lib/supabase/server'
import { getAdminClient } from '@/lib/supabase/admin'
import type {
  ActivityType,
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

function writeError(err: { message: string } | null): DbWrite {
  return { error: err ? err.message : null }
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
}
