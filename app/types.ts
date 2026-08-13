// app/types.ts
// Application-facing domain types. These are backend-agnostic: both the
// Supabase adapter and the native PostgreSQL adapter map their rows onto these
// shapes, so UI code never depends on a specific backend's generated types.

export type UserRole = 'admin' | 'pm' | 'co' | 'user'

export interface User {
  id: string
  email: string
  name: string
  department: string
  title: string
  role: UserRole
  is_active: boolean
  created_at: string
}

export interface Project {
  id: string
  name: string
  so_number: string | null
  created_at: string
}

/** Base timesheet row (no joins). */
export interface TimesheetRow {
  id: string
  user_id: string
  project_id: string
  log_date: string
  hours_worked: number
  work_done: string
  created_at: string
}

/** Timesheet row plus the embedded project/user fields used across the UI. */
export interface Timesheet extends TimesheetRow {
  projects?: Pick<Project, 'name'> | null
  profiles?: Pick<User, 'email'> | null
}

export interface LeaveEntry {
  id: string
  user_id: string
  leave_date: string
  reason: string
  created_at: string
}

export interface Reminder {
  id: string
  user_id: string
  message: string
  remind_at: string
  done: boolean
  created_at: string
}

export interface AppSettings {
  id: number
  backfill_window_days: number
  updated_at: string
}
