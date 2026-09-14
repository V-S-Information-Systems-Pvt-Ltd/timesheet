// lib/db/supabase.ts
// Supabase implementation of the Repository interface. This is a thin mapping
// onto the Supabase server client; Row Level Security in Postgres does the
// heavy lifting for row-level authorization, while the actor-based role checks
// mirror the application logic in app/actions.ts.

import { getAdminClient } from '@/lib/supabase/admin'
import { isAdminActor } from '@/lib/roles'
import { supabaseTimesheetPersistence } from './supabase/timesheets'
import { supabaseReferencePersistence } from './supabase/reference'
import { supabasePeopleIdentity, supabasePeoplePersistence } from './supabase/people'
import { supabaseReportingPersistence } from './supabase/reporting'
import { supabaseLeaveReminderPersistence } from './supabase/leave-reminders'
import { supabaseWorkspacePersistence } from './supabase/workspace'
import { logger } from '@/lib/logger'
import type {
  BackupPayload,
  BackupRestoreResult,
  WhitelistedDomain,
} from '@/app/types'
import { sanitizeWorkDone } from '@/lib/validation'
import type {
  CreateUserInput,
  DbWrite,
  Repository,
  TimesheetInput,
  TimesheetListOptions,
} from './repository'

// Privileged operations in this compatibility facade that genuinely require the service role
// (e.g. bulk restore/import, rate-limit token bucket) explicitly call getAdminClient().



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
    return supabaseLeaveReminderPersistence.listLeaves(actor, opts)
  },

  async createLeaves(actor, rows) {
    return supabaseLeaveReminderPersistence.createLeaves(actor, rows)
  },

  async deleteLeave(actor, id) {
    return supabaseLeaveReminderPersistence.deleteLeave(actor, id)
  },

  // --- reminders ---

  async listReminders(actor, userId) {
    return supabaseLeaveReminderPersistence.listReminders(actor, userId)
  },

  async createReminder(actor, input) {
    return supabaseLeaveReminderPersistence.createReminder(actor, input)
  },

  async updateReminder(actor, id, input) {
    return supabaseLeaveReminderPersistence.updateReminder(actor, id, input)
  },

  async deleteReminder(actor, id) {
    return supabaseLeaveReminderPersistence.deleteReminder(actor, id)
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

  async listGlobalReminders(actor) {
    return supabaseLeaveReminderPersistence.listGlobalReminders(actor)
  },

  async listDueGlobalReminders(actor) {
    return supabaseLeaveReminderPersistence.listDueGlobalReminders(actor)
  },

  async createGlobalReminder(actor, input) {
    return supabaseLeaveReminderPersistence.createGlobalReminder(actor, input)
  },

  async updateGlobalReminder(actor, id, input) {
    return supabaseLeaveReminderPersistence.updateGlobalReminder(actor, id, input)
  },

  async deleteGlobalReminder(actor, id) {
    return supabaseLeaveReminderPersistence.deleteGlobalReminder(actor, id)
  },

  async dismissGlobalReminder(actor, reminderId) {
    return supabaseLeaveReminderPersistence.dismissGlobalReminder(actor, reminderId)
  },

  // --- app settings & branding ---

  async getBackfillWindow(actor) {
    return supabaseWorkspacePersistence.getBackfillWindow(actor)
  },

  async setBackfillWindow(actor, settings) {
    return supabaseWorkspacePersistence.setBackfillWindow(actor, settings)
  },

  async getDefaultLayouts(actor) {
    return supabaseWorkspacePersistence.getDefaultLayouts(actor)
  },

  async setDefaultLayouts(actor, layouts) {
    return supabaseWorkspacePersistence.setDefaultLayouts(actor, layouts)
  },

  async getBranding(actor) {
    return supabaseWorkspacePersistence.getBranding(actor)
  },

  async setBranding(actor, branding) {
    return supabaseWorkspacePersistence.setBranding(actor, branding)
  },

  // --- dashboard & mobile layout (own profile) ---

  async setDashboardLayout(actor, layout) {
    return supabaseWorkspacePersistence.setDashboardLayout(actor, layout)
  },

  async setAdminLayout(actor, layout) {
    return supabaseWorkspacePersistence.setAdminLayout(actor, layout)
  },

  async setMobileLayout(actor, layout) {
    return supabaseWorkspacePersistence.setMobileLayout(actor, layout)
  },

  async getMobileLayout(actor) {
    return supabaseWorkspacePersistence.getMobileLayout(actor)
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



