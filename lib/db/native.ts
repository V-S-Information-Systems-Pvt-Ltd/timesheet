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
  LeaveEntry,
  Project,
  Reminder,
  Timesheet,
  User,
  UserRole,
} from '@/app/types'
import { query } from './pool'
import { hashPassword } from '@/lib/auth/password'
import type {
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
  created_at: string
}

interface ProjectRow {
  id: string
  name: string
  so_number: string | null
  created_at: string
}

interface TimesheetJoinedRow {
  id: string
  user_id: string
  project_id: string
  log_date: string
  hours_worked: number
  work_done: string
  created_at: string
  project_name: string | null
  user_email: string | null
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

const PROFILE_COLS = 'id, email, name, department, title, role, is_active, created_at'

function mapProfile(r: ProfileRow): User {
  return {
    id: r.id,
    email: r.email,
    name: r.name,
    department: r.department,
    title: r.title,
    role: r.role,
    is_active: r.is_active,
    created_at: r.created_at,
  }
}

function mapTimesheet(r: TimesheetJoinedRow): Timesheet {
  return {
    id: r.id,
    user_id: r.user_id,
    project_id: r.project_id,
    log_date: r.log_date,
    hours_worked: r.hours_worked,
    work_done: r.work_done,
    created_at: r.created_at,
    projects: r.project_name != null ? { name: r.project_name } : null,
    profiles: r.user_email != null ? { email: r.user_email } : null,
  }
}

function isAdminOrCo(role: UserRole): boolean {
  return role === 'admin' || role === 'co'
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

async function write(sql: string, params?: unknown[]): Promise<DbWrite> {
  try {
    await query(sql, params)
    return { error: null }
  } catch (err) {
    return { error: errMsg(err) }
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
    if (!isAdminOrCo(actor.role)) return []
    const rows = await query<ProfileRow>(
      `select ${PROFILE_COLS} from public.profiles order by lower(email) limit 500`
    )
    return rows.map(mapProfile)
  },

  async createUser(actor, input) {
    if (actor.role !== 'admin') return { error: 'You do not have permission to perform this action.' }
    const passwordHash = await hashPassword(input.password)
    return write(
      `insert into public.profiles (email, name, department, title, role, is_active, password_hash)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [input.email, input.name, input.department, input.title, input.role, input.isActive, passwordHash]
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
      'select id, name, so_number, created_at from public.projects order by name'
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
    return write('delete from public.projects where id = $1', [id])
  },

  // --- timesheets ---

  async listTimesheets(actor, opts: TimesheetListOptions = {}) {
    const where = isAdminOrCo(actor.role) ? '' : 'where t.user_id = $1'
    const baseParams: unknown[] = isAdminOrCo(actor.role) ? [] : [actor.id]

    const countRows = await query<{ c: number }>(
      `select count(*)::int as c from public.timesheets t ${where}`,
      baseParams
    )
    const count = countRows[0]?.c ?? 0

    let sql = `select
        t.id, t.user_id, t.project_id, t.log_date, t.hours_worked, t.work_done, t.created_at,
        p.name as project_name, pr.email as user_email
      from public.timesheets t
      left join public.projects p on p.id = t.project_id
      left join public.profiles pr on pr.id = t.user_id
      ${where}
      order by t.log_date desc`

    const params = [...baseParams]
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
        t.id, t.user_id, t.project_id, t.log_date, t.hours_worked, t.work_done, t.created_at,
        p.name as project_name, pr.email as user_email
      from public.timesheets t
      left join public.projects p on p.id = t.project_id
      left join public.profiles pr on pr.id = t.user_id
      where t.${where}`,
      params
    )
    return rows[0] ? mapTimesheet(rows[0]) : null
  },

  async findTimesheetByUserDate(actor, userId, logDate) {
    if (!isAdminOrCo(actor.role) && userId !== actor.id) return null
    const rows = await query<TimesheetJoinedRow>(
      `select
        t.id, t.user_id, t.project_id, t.log_date, t.hours_worked, t.work_done, t.created_at,
        p.name as project_name, pr.email as user_email
      from public.timesheets t
      left join public.projects p on p.id = t.project_id
      left join public.profiles pr on pr.id = t.user_id
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
        t.id, t.user_id, t.project_id, t.log_date, t.hours_worked, t.work_done, t.created_at,
        p.name as project_name, pr.email as user_email
      from public.timesheets t
      left join public.projects p on p.id = t.project_id
      left join public.profiles pr on pr.id = t.user_id
      where t.user_id = $1
      order by t.log_date desc
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
      `insert into public.timesheets (user_id, project_id, log_date, hours_worked, work_done)
       values ($1, $2, $3, $4, $5)`,
      [targetId, input.projectId, input.logDate, input.hoursWorked, input.workDone]
    )
  },

  async updateTimesheet(actor, id, input: TimesheetInput) {
    if (actor.role === 'admin') {
      return write(
        `update public.timesheets
         set project_id = $1, log_date = $2, hours_worked = $3, work_done = $4
         where id = $5`,
        [input.projectId, input.logDate, input.hoursWorked, input.workDone, id]
      )
    }
    return write(
      `update public.timesheets
       set project_id = $1, log_date = $2, hours_worked = $3, work_done = $4
       where id = $5 and user_id = $6`,
      [input.projectId, input.logDate, input.hoursWorked, input.workDone, id, actor.id]
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

  // --- app settings ---

  async getBackfillWindow(_actor) {
    const rows = await query<{ backfill_window_days: number }>(
      'select backfill_window_days from public.app_settings where id = 1 limit 1'
    )
    const value = rows[0]?.backfill_window_days
    if (typeof value === 'number' && value >= 0) return value
    return 1
  },

  async setBackfillWindow(actor, days) {
    if (actor.role !== 'admin') return { error: 'You do not have permission to perform this action.' }
    return write(
      'update public.app_settings set backfill_window_days = $1, updated_at = now() where id = 1',
      [days]
    )
  },
}
