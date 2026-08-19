// lib/db/native.ts
// Native PostgreSQL implementation of the Repository interface. Authorization
// is enforced here in SQL/where clauses (the schema has no RLS), mirroring the
// policies documented in supabase/README.md:
//   * profiles: read own; admin/co read all; admin updates.
//   * projects: any signed-in user reads; admin/pm write.
//   * timesheets: own rows for users; admin/co read all; admin writes any.
//   * leaves: own rows for users; admin manages all.
//   * reminders: own rows only.
//   * app_settings: any signed-in user reads; admin writes.

import type {
  ActivityType,
  AdminDashboardLayout,
  BackupRestoreResult,
  DashboardLayout,
  GlobalReminder,
  LeaveEntry,
  Project,
  Reminder,
  Timesheet,
  User,
  UserRole,
} from '@/app/types'
import type { BackfillSettings } from '@/lib/validation'
import { getPool, query } from './pool'
import { hashPassword } from '@/lib/auth/password'
import type {
  Actor,
  DbWrite,
  LeafRowInput,
  Repository,
  TimesheetInput,
  TimesheetListOptions,
  TimesheetListResult,
} from './repository'

// --- row shapes returned by SQL -------------------------------------------------

interface ProfileRow {
  id: string
  email: string
  name: string
  department: string
  title: string
  role: UserRole
  is_active: boolean
  manager_id: string | null
  dashboard_layout: DashboardLayout | null
  admin_layout: AdminDashboardLayout | null
  created_at: string
}

interface ProjectRow {
  id: string
  name: string
  so_number: string | null
  telegram_no: number | null
  created_at: string
}

interface TimesheetJoinedRow {
  id: string
  user_id: string
  project_id: string
  activity_type_id: string | null
  log_date: string
  hours_worked: number
  work_done: string
  created_at: string
  project_name: string | null
  user_email: string | null
  activity_type_name: string | null
}

interface ActivityTypeRow {
  id: string
  name: string
  is_active: boolean
  telegram_no: number | null
  created_at: string
}

interface GlobalReminderRow {
  id: string
  message: string
  remind_at: string
  created_at: string
}

interface LeaveRow {
  id: string
  user_id: string
  leave_date: string
  reason: string
  created_at: string
}

interface ReminderRow {
  id: string
  user_id: string
  message: string
  remind_at: string
  done: boolean
  created_at: string
}

// --- helpers --------------------------------------------------------------------

const PROFILE_COLS =
  'id, email, name, department, title, role, is_active, manager_id, dashboard_layout, admin_layout, created_at'

/** Role names with team-wide entry/profile visibility beyond their own rows. */
function isManagerOrLead(role: UserRole): boolean {
  return role === 'manager' || role === 'team_lead'
}

/** Timesheet row scoping for the actor's role. */
function timesheetScope(actor: Actor): { where: string; params: unknown[] } {
  if (isAdminOrCo(actor.role)) return { where: '', params: [] }
  if (isManagerOrLead(actor.role)) {
    return {
      where: 'where (t.user_id = $1 or t.user_id = any(public.team_ids($1)))',
      params: [actor.id],
    }
  }
  return { where: 'where t.user_id = $1', params: [actor.id] }
}

function mapProfile(r: ProfileRow): User {
  return {
    id: r.id,
    email: r.email,
    name: r.name,
    department: r.department,
    title: r.title,
    role: r.role,
    is_active: r.is_active,
    manager_id: r.manager_id ?? null,
    dashboard_layout: r.dashboard_layout ?? null,
    admin_layout: r.admin_layout ?? null,
    created_at: r.created_at,
  }
}

function mapTimesheet(r: TimesheetJoinedRow): Timesheet {
  return {
    id: r.id,
    user_id: r.user_id,
    project_id: r.project_id,
    activity_type_id: r.activity_type_id,
    log_date: r.log_date,
    hours_worked: r.hours_worked,
    work_done: r.work_done,
    created_at: r.created_at,
    projects: r.project_name != null ? { name: r.project_name } : null,
    profiles: r.user_email != null ? { email: r.user_email } : null,
    activity_types: r.activity_type_name != null ? { name: r.activity_type_name } : null,
  }
}

function isAdminOrCo(role: UserRole): boolean {
  return role === 'admin' || role === 'co'
}

/**
 * Translate known PostgreSQL errors into user-facing messages. Unknown errors
 * fall back to a generic message so internal details (SQLSTATE, schema names)
 * never leak to API responses or server-action results.
 */
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

/** Run several parameterless statements in order; stop at the first error. */
async function writeMany(statements: string[]): Promise<DbWrite> {
  try {
    for (const sql of statements) {
      await query(sql)
    }
    return { error: null }
  } catch (err) {
    return { error: friendlyWriteError(err) }
  }
}

export const nativeRepository: Repository = {
  // --- profiles ---

  async getProfileById(id) {
    const rows = await query<ProfileRow>(
      `select ${PROFILE_COLS} from public.profiles where id = $1`,
      [id]
    )
    return rows[0] ? mapProfile(rows[0]) : null
  },

  async getProfileByEmail(email) {
    const rows = await query<ProfileRow>(
      `select ${PROFILE_COLS} from public.profiles where email = $1`,
      [email]
    )
    return rows[0] ? mapProfile(rows[0]) : null
  },

  async listProfiles(actor) {
    if (isAdminOrCo(actor.role)) {
      const rows = await query<ProfileRow>(
        `select ${PROFILE_COLS} from public.profiles order by lower(email) limit 500`
      )
      return rows.map(mapProfile)
    }
    if (isManagerOrLead(actor.role)) {
      const rows = await query<ProfileRow>(
        `select ${PROFILE_COLS} from public.profiles
         where id = $1 or id = any(public.team_ids($1))
         order by lower(email) limit 500`,
        [actor.id]
      )
      return rows.map(mapProfile)
    }
    return []
  },

  async createUser(actor, input) {
    if (actor.role !== 'admin') return { error: 'You do not have permission to perform this action.' }
    const passwordHash = await hashPassword(input.password)
    return write(
      `insert into public.profiles (email, name, department, title, role, is_active, manager_id, password_hash)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [input.email, input.name, input.department, input.title, input.role, input.isActive, input.managerId, passwordHash]
    )
  },

  async updateUserStatus(actor, userId, isActive) {
    if (actor.role !== 'admin') return { error: 'You do not have permission to perform this action.' }
    return write('update public.profiles set is_active = $1 where id = $2', [isActive, userId])
  },

  async updateUserRole(actor, userId, role) {
    if (actor.role !== 'admin') return { error: 'You do not have permission to perform this action.' }
    return write('update public.profiles set role = $1 where id = $2', [role, userId])
  },

  // --- projects ---

  async listProjects(_actor) {
    const rows = await query<ProjectRow>(
      'select id, name, so_number, telegram_no, created_at from public.projects order by name'
    )
    return rows as Project[]
  },

  async createProject(actor, name) {
    if (actor.role !== 'admin' && actor.role !== 'pm') {
      return { error: 'You do not have permission to perform this action.' }
    }
    return write('insert into public.projects (name) values ($1)', [name])
  },

  async renameProject(actor, id, name) {
    if (actor.role !== 'admin' && actor.role !== 'pm') {
      return { error: 'You do not have permission to perform this action.' }
    }
    return write('update public.projects set name = $1 where id = $2', [name, id])
  },

  async setProjectSO(actor, id, soNumber) {
    if (actor.role !== 'admin' && actor.role !== 'pm') {
      return { error: 'You do not have permission to perform this action.' }
    }
    return write('update public.projects set so_number = $1 where id = $2', [soNumber, id])
  },

  async setProjectTelegramNo(actor, id, telegramNo) {
    if (actor.role !== 'admin' && actor.role !== 'pm') {
      return { error: 'You do not have permission to perform this action.' }
    }
    return write('update public.projects set telegram_no = $1 where id = $2', [telegramNo, id])
  },

  async deleteProject(actor, id) {
    if (actor.role !== 'admin' && actor.role !== 'pm') {
      return { error: 'You do not have permission to perform this action.' }
    }
    const counts = await query<{ c: number }>(
      'select count(*)::int as c from public.timesheets where project_id = $1',
      [id]
    )
    const count = counts[0]?.c ?? 0
    if (count > 0) {
      return { error: `Cannot delete: ${count} entries reference this project.` }
    }
    // The entry check above and this delete are not atomic; if a timesheet is
    // inserted in between, the FK violation maps to a friendly message below.
    return write('delete from public.projects where id = $1', [id])
  },

  // --- timesheets ---

  async listTimesheets(actor, opts: TimesheetListOptions = {}) {
    const { where, params: baseParams } = timesheetScope(actor)

    // Inclusive date-range filter (ISO dates), appended to the scope.
    const dateConds: string[] = []
    const dateParams: unknown[] = []
    if (opts.dateFrom) {
      dateParams.push(opts.dateFrom)
      dateConds.push(`t.log_date >= $${baseParams.length + dateParams.length}`)
    }
    if (opts.dateTo) {
      dateParams.push(opts.dateTo)
      dateConds.push(`t.log_date <= $${baseParams.length + dateParams.length}`)
    }
    const dateWhere = dateConds.length ? ` and ${dateConds.join(' and ')}` : ''

    const countRows = await query<{ c: number }>(
      `select count(*)::int as c from public.timesheets t ${where}${dateWhere}`,
      [...baseParams, ...dateParams]
    )
    const count = countRows[0]?.c ?? 0

    let sql = `select
        t.id, t.user_id, t.project_id, t.activity_type_id, t.log_date, t.hours_worked, t.work_done, t.created_at,
        p.name as project_name, pr.email as user_email, at.name as activity_type_name
      from public.timesheets t
      left join public.projects p on p.id = t.project_id
      left join public.profiles pr on pr.id = t.user_id
      left join public.activity_types at on at.id = t.activity_type_id
      ${where}${dateWhere}
      order by t.log_date desc`

    const params = [...baseParams, ...dateParams]
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
    const result: TimesheetListResult = { rows: rows.map(mapTimesheet), count }
    return result
  },

  async getTimesheet(actor, id) {
    const where = isAdminOrCo(actor.role) ? 'id = $1' : 'id = $1 and user_id = $2'
    const params: unknown[] = isAdminOrCo(actor.role) ? [id] : [id, actor.id]
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

  async findTimesheetByUserDate(actor, userId, logDate) {
    if (!isAdminOrCo(actor.role) && userId !== actor.id) return null
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

  async getLatestTimesheet(actor, userId) {
    if (!isAdminOrCo(actor.role) && userId !== actor.id) return null
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

  async createTimesheet(actor, input: TimesheetInput) {
    const targetId = input.userId
    if (actor.role !== 'admin') {
      if (targetId !== actor.id) return { error: 'You can only log your own entries.' }
      if (!actor.isActive) return { error: 'Your account is not active.' }
    }
    return write(
      `insert into public.timesheets (user_id, project_id, activity_type_id, log_date, hours_worked, work_done)
       values ($1, $2, $3, $4, $5, $6)`,
      [targetId, input.projectId, input.activityTypeId, input.logDate, input.hoursWorked, input.workDone]
    )
  },

  async updateTimesheet(actor, id, input: TimesheetInput) {
    if (actor.role === 'admin') {
      return write(
        `update public.timesheets
         set project_id = $1, activity_type_id = $2, log_date = $3, hours_worked = $4, work_done = $5
         where id = $6`,
        [input.projectId, input.activityTypeId, input.logDate, input.hoursWorked, input.workDone, id]
      )
    }
    return write(
      `update public.timesheets
       set project_id = $1, activity_type_id = $2, log_date = $3, hours_worked = $4, work_done = $5
       where id = $6 and user_id = $7`,
      [input.projectId, input.activityTypeId, input.logDate, input.hoursWorked, input.workDone, id, actor.id]
    )
  },

  async deleteTimesheet(actor, id) {
    if (actor.role === 'admin') {
      return write('delete from public.timesheets where id = $1', [id])
    }
    return write('delete from public.timesheets where id = $1 and user_id = $2', [id, actor.id])
  },

  async countTimesheetsByProject(actor, projectId) {
    if (actor.role !== 'admin' && actor.role !== 'pm') return 0
    const rows = await query<{ c: number }>(
      'select count(*)::int as c from public.timesheets where project_id = $1',
      [projectId]
    )
    return rows[0]?.c ?? 0
  },

  // --- leaves ---

  async listLeaves(actor, opts = {}) {
    const conds: string[] = []
    const params: unknown[] = []

    if (actor.role === 'admin') {
      if (opts.userId) {
        params.push(opts.userId)
        conds.push(`user_id = $${params.length}`)
      }
    } else {
      params.push(actor.id)
      conds.push(`user_id = $${params.length}`)
    }

    if (opts.from) {
      params.push(opts.from)
      conds.push(`leave_date >= $${params.length}`)
    }
    if (opts.to) {
      params.push(opts.to)
      conds.push(`leave_date <= $${params.length}`)
    }

    const where = conds.length ? `where ${conds.join(' and ')}` : ''
    const rows = await query<LeaveRow>(
      `select id, user_id, leave_date, reason, created_at from public.leaves ${where} order by leave_date asc`,
      params
    )
    return rows as LeaveEntry[]
  },

  async createLeaves(actor, rows: LeafRowInput[]) {
    if (rows.length === 0) return { error: null }
    for (const row of rows) {
      if (actor.role !== 'admin' && row.userId !== actor.id) {
        return { error: 'You can only mark leave for yourself.' }
      }
    }
    // Bulk insert; a duplicate (user_id, leave_date) violates the unique index
    // and surfaces as an error, matching the Supabase behavior.
    const values: string[] = []
    const params: unknown[] = []
    rows.forEach((row) => {
      params.push(row.userId, row.leaveDate, row.reason)
      const i = params.length
      values.push(`($${i - 2}, $${i - 1}, $${i})`)
    })
    return write(
      `insert into public.leaves (user_id, leave_date, reason) values ${values.join(', ')}`,
      params
    )
  },

  async deleteLeave(actor, id) {
    if (actor.role === 'admin') {
      return write('delete from public.leaves where id = $1', [id])
    }
    return write('delete from public.leaves where id = $1 and user_id = $2', [id, actor.id])
  },

  // --- reminders ---

  async listReminders(actor, _userId) {
    // Reminders are own-only regardless of the passed userId.
    const rows = await query<ReminderRow>(
      'select id, user_id, message, remind_at, done, created_at from public.reminders where user_id = $1 order by remind_at asc',
      [actor.id]
    )
    return rows as Reminder[]
  },

  async createReminder(actor, input) {
    const userId = actor.role === 'admin' ? input.userId : actor.id
    return write(
      'insert into public.reminders (user_id, message, remind_at) values ($1, $2, $3)',
      [userId, input.message, input.remindAt]
    )
  },

  async updateReminder(actor, id, input) {
    return write(
      'update public.reminders set done = $1 where id = $2 and user_id = $3',
      [input.done, id, actor.id]
    )
  },

  async deleteReminder(actor, id) {
    return write('delete from public.reminders where id = $1 and user_id = $2', [id, actor.id])
  },

  // --- profile self-service / admin name ---

  async updateMyProfile(actor, input) {
    return write(
      'update public.profiles set department = $1, title = $2 where id = $3',
      [input.department, input.title, actor.id]
    )
  },

  async updateUserName(actor, userId, name) {
    if (actor.role !== 'admin') return { error: 'You do not have permission to perform this action.' }
    return write('update public.profiles set name = $1 where id = $2', [name, userId])
  },

  async updateUserManager(actor, userId, managerId) {
    if (actor.role !== 'admin') return { error: 'You do not have permission to perform this action.' }
    return write('update public.profiles set manager_id = $1 where id = $2', [managerId, userId])
  },

  // --- activity types ---

  async listActivityTypes(_actor) {
    const rows = await query<ActivityTypeRow>(
      'select id, name, is_active, telegram_no, created_at from public.activity_types where is_active = true order by name'
    )
    return rows as ActivityType[]
  },

  async listAllActivityTypes(actor) {
    if (actor.role !== 'admin') return []
    const rows = await query<ActivityTypeRow>(
      'select id, name, is_active, telegram_no, created_at from public.activity_types order by name'
    )
    return rows as ActivityType[]
  },

  async createActivityType(actor, name) {
    if (actor.role !== 'admin') return { error: 'You do not have permission to perform this action.' }
    return write('insert into public.activity_types (name) values ($1)', [name])
  },

  async renameActivityType(actor, id, name) {
    if (actor.role !== 'admin') return { error: 'You do not have permission to perform this action.' }
    return write('update public.activity_types set name = $1 where id = $2', [name, id])
  },

  async setActivityTypeActive(actor, id, isActive) {
    if (actor.role !== 'admin') return { error: 'You do not have permission to perform this action.' }
    return write('update public.activity_types set is_active = $1 where id = $2', [isActive, id])
  },

  async setActivityTypeTelegramNo(actor, id, telegramNo) {
    if (actor.role !== 'admin') return { error: 'You do not have permission to perform this action.' }
    return write('update public.activity_types set telegram_no = $1 where id = $2', [telegramNo, id])
  },

  // --- global reminders ---

  async listGlobalReminders(actor) {
    if (actor.role !== 'admin') return []
    const rows = await query<GlobalReminderRow>(
      'select id, message, remind_at, created_at from public.global_reminders order by remind_at asc'
    )
    return rows as GlobalReminder[]
  },

  async listDueGlobalReminders(actor) {
    const rows = await query<GlobalReminderRow>(
      `select gr.id, gr.message, gr.remind_at, gr.created_at
       from public.global_reminders gr
       where gr.remind_at <= now()
         and not exists (
           select 1 from public.global_reminder_dismissals d
           where d.reminder_id = gr.id and d.user_id = $1
         )
       order by gr.remind_at asc`,
      [actor.id]
    )
    return rows as GlobalReminder[]
  },

  async createGlobalReminder(actor, input) {
    if (actor.role !== 'admin') return { error: 'You do not have permission to perform this action.' }
    return write(
      'insert into public.global_reminders (message, remind_at) values ($1, $2)',
      [input.message, input.remindAt]
    )
  },

  async deleteGlobalReminder(actor, id) {
    if (actor.role !== 'admin') return { error: 'You do not have permission to perform this action.' }
    return write('delete from public.global_reminders where id = $1', [id])
  },

  async dismissGlobalReminder(actor, reminderId) {
    return write(
      'insert into public.global_reminder_dismissals (user_id, reminder_id) values ($1, $2) on conflict do nothing',
      [actor.id, reminderId]
    )
  },

  // --- app settings ---

  async getBackfillWindow(_actor): Promise<BackfillSettings> {
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
      windowDays: typeof row?.backfill_window_days === 'number' && row.backfill_window_days >= 0 ? row.backfill_window_days : 1,
      extraDays: typeof row?.backfill_extra_days === 'number' && row.backfill_extra_days >= 0 ? row.backfill_extra_days : 0,
    }
  },

  async setBackfillWindow(actor, settings) {
    if (actor.role !== 'admin') return { error: 'You do not have permission to perform this action.' }
    return write(
      'update public.app_settings set backfill_window_days = $1, backfill_mode = $2, backfill_extra_days = $3, updated_at = now() where id = 1',
      [settings.windowDays, settings.mode, settings.extraDays]
    )
  },

  // --- dashboard layout (own profile) ---

  async setDashboardLayout(actor, layout) {
    return write('update public.profiles set dashboard_layout = $1 where id = $2', [
      JSON.stringify(layout),
      actor.id,
    ])
  },

  async setAdminLayout(actor, layout) {
    return write('update public.profiles set admin_layout = $1 where id = $2', [
      JSON.stringify(layout),
      actor.id,
    ])
  },

  // --- super-admin data lifecycle ---

  async deleteUser(actor, userId) {
    if (actor.role !== 'admin') return { error: 'You do not have permission to perform this action.' }
    // Timesheets/leaves/reminders/dismissals cascade via their FK definitions.
    return write('delete from public.profiles where id = $1', [userId])
  },

  async deleteActivityType(actor, id) {
    if (actor.role !== 'admin') return { error: 'You do not have permission to perform this action.' }
    // Timesheet references become null via "on delete set null".
    return write('delete from public.activity_types where id = $1', [id])
  },

  async deleteUserTimesheets(actor, userId) {
    if (actor.role !== 'admin') return { error: 'You do not have permission to perform this action.' }
    return write('delete from public.timesheets where user_id = $1', [userId])
  },

  async resetTimesheets(actor) {
    if (actor.role !== 'admin') return { error: 'You do not have permission to perform this action.' }
    return write('delete from public.timesheets')
  },

  async resetActivityData(actor) {
    if (actor.role !== 'admin') return { error: 'You do not have permission to perform this action.' }
    const result = await writeMany([
      'delete from public.timesheets',
      'delete from public.leaves',
      'delete from public.reminders',
      'delete from public.global_reminder_dismissals',
    ])
    if (result.error) return result
    return writeMany([
      `insert into public.activity_types (name) values
         ('R&D'), ('Meeting'), ('Certification'), ('Presales support'), ('Documentation')
       on conflict (name) do nothing`,
    ])
  },

  async resetAllData(actor) {
    if (actor.role !== 'admin') return { error: 'You do not have permission to perform this action.' }
    const result = await writeMany([
      'delete from public.timesheets',
      'delete from public.leaves',
      'delete from public.reminders',
      'delete from public.global_reminder_dismissals',
      'delete from public.global_reminders',
      'delete from public.activity_types',
      'delete from public.projects',
    ])
    if (result.error) return result
    // Keep the acting profile so the session survives the reset.
    const keep = await write('delete from public.profiles where id <> $1', [actor.id])
    if (keep.error) return keep
    return writeMany([
      "insert into public.projects (name, telegram_no) values ('Internal', 1000)",
      `insert into public.activity_types (name) values
         ('R&D'), ('Meeting'), ('Certification'), ('Presales support'), ('Documentation')
       on conflict (name) do nothing`,
    ])
  },

  async importTimesheets(actor, rows) {
    if (actor.role !== 'admin') {
      return { imported: 0, skipped: rows.length, error: 'You do not have permission to perform this action.' }
    }
    if (rows.length === 0) return { imported: 0, skipped: 0, error: null }

    // Callers validate the 24h daily cap before inserting; rows are inserted
    // as-is (multiple entries per user per day are allowed).
    const values: string[] = []
    const params: unknown[] = []
    rows.forEach(row => {
      params.push(row.userId, row.projectId, row.activityTypeId, row.logDate, row.hoursWorked, row.workDone)
      const i = params.length
      values.push(`($${i - 5}, $${i - 4}, $${i - 3}, $${i - 2}, $${i - 1}, $${i})`)
    })
    try {
      const result = await getPool().query(
        `insert into public.timesheets (user_id, project_id, activity_type_id, log_date, hours_worked, work_done)
         values ${values.join(', ')}`,
        params
      )
      const imported = result.rowCount ?? 0
      return { imported, skipped: rows.length - imported, error: null }
    } catch (err) {
      return { imported: 0, skipped: rows.length, error: friendlyWriteError(err) }
    }
  },

  // --- backup & restore (admin) ---

  async exportBackup(actor) {
    if (actor.role !== 'admin') {
      return { payload: null, error: 'You do not have permission to perform this action.' }
    }
    const [projects, types, users, timesheets, leaves, reminders, globals] = await Promise.all([
      query<{ id: string; name: string; so_number: string | null; telegram_no: number | null }>(
        'select id, name, so_number, telegram_no from public.projects order by name'
      ),
      query<{ id: string; name: string; is_active: boolean; telegram_no: number | null }>(
        'select id, name, is_active, telegram_no from public.activity_types order by name'
      ),
      query<{ id: string; email: string }>('select id, lower(email) as email from public.profiles'),
      query<{ user_id: string; project_id: string; activity_type_id: string | null; log_date: string; hours_worked: number; work_done: string }>(
        'select user_id, project_id, activity_type_id, log_date, hours_worked, work_done from public.timesheets order by log_date'
      ),
      query<{ user_id: string; leave_date: string; reason: string }>(
        'select user_id, leave_date, reason from public.leaves order by leave_date'
      ),
      query<{ user_id: string; message: string; remind_at: string; done: boolean }>(
        'select user_id, message, remind_at, done from public.reminders order by remind_at'
      ),
      query<{ message: string; remind_at: string }>(
        'select message, remind_at from public.global_reminders order by remind_at'
      ),
    ])
    const emailById = new Map(users.map(u => [u.id, u.email]))
    const projectNameById = new Map(projects.map(p => [p.id, p.name]))
    const typeNameById = new Map(types.map(t => [t.id, t.name]))

    return {
      payload: {
        version: 1,
        exportedAt: new Date().toISOString(),
        projects: projects.map(p => ({ name: p.name, so_number: p.so_number, telegram_no: p.telegram_no })),
        activityTypes: types.map(t => ({ name: t.name, is_active: t.is_active, telegram_no: t.telegram_no })),
        timesheets: timesheets.map(t => ({
          email: emailById.get(t.user_id) ?? '',
          log_date: t.log_date,
          project: projectNameById.get(t.project_id) ?? '',
          activity_type: t.activity_type_id ? (typeNameById.get(t.activity_type_id) ?? null) : null,
          hours_worked: Number(t.hours_worked),
          work_done: t.work_done,
        })),
        leaves: leaves.map(l => ({ email: emailById.get(l.user_id) ?? '', leave_date: l.leave_date, reason: l.reason })),
        reminders: reminders.map(r => ({
          email: emailById.get(r.user_id) ?? '',
          message: r.message,
          remind_at: r.remind_at,
          done: r.done,
        })),
        globalReminders: globals.map(g => ({ message: g.message, remind_at: g.remind_at })),
      },
      error: null,
    }
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

    const client = await getPool().connect()
    try {
      await client.query('begin')

      const created = { ...empty.created }
      let skipped = 0

      // Projects: create missing by name.
      const projectIdByName = new Map<string, string>()
      const existingProjects = await client.query<{ id: string; name: string }>('select id, name from public.projects')
      for (const r of existingProjects.rows) projectIdByName.set(r.name, r.id)
      for (const p of payload.projects) {
        if (projectIdByName.has(p.name)) continue
        const ins = await client.query<{ id: string }>(
          `insert into public.projects (name, so_number, telegram_no) values ($1, $2, $3) returning id`,
          [p.name, p.so_number, p.telegram_no]
        )
        projectIdByName.set(p.name, ins.rows[0].id)
        created.projects++
      }

      // Activity types: create missing by name.
      const typeIdByName = new Map<string, string>()
      const existingTypes = await client.query<{ id: string; name: string }>('select id, name from public.activity_types')
      for (const r of existingTypes.rows) typeIdByName.set(r.name, r.id)
      for (const t of payload.activityTypes) {
        if (typeIdByName.has(t.name)) continue
        const ins = await client.query<{ id: string }>(
          `insert into public.activity_types (name, is_active, telegram_no) values ($1, $2, $3) returning id`,
          [t.name, t.is_active, t.telegram_no]
        )
        typeIdByName.set(t.name, ins.rows[0].id)
        created.activityTypes++
      }

      // Users: match by email; unknown emails are skipped.
      const userByEmail = new Map<string, string>()
      const existingUsers = await client.query<{ id: string; email: string }>(
        'select id, lower(email) as email from public.profiles'
      )
      for (const r of existingUsers.rows) userByEmail.set(r.email, r.id)

      // Timesheets: skip exact duplicates; enforce the 24h daily cap.
      const existingEntries = await client.query<{
        user_id: string
        log_date: string
        project_id: string
        activity_type_id: string | null
        hours_worked: number
      }>('select user_id, log_date, project_id, activity_type_id, hours_worked from public.timesheets')
      const existingKeys = new Set<string>()
      const totals = new Map<string, number>()
      for (const r of existingEntries.rows) {
        existingKeys.add(`${r.user_id}|${r.log_date}|${r.project_id}|${r.activity_type_id ?? ''}|${Number(r.hours_worked)}`)
        const k = `${r.user_id}|${r.log_date}`
        totals.set(k, (totals.get(k) ?? 0) + Number(r.hours_worked))
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
        await client.query(
          `insert into public.timesheets (user_id, project_id, activity_type_id, log_date, hours_worked, work_done)
           values ($1, $2, $3, $4, $5, $6)`,
          [userId, projectId, typeId, t.log_date, t.hours_worked, t.work_done || 'restored entry']
        )
        totals.set(k, current + t.hours_worked)
        existingKeys.add(key)
        created.timesheets++
      }

      // Leaves: unique (user_id, leave_date) — skip duplicates via ON CONFLICT.
      for (const l of payload.leaves) {
        const userId = userByEmail.get(l.email)
        if (!userId) { skipped++; continue }
        const res = await client.query(
          `insert into public.leaves (user_id, leave_date, reason) values ($1, $2, $3) on conflict do nothing`,
          [userId, l.leave_date, l.reason]
        )
        if ((res.rowCount ?? 0) > 0) created.leaves++
        else skipped++
      }

      for (const r of payload.reminders) {
        const userId = userByEmail.get(r.email)
        if (!userId) { skipped++; continue }
        await client.query(
          `insert into public.reminders (user_id, message, remind_at, done) values ($1, $2, $3, $4)`,
          [userId, r.message, r.remind_at, r.done]
        )
        created.reminders++
      }

      for (const g of payload.globalReminders) {
        await client.query(
          `insert into public.global_reminders (message, remind_at) values ($1, $2)`,
          [g.message, g.remind_at]
        )
        created.globalReminders++
      }

      await client.query('commit')
      return { created, skipped, error: null }
    } catch (err) {
      await client.query('rollback')
      return { ...empty, error: friendlyWriteError(err) }
    } finally {
      client.release()
    }
  },

  // --- daily hour totals (multi-entry per day, capped at 24h) ---

  async sumHoursForUserDate(actor, userId, logDate, excludeEntryId) {
    if (!isAdminOrCo(actor.role) && userId !== actor.id) return 0
    const rows = await query<{ h: number }>(
      `select coalesce(sum(hours_worked), 0)::float8 as h
       from public.timesheets
       where user_id = $1 and log_date = $2 and ($3::uuid is null or id <> $3)`,
      [userId, logDate, excludeEntryId ?? null]
    )
    return Number(rows[0]?.h ?? 0)
  },

  async getTimesheetDailyTotals(actor) {
    if (actor.role !== 'admin') return []
    const rows = await query<{ user_id: string; log_date: string; hours: number }>(
      `select user_id, log_date, coalesce(sum(hours_worked), 0)::float8 as hours
       from public.timesheets
       group by user_id, log_date`
    )
    return rows.map(r => ({ userId: r.user_id, logDate: r.log_date, hours: Number(r.hours) }))
  },
}
