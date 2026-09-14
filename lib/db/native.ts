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
  AdminDashboardLayout,
  BackupRestoreResult,
  DashboardLayout,
  GlobalReminder,
  HierarchyRole,
  LeaveEntry,
  MobileLayout,
  PermissionRole,
  Reminder,
  User,
  UserRole,
} from '@/app/types'
import { DEFAULT_ADMIN_LAYOUT, DEFAULT_DASHBOARD_LAYOUT } from '@/app/constants'
import { DEFAULT_MOBILE_LAYOUT } from '@/lib/layout'
import { normalizeBranding } from '@/lib/branding'
import type { BackfillSettings } from '@/lib/validation'
import { sanitizeWorkDone } from '@/lib/validation'
import { getPool, query } from './pool'
import { hashPassword } from '@/lib/auth/password'
import { canSeeAllActor, isAdminActor, isLeaderActor, legacyRoleFromPair } from '@/lib/roles'
import { isSuperAdmin } from '@/lib/auth/super-admin'
import { nativeTimesheetPersistence } from './native/timesheets'
import { nativeReferencePersistence } from './native/reference'
import type {
  Actor,
  DbCreateResult,
  DbWrite,
  LeafRowInput,
  ReportTotalsInput,
  Repository,
  TimesheetInput,
  TimesheetListOptions,
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

async function writeReturning<T>(sql: string, params?: unknown[]): Promise<DbCreateResult<T>> {
  try {
    const rows = await query<T>(sql, params)
    const row = rows[0] ?? null
    if (!row) {
      return { data: null, error: 'Record could not be created.' }
    }
    return { data: row, error: null }
  } catch (err) {
    return { data: null, error: friendlyWriteError(err) }
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

  async listProjects(actor) {
    return nativeReferencePersistence.listProjects(actor)
  },

  async createProject(actor, nameOrInput, options) {
    return nativeReferencePersistence.createProject(actor, nameOrInput, options)
  },

  async renameProject(actor, id, name) {
    return nativeReferencePersistence.renameProject(actor, id, name)
  },

  async setProjectSO(actor, id, soNumber) {
    return nativeReferencePersistence.setProjectSO(actor, id, soNumber)
  },

  async setProjectTelegramNo(actor, id, telegramNo) {
    return nativeReferencePersistence.setProjectTelegramNo(actor, id, telegramNo)
  },

  async deleteProject(actor, id) {
    return nativeReferencePersistence.deleteProject(actor, id)
  },

  // --- timesheets ---

  async listTimesheets(actor, opts: TimesheetListOptions = {}) {
    return nativeTimesheetPersistence.list(actor, opts)
  },

  async getTimesheet(actor, id) {
    return nativeTimesheetPersistence.getById(actor, id)
  },

  async getTimesheetsByIds(actor, ids) {
    return nativeTimesheetPersistence.getByIds(actor, ids)
  },

  async findTimesheetByUserDate(actor, userId, logDate) {
    return nativeTimesheetPersistence.getByUserDate(actor, userId, logDate)
  },

  async getLatestTimesheet(actor, userId) {
    return nativeTimesheetPersistence.getLatest(actor, userId)
  },

  async createTimesheet(actor, input: TimesheetInput) {
    return nativeTimesheetPersistence.create(actor, input)
  },

  async updateTimesheet(actor, id, input: TimesheetInput) {
    return nativeTimesheetPersistence.update(actor, id, input)
  },

  async deleteTimesheet(actor, id) {
    return nativeTimesheetPersistence.remove(actor, id)
  },

  async countTimesheetsByProject(actor, projectId) {
    return nativeTimesheetPersistence.countByProject(actor, projectId)
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

  async listActivityTypes(actor) {
    return nativeReferencePersistence.listActivityTypes(actor)
  },

  async listAllActivityTypes(actor) {
    return nativeReferencePersistence.listAllActivityTypes(actor)
  },

  async createActivityType(actor, nameOrInput, options) {
    return nativeReferencePersistence.createActivityType(actor, nameOrInput, options)
  },

  async renameActivityType(actor, id, name) {
    return nativeReferencePersistence.renameActivityType(actor, id, name)
  },

  async setActivityTypeActive(actor, id, isActive) {
    return nativeReferencePersistence.setActivityTypeActive(actor, id, isActive)
  },

  async setActivityTypeTelegramNo(actor, id, telegramNo) {
    return nativeReferencePersistence.setActivityTypeTelegramNo(actor, id, telegramNo)
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
    if (!isAdminActor(actor)) return { data: null, error: 'You do not have permission to perform this action.' }
    return writeReturning<GlobalReminder>(
      'insert into public.global_reminders (message, remind_at) values ($1, $2) returning id, message, remind_at::text as remind_at, created_at::text as created_at',
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
    return nativeReferencePersistence.deleteActivityType(actor, id)
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
    return nativeTimesheetPersistence.bulkUpdate(actor, rows)
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
      await client.query('lock table public.projects, public.activity_types, public.timesheets, public.leaves, public.reminders, public.global_reminders in exclusive mode')

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
        const userId = userByEmail.get(l.email.toLowerCase())
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
          `insert into public.leaves (user_id, leave_date, reason) values ${valueTuples.join(', ')} on conflict (user_id, leave_date) do nothing`,
          params
        )
        const inserted = res.rowCount ?? 0
        created.leaves += inserted
        skipped += batch.length - inserted
      }

      // Reminders: deduplicate against existing (user_id, message, remind_at)
      const relevantReminderUserIds = Array.from(
        new Set(
          payload.reminders
            .map((r) => userByEmail.get(r.email.toLowerCase()))
            .filter((id): id is string => Boolean(id))
        )
      )
      const existingReminders =
        relevantReminderUserIds.length > 0
          ? await client.query<{ user_id: string; message: string; remind_at: string }>(
              'select user_id, message, remind_at::text from public.reminders where user_id = any($1::uuid[])',
              [relevantReminderUserIds]
            )
          : { rows: [] }
      const existingReminderKeys = new Set(
        existingReminders.rows.map((r) => {
          const t = new Date(r.remind_at).getTime()
          return `${r.user_id}|${r.message}|${Number.isNaN(t) ? r.remind_at : t}`
        })
      )

      const remindersToInsert: Array<[string, string, string, boolean]> = []
      for (const r of payload.reminders) {
        const userId = userByEmail.get(r.email.toLowerCase())
        if (!userId) { skipped++; continue }
        const t = new Date(r.remind_at).getTime()
        const key = `${userId}|${r.message}|${Number.isNaN(t) ? r.remind_at : t}`
        if (existingReminderKeys.has(key)) { skipped++; continue }
        existingReminderKeys.add(key)
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

      // Global reminders: deduplicate against existing (message, remind_at)
      const relevantGlobalMessages = Array.from(new Set(payload.globalReminders.map((g) => g.message)))
      const existingGlobals =
        relevantGlobalMessages.length > 0
          ? await client.query<{ message: string; remind_at: string }>(
              'select message, remind_at::text from public.global_reminders where message = any($1::text[])',
              [relevantGlobalMessages]
            )
          : { rows: [] }
      const existingGlobalKeys = new Set(
        existingGlobals.rows.map((g) => {
          const t = new Date(g.remind_at).getTime()
          return `${g.message}|${Number.isNaN(t) ? g.remind_at : t}`
        })
      )

      const globalsToInsert: Array<[string, string]> = []
      for (const g of payload.globalReminders) {
        const t = new Date(g.remind_at).getTime()
        const key = `${g.message}|${Number.isNaN(t) ? g.remind_at : t}`
        if (existingGlobalKeys.has(key)) { skipped++; continue }
        existingGlobalKeys.add(key)
        globalsToInsert.push([g.message, g.remind_at])
      }
      for (let i = 0; i < globalsToInsert.length; i += BATCH_SIZE) {
        const batch = globalsToInsert.slice(i, i + BATCH_SIZE)
        const valueTuples: string[] = []
        const params: unknown[] = []
        batch.forEach((row, rowIdx) => {
          const offset = rowIdx * 2
          valueTuples.push(`($${offset + 1}, $${offset + 2}::timestamptz)`)
          params.push(...row)
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
    return nativeTimesheetPersistence.sumHoursForUserDate(actor, userId, logDate, excludeEntryId)
  },

  async sumHoursForUserDates(actor, userDatePairs) {
    return nativeTimesheetPersistence.sumHoursForUserDates(actor, userDatePairs)
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

  async listWhitelistedDomains(actor) {
    return nativeReferencePersistence.listWhitelistedDomains(actor)
  },

  async addWhitelistedDomain(actor, domain, autoActivate) {
    return nativeReferencePersistence.addWhitelistedDomain(actor, domain, autoActivate)
  },

  async updateWhitelistedDomain(actor, id, autoActivate) {
    return nativeReferencePersistence.updateWhitelistedDomain(actor, id, autoActivate)
  },

  async deleteWhitelistedDomain(actor, id) {
    return nativeReferencePersistence.deleteWhitelistedDomain(actor, id)
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
    return nativeReferencePersistence.listTitles()
  },

  async listTitleRecords() {
    return nativeReferencePersistence.listTitleRecords()
  },

  async addTitle(actor, name, hierarchyRole = 'user') {
    return nativeReferencePersistence.addTitle(actor, name, hierarchyRole)
  },

  async deleteTitle(actor, name) {
    return nativeReferencePersistence.deleteTitle(actor, name)
  },

  async reclassifyTitle(actor, name, hierarchyRole, syncUsers = false) {
    return nativeReferencePersistence.reclassifyTitle(actor, name, hierarchyRole, syncUsers)
  },

  async getTitleImpact(actor, name, proposedRole) {
    return nativeReferencePersistence.getTitleImpact(actor, name, proposedRole)
  },
}
