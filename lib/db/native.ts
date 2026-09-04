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
  HierarchyRole,
  LeaveEntry,
  MobileLayout,
  PermissionRole,
  Project,
  Reminder,
  Timesheet,
  User,
  UserRole,
  TitleRecord,
} from '@/app/types'
import { DEFAULT_ADMIN_LAYOUT, DEFAULT_DASHBOARD_LAYOUT } from '@/app/constants'
import { DEFAULT_MOBILE_LAYOUT } from '@/lib/layout'
import { normalizeBranding } from '@/lib/branding'
import type { BackfillSettings } from '@/lib/validation'
import { sanitizeWorkDone } from '@/lib/validation'
import { getPool, query } from './pool'
import { hashPassword } from '@/lib/auth/password'
import { canSeeAllActor, hasPermission, HIERARCHY_ROLES, isAdminActor, isLeaderActor, legacyRoleFromPair } from '@/lib/roles'
import { isSuperAdmin } from '@/lib/auth/super-admin'
import type {
  Actor,
  BulkTimesheetUpdateResult,
  DbWrite,
  LeafRowInput,
  ReportTotalsInput,
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
  permission_role: PermissionRole
  hierarchy_role: HierarchyRole
  is_active: boolean
  manager_id: string | null
  dashboard_layout: DashboardLayout | null
  admin_layout: AdminDashboardLayout | null
  mobile_layout: MobileLayout | null
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
  'id, email, name, department, title, role, permission_role, hierarchy_role, is_active, manager_id, dashboard_layout, admin_layout, mobile_layout, created_at'

/** Timesheet row scoping for the actor's roles (permission honours admin/co
 * "see all"; hierarchy honours manager/team-lead "see my reports"). */
function timesheetScope(actor: Actor): { where: string; params: unknown[] } {
  if (canSeeAllActor(actor)) return { where: '', params: [] }
  if (isLeaderActor(actor)) {
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
    permission_role: r.permission_role,
    hierarchy_role: r.hierarchy_role,
    is_active: r.is_active,
    manager_id: r.manager_id ?? null,
    dashboard_layout: r.dashboard_layout ?? null,
    admin_layout: r.admin_layout ?? null,
    mobile_layout: r.mobile_layout ?? null,
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
    if (canSeeAllActor(actor)) {
      const rows = await query<ProfileRow>(
        `select ${PROFILE_COLS} from public.profiles order by lower(email) limit 500`
      )
      return rows.map(mapProfile)
    }
    if (isLeaderActor(actor)) {
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
    if (!isAdminActor(actor)) return { error: 'You do not have permission to perform this action.' }
    // Self-registration is restricted to whitelisted domains; keep the
    // admin-created flow consistent so a non-whitelisted domain can't be
    // created by an admin and then used as a whitelist bypass.
    const createdDomain = input.email.split('@')[1]?.toLowerCase()
    if (createdDomain) {
      const whitelisted = await this.findWhitelistedDomain(createdDomain).catch(() => null)
      if (!whitelisted) {
        return {
          error: `User creation is restricted to approved email domains. Add @${createdDomain} to the whitelist first.`,
        }
      }
    }
    const passwordHash = await hashPassword(input.password)
    const role = legacyRoleFromPair(input.permissionRole, input.hierarchyRole)
    return write(
      `insert into public.profiles (email, name, department, title, role, permission_role, hierarchy_role, is_active, manager_id, password_hash)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [input.email, input.name, input.department, input.title, role, input.permissionRole, input.hierarchyRole, input.isActive, input.managerId, passwordHash]
    )
  },

  async updateUserStatus(actor, userId, isActive) {
    if (!isAdminActor(actor)) return { error: 'You do not have permission to perform this action.' }
    return write('update public.profiles set is_active = $1 where id = $2', [isActive, userId])
  },

  async updateUserRoles(actor, userId, permissionRole, hierarchyRole) {
    if (!isAdminActor(actor)) return { error: 'You do not have permission to perform this action.' }
    const role = legacyRoleFromPair(permissionRole, hierarchyRole)
    return write(
      'update public.profiles set permission_role = $1, hierarchy_role = $2, role = $3 where id = $4',
      [permissionRole, hierarchyRole, role, userId]
    )
  },

  async updateUser(actor, userId, input) {
    if (!isAdminActor(actor)) return { error: 'You do not have permission to perform this action.' }

    const rows = await query<ProfileRow>(
      'select id, name, department, title, role, permission_role, hierarchy_role, is_active, manager_id from public.profiles where id = $1',
      [userId]
    )
    if (!rows[0]) {
      return { error: 'User not found.' }
    }
    const current = rows[0]

    const sets: string[] = []
    const params: unknown[] = []

    if (input.name !== undefined) {
      sets.push(`name = $${params.length + 1}`)
      params.push(input.name.trim())
    }
    if (input.department !== undefined) {
      sets.push(`department = $${params.length + 1}`)
      params.push(input.department ? input.department.trim() : null)
    }
    if (input.title !== undefined) {
      sets.push(`title = $${params.length + 1}`)
      params.push(input.title ? input.title.trim() : null)
    }
    if (input.isActive !== undefined) {
      sets.push(`is_active = $${params.length + 1}`)
      params.push(input.isActive)
    }
    if (input.managerId !== undefined) {
      sets.push(`manager_id = $${params.length + 1}`)
      params.push(input.managerId ? input.managerId.trim() : null)
    }

    const nextPermRole = input.permissionRole ?? current.permission_role
    const nextHierRole = input.hierarchyRole ?? current.hierarchy_role
    if (input.permissionRole !== undefined) {
      sets.push(`permission_role = $${params.length + 1}`)
      params.push(input.permissionRole)
    }
    if (input.hierarchyRole !== undefined) {
      sets.push(`hierarchy_role = $${params.length + 1}`)
      params.push(input.hierarchyRole)
    }
    if (input.permissionRole !== undefined || input.hierarchyRole !== undefined) {
      const nextLegacyRole = legacyRoleFromPair(nextPermRole, nextHierRole)
      sets.push(`role = $${params.length + 1}`)
      params.push(nextLegacyRole)
    }

    if (sets.length === 0) {
      return { error: null }
    }

    params.push(userId)
    return write(
      `update public.profiles set ${sets.join(', ')} where id = $${params.length}`,
      params
    )
  },

  // --- projects ---

  async listProjects(_actor) {
    const rows = await query<ProjectRow>(
      'select id, name, so_number, telegram_no, created_at from public.projects order by name'
    )
    return rows as Project[]
  },

  async createProject(actor, name) {
    if (!hasPermission(actor, ['admin', 'pm'])) {
      return { error: 'You do not have permission to perform this action.' }
    }
    return write('insert into public.projects (name) values ($1)', [name])
  },

  async renameProject(actor, id, name) {
    if (!hasPermission(actor, ['admin', 'pm'])) {
      return { error: 'You do not have permission to perform this action.' }
    }
    return write('update public.projects set name = $1 where id = $2', [name, id])
  },

  async setProjectSO(actor, id, soNumber) {
    if (!hasPermission(actor, ['admin', 'pm'])) {
      return { error: 'You do not have permission to perform this action.' }
    }
    return write('update public.projects set so_number = $1 where id = $2', [soNumber, id])
  },

  async setProjectTelegramNo(actor, id, telegramNo) {
    if (!hasPermission(actor, ['admin', 'pm'])) {
      return { error: 'You do not have permission to perform this action.' }
    }
    return write('update public.projects set telegram_no = $1 where id = $2', [telegramNo, id])
  },

  async deleteProject(actor, id) {
    if (!hasPermission(actor, ['admin', 'pm'])) {
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
    const { where: scopeWhere, params: baseParams } = timesheetScope(actor)

    // Optional explicit user filter plus inclusive date-range filters (ISO
    // dates), appended to the scope. The userId filter mirrors the supabase
    // adapter; the scope above still constrains what the actor may see.
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
    const result: TimesheetListResult = { rows: rows.map(mapTimesheet), count }
    return result
  },

  async getTimesheet(actor, id) {
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

  async getTimesheetsByIds(actor, ids) {
    if (!ids || ids.length === 0) return []
    const where = canSeeAllActor(actor) ? 't.id = ANY($1::uuid[])' : 't.id = ANY($1::uuid[]) and t.user_id = $2'
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

  async findTimesheetByUserDate(actor, userId, logDate) {
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

  async getLatestTimesheet(actor, userId) {
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

  async createTimesheet(actor, input: TimesheetInput) {
    const targetId = input.userId
    if (!isAdminActor(actor)) {
      if (targetId !== actor.id) return { error: 'You can only log your own entries.' }
      if (!actor.isActive) return { error: 'Your account is not active.' }
    }
    return write(
      `insert into public.timesheets (user_id, project_id, activity_type_id, log_date, hours_worked, work_done)
       values ($1, $2, $3, $4, $5, $6)`,
      [targetId, input.projectId, input.activityTypeId, input.logDate, input.hoursWorked, sanitizeWorkDone(input.workDone)]
    )
  },

  async updateTimesheet(actor, id, input: TimesheetInput) {
    if (isAdminActor(actor)) {
      return write(
        `update public.timesheets
         set project_id = $1, activity_type_id = $2, log_date = $3, hours_worked = $4, work_done = $5
         where id = $6`,
        [input.projectId, input.activityTypeId, input.logDate, input.hoursWorked, sanitizeWorkDone(input.workDone), id]
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
      [input.projectId, input.activityTypeId, input.logDate, input.hoursWorked, sanitizeWorkDone(input.workDone), id, actor.id]
    )
  },

  async deleteTimesheet(actor, id) {
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

  async countTimesheetsByProject(actor, projectId) {
    if (!hasPermission(actor, ['admin', 'pm'])) return 0
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

    if (isAdminActor(actor)) {
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
      `select id, user_id, leave_date, reason, created_at from public.leaves ${where} order by leave_date asc limit 1000`,
      params
    )
    return rows as LeaveEntry[]
  },

  async createLeaves(actor, rows: LeafRowInput[]) {
    if (rows.length === 0) return { error: null }
    for (const row of rows) {
      if (!isAdminActor(actor) && row.userId !== actor.id) {
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
    if (isAdminActor(actor)) {
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
    const userId = isAdminActor(actor) ? input.userId : actor.id
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

  async updateMyProfile(actor, input) {
    const cleanTitle = (input.title || '').trim()
    if (cleanTitle) {
      const titleRows = await query<{ hierarchy_role: HierarchyRole }>(
        'select hierarchy_role from public.titles where lower(name) = lower($1)',
        [cleanTitle]
      )
      if (titleRows[0] && titleRows[0].hierarchy_role !== actor.hierarchy_role) {
        return {
          error: `Cannot change to title "${cleanTitle}" because it belongs to the "${titleRows[0].hierarchy_role}" hierarchy role. Changing hierarchy roles requires an administrator.`,
        }
      }
    }
    return write(
      'update public.profiles set department = $1, title = $2 where id = $3',
      [input.department, cleanTitle, actor.id]
    )
  },

  async updateUserName(actor, userId, name) {
    if (!isAdminActor(actor)) return { error: 'You do not have permission to perform this action.' }
    return write('update public.profiles set name = $1 where id = $2', [name, userId])
  },

  async updateUserManager(actor, userId, managerId) {
    if (!isAdminActor(actor)) return { error: 'You do not have permission to perform this action.' }
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
    if (!isAdminActor(actor)) return []
    const rows = await query<ActivityTypeRow>(
      'select id, name, is_active, telegram_no, created_at from public.activity_types order by name'
    )
    return rows as ActivityType[]
  },

  async createActivityType(actor, name) {
    if (!isAdminActor(actor)) return { error: 'You do not have permission to perform this action.' }
    return write('insert into public.activity_types (name) values ($1)', [name])
  },

  async renameActivityType(actor, id, name) {
    if (!isAdminActor(actor)) return { error: 'You do not have permission to perform this action.' }
    return write('update public.activity_types set name = $1 where id = $2', [name, id])
  },

  async setActivityTypeActive(actor, id, isActive) {
    if (!isAdminActor(actor)) return { error: 'You do not have permission to perform this action.' }
    return write('update public.activity_types set is_active = $1 where id = $2', [isActive, id])
  },

  async setActivityTypeTelegramNo(actor, id, telegramNo) {
    if (!isAdminActor(actor)) return { error: 'You do not have permission to perform this action.' }
    return write('update public.activity_types set telegram_no = $1 where id = $2', [telegramNo, id])
  },

  // --- global reminders ---

  async listGlobalReminders(actor) {
    if (!isAdminActor(actor)) return []
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
    if (!isAdminActor(actor)) return { error: 'You do not have permission to perform this action.' }
    return write(
      'insert into public.global_reminders (message, remind_at) values ($1, $2)',
      [input.message, input.remindAt]
    )
  },

  async updateGlobalReminder(actor, id, input) {
    if (!isAdminActor(actor)) return { error: 'You do not have permission to perform this action.' }
    const fields: string[] = []
    const values: unknown[] = []
    let i = 1
    if (input.message !== undefined) {
      fields.push(`message = $${i++}`)
      values.push(input.message.trim())
    }
    if (input.remindAt !== undefined) {
      fields.push(`remind_at = $${i++}`)
      values.push(input.remindAt)
    }
    if (fields.length === 0) return { error: null }
    values.push(id)
    return write(
      `update public.global_reminders set ${fields.join(', ')} where id = $${i}`,
      values
    )
  },

  async deleteGlobalReminder(actor, id) {
    if (!isAdminActor(actor)) return { error: 'You do not have permission to perform this action.' }
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
    if (!isAdminActor(actor)) return { error: 'You do not have permission to perform this action.' }
    return write(
      'update public.app_settings set backfill_window_days = $1, backfill_mode = $2, backfill_extra_days = $3, updated_at = now() where id = 1',
      [settings.windowDays, settings.mode, settings.extraDays]
    )
  },

  async getDefaultLayouts(_actor) {
    try {
      const rows = await query<{
        default_dashboard_layout: DashboardLayout | null
        default_admin_layout: AdminDashboardLayout | null
        default_mobile_layout: MobileLayout | null
      }>('select default_dashboard_layout, default_admin_layout, default_mobile_layout from public.app_settings where id = 1 limit 1')
      const row = rows[0]
      return {
        data: {
          dashboard: row?.default_dashboard_layout ?? DEFAULT_DASHBOARD_LAYOUT,
          admin: row?.default_admin_layout ?? DEFAULT_ADMIN_LAYOUT,
          mobile: row?.default_mobile_layout ?? DEFAULT_MOBILE_LAYOUT,
        },
        error: null,
      }
    } catch (err) {
      return {
        data: null,
        error: err instanceof Error ? err.message : 'Failed to load default layouts.',
      }
    }
  },

  async setDefaultLayouts(actor, layouts) {
    if (!isSuperAdmin(actor)) return { error: 'You do not have permission to perform this action.' }
    if (layouts.mobile !== undefined) {
      const mobileJson = layouts.mobile ? JSON.stringify(layouts.mobile) : null
      return write(
        'update public.app_settings set default_dashboard_layout = $1, default_admin_layout = $2, default_mobile_layout = $3, updated_at = now() where id = 1',
        [JSON.stringify(layouts.dashboard), JSON.stringify(layouts.admin), mobileJson]
      )
    }
    return write(
      'update public.app_settings set default_dashboard_layout = $1, default_admin_layout = $2, updated_at = now() where id = 1',
      [JSON.stringify(layouts.dashboard), JSON.stringify(layouts.admin)]
    )
  },

  async getBranding(_actor) {
    try {
      const rows = await query<{
        app_name: string | null
        primary_color: string | null
        logo_url: string | null
      }>('select app_name, primary_color, logo_url from public.app_settings where id = 1 limit 1')
      const row = rows[0]
      return {
        data: normalizeBranding(row),
        error: null,
      }
    } catch (err) {
      return {
        data: null,
        error: err instanceof Error ? err.message : 'Failed to load branding settings.',
      }
    }
  },

  async setBranding(actor, branding) {
    if (!isSuperAdmin(actor)) return { error: 'You do not have permission to perform this action.' }
    return write(
      'update public.app_settings set app_name = $1, primary_color = $2, logo_url = $3, updated_at = now() where id = 1',
      [branding.appName, branding.primaryColor, branding.logoUrl]
    )
  },

  // --- dashboard & mobile layout (own profile) ---

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

  async setMobileLayout(actor, layout) {
    return write('update public.profiles set mobile_layout = $1 where id = $2', [
      layout ? JSON.stringify(layout) : null,
      actor.id,
    ])
  },

  async getMobileLayout(actor) {
    try {
      const rows = await query<{ mobile_layout: MobileLayout | null }>(
        'select mobile_layout from public.profiles where id = $1 limit 1',
        [actor.id]
      )
      return { data: rows[0]?.mobile_layout ?? null, error: null }
    } catch (err) {
      return { data: null, error: err instanceof Error ? err.message : 'Failed to load mobile layout.' }
    }
  },

  // --- super-admin data lifecycle ---

  async deleteUser(actor, userId) {
    if (!isAdminActor(actor)) return { error: 'You do not have permission to perform this action.' }
    // Timesheets/leaves/reminders/dismissals cascade via their FK definitions.
    return write('delete from public.profiles where id = $1', [userId])
  },

  async deleteActivityType(actor, id) {
    if (!isAdminActor(actor)) return { error: 'You do not have permission to perform this action.' }
    // Timesheet references become null via "on delete set null".
    return write('delete from public.activity_types where id = $1', [id])
  },

  async deleteUserTimesheets(actor, userId) {
    if (!isAdminActor(actor)) return { error: 'You do not have permission to perform this action.' }
    return write('delete from public.timesheets where user_id = $1', [userId])
  },

  async resetTimesheets(actor) {
    if (!isAdminActor(actor)) return { error: 'You do not have permission to perform this action.' }
    return write('delete from public.timesheets')
  },

  async resetActivityData(actor) {
    if (!isAdminActor(actor)) return { error: 'You do not have permission to perform this action.' }
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
    if (!isAdminActor(actor)) return { error: 'You do not have permission to perform this action.' }
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
    if (!isAdminActor(actor)) {
      return { imported: 0, skipped: rows.length, error: 'You do not have permission to perform this action.' }
    }
    if (rows.length === 0) return { imported: 0, skipped: 0, error: null }

    // Callers validate the 24h daily cap before inserting; rows are inserted
    // as-is (multiple entries per user per day are allowed).
    const values: string[] = []
    const params: unknown[] = []
    rows.forEach(row => {
      params.push(row.userId, row.projectId, row.activityTypeId, row.logDate, row.hoursWorked, sanitizeWorkDone(row.workDone))
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

  async bulkUpdateTimesheets(actor, rows) {
    const empty: BulkTimesheetUpdateResult = { updated: 0, rowErrors: [], error: null }
    if (!Array.isArray(rows) || rows.length === 0) return empty

    // Only admins can edit anyone's rows. COs and hierarchy leaders may read
    // broader scopes, but their write scope remains limited to their own rows.
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
      valueTuples.push(`($${base + 1}::uuid, $${base + 2}::uuid, $${base + 3}::uuid, $${base + 4}::date, $${base + 5}::numeric, $${base + 6}::text)`)
    })

    let scope = 't.id = v.id'
    if (!canEditAll) {
      params.push(actor.id)
      // Non-admin edits additionally require the target row to belong to the
      // actor AND both the existing and replacement dates to remain inside the
      // writable backfill window (a locked historical row cannot be moved into
      // the window through a direct bulk call). Window predicates come from the
      // same app_settings rules the single-row actions enforce.
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

      const updatedIds = new Set(res.map(r => r.id))
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
        updated: updatedIds.size,
        rowErrors,
        error: rowErrors.length === rows.length ? 'All edits failed.' : null,
      }
    } catch (err) {
      return { ...empty, error: friendlyWriteError(err) }
    }
  },

  // --- backup & restore (admin) ---

  async exportBackup(actor) {
    if (!isAdminActor(actor)) {
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
    if (!isAdminActor(actor)) {
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
      // Scope existing query to relevant user IDs and log dates in the backup.
      const relevantUserIds = Array.from(
        new Set(
          payload.timesheets
            .map((t) => userByEmail.get(t.email.toLowerCase()))
            .filter((id): id is string => Boolean(id))
        )
      )
      const relevantDates = Array.from(new Set(payload.timesheets.map((t) => t.log_date)))

      const existingEntries =
        relevantUserIds.length > 0 && relevantDates.length > 0
          ? await client.query<{
              user_id: string
              log_date: string
              project_id: string
              activity_type_id: string | null
              hours_worked: number
            }>(
              'select user_id, log_date, project_id, activity_type_id, hours_worked from public.timesheets where user_id = any($1::uuid[]) and log_date = any($2::date[])',
              [relevantUserIds, relevantDates]
            )
          : { rows: [] }

      const existingKeys = new Set<string>()
      const totals = new Map<string, number>()
      for (const r of existingEntries.rows) {
        existingKeys.add(`${r.user_id}|${r.log_date}|${r.project_id}|${r.activity_type_id ?? ''}|${Number(r.hours_worked)}`)
        const k = `${r.user_id}|${r.log_date}`
        totals.set(k, (totals.get(k) ?? 0) + Number(r.hours_worked))
      }

      const timesheetsToInsert: Array<[string, string, string | null, string, number, string]> = []
      for (const t of payload.timesheets) {
        const userId = userByEmail.get(t.email.toLowerCase())
        const projectId = projectIdByName.get(t.project)
        if (!userId || !projectId) { skipped++; continue }
        const typeId = t.activity_type ? (typeIdByName.get(t.activity_type) ?? null) : null
        const key = `${userId}|${t.log_date}|${projectId}|${typeId ?? ''}|${t.hours_worked}`
        if (existingKeys.has(key)) { skipped++; continue }
        const k = `${userId}|${t.log_date}`
        const current = totals.get(k) ?? 0
        if (current + t.hours_worked > 24) { skipped++; continue }
        timesheetsToInsert.push([
          userId,
          projectId,
          typeId,
          t.log_date,
          t.hours_worked,
          sanitizeWorkDone(t.work_done) || 'restored entry',
        ])
        totals.set(k, current + t.hours_worked)
        existingKeys.add(key)
      }

      // Batch insert timesheets in chunks of 50
      const BATCH_SIZE = 50
      for (let i = 0; i < timesheetsToInsert.length; i += BATCH_SIZE) {
        const batch = timesheetsToInsert.slice(i, i + BATCH_SIZE)
        const valueTuples: string[] = []
        const params: unknown[] = []
        batch.forEach((row, rowIdx) => {
          const offset = rowIdx * 6
          valueTuples.push(`($${offset + 1}::uuid, $${offset + 2}::uuid, $${offset + 3}::uuid, $${offset + 4}::date, $${offset + 5}::numeric, $${offset + 6})`)
          params.push(...row)
        })
        await client.query(
          `insert into public.timesheets (user_id, project_id, activity_type_id, log_date, hours_worked, work_done)
           values ${valueTuples.join(', ')}`,
          params
        )
        created.timesheets += batch.length
      }

      // Leaves: unique (user_id, leave_date) — skip duplicates via ON CONFLICT.
      const leavesToInsert: Array<[string, string, string]> = []
      for (const l of payload.leaves) {
        const userId = userByEmail.get(l.email)
        if (!userId) { skipped++; continue }
        leavesToInsert.push([userId, l.leave_date, l.reason])
      }
      for (let i = 0; i < leavesToInsert.length; i += BATCH_SIZE) {
        const batch = leavesToInsert.slice(i, i + BATCH_SIZE)
        const valueTuples: string[] = []
        const params: unknown[] = []
        batch.forEach((row, rowIdx) => {
          const offset = rowIdx * 3
          valueTuples.push(`($${offset + 1}::uuid, $${offset + 2}::date, $${offset + 3})`)
          params.push(...row)
        })
        const res = await client.query(
          `insert into public.leaves (user_id, leave_date, reason) values ${valueTuples.join(', ')} on conflict do nothing`,
          params
        )
        const inserted = res.rowCount ?? 0
        created.leaves += inserted
        skipped += batch.length - inserted
      }

      // Reminders: batch insert
      const remindersToInsert: Array<[string, string, string, boolean]> = []
      for (const r of payload.reminders) {
        const userId = userByEmail.get(r.email)
        if (!userId) { skipped++; continue }
        remindersToInsert.push([userId, r.message, r.remind_at, Boolean(r.done)])
      }
      for (let i = 0; i < remindersToInsert.length; i += BATCH_SIZE) {
        const batch = remindersToInsert.slice(i, i + BATCH_SIZE)
        const valueTuples: string[] = []
        const params: unknown[] = []
        batch.forEach((row, rowIdx) => {
          const offset = rowIdx * 4
          valueTuples.push(`($${offset + 1}::uuid, $${offset + 2}, $${offset + 3}::timestamptz, $${offset + 4}::boolean)`)
          params.push(...row)
        })
        await client.query(
          `insert into public.reminders (user_id, message, remind_at, done) values ${valueTuples.join(', ')}`,
          params
        )
        created.reminders += batch.length
      }

      // Global reminders: batch insert
      for (let i = 0; i < payload.globalReminders.length; i += BATCH_SIZE) {
        const batch = payload.globalReminders.slice(i, i + BATCH_SIZE)
        const valueTuples: string[] = []
        const params: unknown[] = []
        batch.forEach((g, rowIdx) => {
          const offset = rowIdx * 2
          valueTuples.push(`($${offset + 1}, $${offset + 2}::timestamptz)`)
          params.push(g.message, g.remind_at)
        })
        await client.query(
          `insert into public.global_reminders (message, remind_at) values ${valueTuples.join(', ')}`,
          params
        )
        created.globalReminders += batch.length
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
    if (!canSeeAllActor(actor) && userId !== actor.id) return 0
    const rows = await query<{ h: number }>(
      `select coalesce(sum(hours_worked), 0)::float8 as h
       from public.timesheets
       where user_id = $1 and log_date = $2 and ($3::uuid is null or id <> $3)`,
      [userId, logDate, excludeEntryId ?? null]
    )
    return Number(rows[0]?.h ?? 0)
  },

  async sumHoursForUserDates(actor, userDatePairs) {
    const totals = new Map<string, number>()
    if (!userDatePairs || userDatePairs.length === 0) return totals
    userDatePairs.forEach((p) => totals.set(`${p.userId}:${p.logDate}`, 0))

    const uIds = userDatePairs.map((p) => p.userId)
    const lDates = userDatePairs.map((p) => p.logDate)

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
         select unnest($1::uuid[]) as u_id, unnest($2::text[]) as l_date
       ) as v on t.user_id = v.u_id and t.log_date = v.l_date
       ${whereClause}
       group by t.user_id, t.log_date`,
      params
    )

    for (const r of rows) {
      totals.set(`${r.user_id}:${r.log_date}`, Number(r.total) || 0)
    }
    return totals
  },

  async getTimesheetDailyTotals(actor) {
    if (!isAdminActor(actor)) return []
    const rows = await query<{ user_id: string; log_date: string; hours: number }>(
      `select user_id, log_date, coalesce(sum(hours_worked), 0)::float8 as hours
       from public.timesheets
       group by user_id, log_date`
    )
    return rows.map(r => ({ userId: r.user_id, logDate: r.log_date, hours: Number(r.hours) }))
  },

  async getGroupedReportTotals(actor, input: ReportTotalsInput, groupBy) {
    // GROUP BY aggregation in SQL so the report does not ship every row to the
    // server process. Scope is limited to the actor's visible rows (same rule
    // as listTimesheets via timesheetScope).
    const { where, params } = timesheetScope(actor)

    const conds: string[] = []
    if (where) conds.push(where.slice('where '.length))
    if (input.projectId) {
      params.push(input.projectId)
      conds.push(`t.project_id = $${params.length}`)
    }
    if (input.userId) {
      params.push(input.userId)
      conds.push(`t.user_id = $${params.length}`)
    }
    if (input.from) {
      params.push(input.from)
      conds.push(`t.log_date >= $${params.length}`)
    }
    if (input.to) {
      params.push(input.to)
      conds.push(`t.log_date <= $${params.length}`)
    }
    const whereClause = conds.length ? `where ${conds.join(' and ')}` : ''

    const labelExpr =
      groupBy === 'project'
        ? 'coalesce(p.name, \'Unknown project\')'
        : groupBy === 'activity'
          ? 'coalesce(at.name, \'(no type)\')'
          : 'coalesce(pr.email, \'Unknown\')'

    const rows = await query<{ label: string; hours: number; entries: number }>(
      `select ${labelExpr} as label, coalesce(sum(t.hours_worked), 0)::float8 as hours, count(*)::int as entries
       from public.timesheets t
       left join public.projects p on p.id = t.project_id
       left join public.activity_types at on at.id = t.activity_type_id
       left join public.profiles pr on pr.id = t.user_id
       ${whereClause}
       group by ${labelExpr}
       order by hours desc`,
      params
    )
    return rows.map((r) => ({ label: r.label, hours: Number(r.hours), entries: r.entries }))
  },

  async writeAuditLog(actor, input) {
    return write(
      `insert into public.audit_logs (actor_id, actor_email, action, target_id, detail)
       values ($1, $2, $3, $4, $5)`,
      [actor.id, actor.email, input.action, input.targetId ?? null, input.detail ? JSON.stringify(input.detail) : null]
    )
  },

  // --- shared rate limiting ---

  async reserveRateLimit(input) {
    // One statement, so concurrent workers cannot both observe budget and both
    // proceed. `on conflict ... where count < limit` makes the increment
    // conditional inside the same row lock the upsert already takes: losers of
    // the race see no returned row, which means "at limit".
    const rows = await query<{ count: number }>(
      `insert into public.rate_limits (bucket, subject_hash, window_start, reset_at, count)
       values ($1, $2, $3, $4, 1)
       on conflict (bucket, subject_hash, window_start) do update
         set count = public.rate_limits.count + 1
       where public.rate_limits.count < $5
       returning count`,
      [input.bucket, input.subjectHash, input.windowStart, input.resetAt, input.limit]
    )

    if (rows.length === 0) {
      return { reserved: false, count: input.limit }
    }
    return { reserved: true, count: Number(rows[0].count) }
  },

  async releaseRateLimit(input) {
    // greatest(...,0) so a double release cannot drive the window negative and
    // hand out free budget.
    await query(
      `update public.rate_limits
          set count = greatest(count - 1, 0)
        where bucket = $1 and subject_hash = $2 and window_start = $3`,
      [input.bucket, input.subjectHash, input.windowStart]
    )
  },

  async cleanupRateLimits(before) {
    const rows = await query<{ id: number }>(
      `with removed as (
         delete from public.rate_limits where reset_at <= $1 returning 1 as id
       )
       select count(*)::int as id from removed`,
      [before]
    )
    return Number(rows[0]?.id ?? 0)
  },

  // --- email domain whitelist ---

  async listWhitelistedDomains() {
    const rows = await query<{
      id: string
      domain: string
      auto_activate: boolean
      created_at: string
    }>('select id, domain, auto_activate, created_at from public.whitelisted_domains order by domain asc')
    return rows.map((r) => ({
      id: r.id,
      domain: r.domain,
      auto_activate: r.auto_activate,
      created_at: r.created_at,
    }))
  },

  async addWhitelistedDomain(actor, domain, autoActivate) {
    if (!isAdminActor(actor)) {
      return { error: 'You do not have permission to manage email domains.' }
    }
    const clean = domain.trim().toLowerCase().replace(/^@/, '')
    if (!clean) return { error: 'Domain name is required.' }
    return write(
      `insert into public.whitelisted_domains (domain, auto_activate) values ($1, $2)`,
      [clean, autoActivate]
    )
  },

  async updateWhitelistedDomain(actor, id, autoActivate) {
    if (!isAdminActor(actor)) {
      return { error: 'You do not have permission to manage email domains.' }
    }
    return write(
      `update public.whitelisted_domains set auto_activate = $1 where id = $2`,
      [autoActivate, id]
    )
  },

  async deleteWhitelistedDomain(actor, id) {
    if (!isAdminActor(actor)) {
      return { error: 'You do not have permission to manage email domains.' }
    }
    return write(`delete from public.whitelisted_domains where id = $1`, [id])
  },

  async findWhitelistedDomain(domain) {
    const clean = domain.trim().toLowerCase().replace(/^@/, '')
    const rows = await query<{
      id: string
      domain: string
      auto_activate: boolean
      created_at: string
    }>('select id, domain, auto_activate, created_at from public.whitelisted_domains where lower(domain) = $1 limit 1', [clean])
    return rows[0] ?? null
  },

  // --- hierarchy & reporting structure ---

  async updateUserHierarchy(actor, userId, data) {
    if (!isAdminActor(actor)) {
      return { error: 'You do not have permission to update hierarchy.' }
    }

    const sets: string[] = []
    const params: unknown[] = []

    sets.push(`manager_id = $${params.length + 1}`)
    params.push(data.managerId ?? null)

    if (data.title !== undefined) {
      sets.push(`title = $${params.length + 1}`)
      params.push(data.title.trim())
    }

    if (data.hierarchyRole !== undefined) {
      // Only the hierarchy axis changes here; the permission axis is
      // preserved. The legacy combined `role` column is recomputed so it
      // stays consistent (main's separate-role trigger does the same).
      const rows = await query<{ permission_role: PermissionRole }>(
        'select permission_role from public.profiles where id = $1',
        [userId]
      )
      const permission = rows[0]?.permission_role ?? 'user'
      const legacy = legacyRoleFromPair(permission, data.hierarchyRole)
      sets.push(`hierarchy_role = $${params.length + 1}`)
      params.push(data.hierarchyRole)
      sets.push(`role = $${params.length + 1}`)
      params.push(legacy)
    }

    params.push(userId)
    return write(
      `update public.profiles set ${sets.join(', ')} where id = $${params.length}`,
      params
    )
  },

  // --- titles management ---

  async listTitles() {
    const rows = await query<{ name: string }>(
      'select name from public.titles order by name asc'
    )
    return rows.map((r) => r.name)
  },

  async listTitleRecords() {
    const rows = await query<TitleRecord>(
      'select id, name, hierarchy_role, created_at from public.titles order by name asc'
    )
    return rows
  },

  async addTitle(actor, name, hierarchyRole = 'user') {
    if (!isAdminActor(actor)) {
      return { error: 'You do not have permission to manage titles.' }
    }
    const clean = name.trim()
    if (!clean) return { error: 'Title name is required.' }
    if (!HIERARCHY_ROLES.includes(hierarchyRole)) {
      return { error: 'Invalid hierarchy role.' }
    }
    return write(
      'insert into public.titles (name, hierarchy_role) values ($1, $2) on conflict (name) do update set hierarchy_role = excluded.hierarchy_role',
      [clean, hierarchyRole]
    )
  },

  async deleteTitle(actor, name) {
    if (!isAdminActor(actor)) {
      return { error: 'You do not have permission to manage titles.' }
    }
    const clean = name.trim()
    return write('delete from public.titles where lower(name) = lower($1)', [clean])
  },

  async reclassifyTitle(actor, name, hierarchyRole, syncUsers = false) {
    if (!isAdminActor(actor)) {
      return { error: 'You do not have permission to manage titles.' }
    }
    const clean = name.trim()
    if (!clean) return { error: 'Title name is required.' }
    if (!HIERARCHY_ROLES.includes(hierarchyRole)) {
      return { error: 'Invalid hierarchy role.' }
    }

    const pool = getPool()
    const client = await pool.connect()
    try {
      await client.query('begin')

      const titleRes = await client.query<{ name: string; hierarchy_role: string }>(
        'select name, hierarchy_role from public.titles where lower(name) = lower($1) for update',
        [clean]
      )
      if (titleRes.rows.length === 0) {
        await client.query('rollback')
        return { error: `Title "${clean}" not found.` }
      }

      const profilesRes = await client.query<{ id: string }>(
        'select id from public.profiles where lower(title) = lower($1) for update',
        [clean]
      )
      const affectedCount = profilesRes.rows.length

      await client.query(
        'update public.titles set hierarchy_role = $1 where lower(name) = lower($2)',
        [hierarchyRole, clean]
      )

      if (syncUsers && affectedCount > 0) {
        const legacy = hierarchyRole === 'manager' || hierarchyRole === 'team_lead' ? hierarchyRole : 'user'
        await client.query(
          `update public.profiles
           set hierarchy_role = $1,
               role = case when permission_role in ('admin', 'pm', 'co') then permission_role else $2 end
           where lower(title) = lower($3)`,
          [hierarchyRole, legacy, clean]
        )
      }

      await client.query('commit')
      return { error: null, affectedCount }
    } catch (err) {
      await client.query('rollback')
      return { error: err instanceof Error ? err.message : 'Failed to reclassify title.' }
    } finally {
      client.release()
    }
  },

  async getTitleImpact(actor, name, proposedRole) {
    if (!isAdminActor(actor)) {
      return { error: 'You do not have permission to manage titles.' }
    }
    const clean = name.trim()
    if (!clean) return { error: 'Title name is required.' }

    const titleRows = await query<{ name: string; hierarchy_role: string }>(
      'select name, hierarchy_role from public.titles where lower(name) = lower($1) limit 1',
      [clean]
    )
    if (titleRows.length === 0) {
      return { error: `Title "${clean}" not found.` }
    }
    const currentHierarchyRole = (titleRows[0].hierarchy_role || 'user') as HierarchyRole
    const proposed = proposedRole && HIERARCHY_ROLES.includes(proposedRole) ? proposedRole : currentHierarchyRole

    const affectedRows = await query<{ count: string }>(
      'select count(*)::text as count from public.profiles where lower(title) = lower($1)',
      [clean]
    )
    const affectedCount = parseInt(affectedRows[0]?.count || '0', 10)
    const syncRequired = affectedCount > 0 && currentHierarchyRole !== proposed

    return {
      title: titleRows[0].name,
      currentHierarchyRole,
      proposedHierarchyRole: proposed,
      affectedCount,
      syncRequired,
    }
  },
}
