// app/types.ts
// Application-facing domain types. These are backend-agnostic: both the
// Supabase adapter and the native PostgreSQL adapter map their rows onto these
// shapes, so UI code never depends on a specific backend's generated types.

export type UserRole = 'admin' | 'pm' | 'co' | 'manager' | 'team_lead' | 'user'

export interface User {
  id: string
  email: string
  name: string
  department: string
  title: string
  role: UserRole
  is_active: boolean
  /** Reporting line: the id of this user's manager or team lead (null = top-level). */
  manager_id: string | null
  /** Per-user dashboard tile order/visibility (null = default layout). */
  dashboard_layout: DashboardLayout | null
  /** Per-admin panel tile order/visibility (null = default layout). */
  admin_layout: AdminDashboardLayout | null
  created_at: string
}

/** Dashboard tiles that can be enabled/disabled and reordered. */
export type TileId =
  | 'entry-form'
  | 'entries'
  | 'leave'
  | 'reminders'
  | 'global-reminders'
  | 'profile'
  | 'telegram'

export interface DashboardTileSetting {
  id: TileId
  enabled: boolean
}

export interface DashboardLayout {
  /** Ordered tile list; disabled tiles stay in place and are hidden. */
  tiles: DashboardTileSetting[]
}

/** Admin-panel tiles that can be enabled/disabled and reordered. */
export type AdminTileId =
  | 'settings'
  | 'user-whitelist'
  | 'add-user'
  | 'backfill'
  | 'activity-types'
  | 'global-reminders'
  | 'project-manager'
  | 'leave-admin'
  | 'report-export'
  | 'import'
  | 'backup'
  | 'super-admin'

export interface AdminDashboardLayout {
  tiles: { id: AdminTileId; enabled: boolean }[]
}

export interface BackupProject {
  name: string
  so_number: string | null
  telegram_no: number | null
}

export interface BackupActivityType {
  name: string
  is_active: boolean
  telegram_no: number | null
}

export interface BackupTimesheet {
  email: string
  log_date: string
  project: string
  activity_type: string | null
  hours_worked: number
  work_done: string
}

export interface BackupLeave {
  email: string
  leave_date: string
  reason: string
}

export interface BackupReminder {
  email: string
  message: string
  remind_at: string
  done: boolean
}

export interface BackupGlobalReminder {
  message: string
  remind_at: string
}

export interface BackupPayload {
  version: 1
  exportedAt: string
  projects: BackupProject[]
  activityTypes: BackupActivityType[]
  timesheets: BackupTimesheet[]
  leaves: BackupLeave[]
  reminders: BackupReminder[]
  globalReminders: BackupGlobalReminder[]
}

/** Counts of what a restore actually created, keyed by entity. */
export interface BackupCreatedCounts {
  projects: number
  activityTypes: number
  timesheets: number
  leaves: number
  reminders: number
  globalReminders: number
}

export interface BackupExportResult {
  payload: BackupPayload | null
  error: string | null
}

export interface BackupRestoreResult {
  created: BackupCreatedCounts
  skipped: number
  error: string | null
}

export interface Project {
  id: string
  name: string
  so_number: string | null
  /** Numeric project code used by the Telegram bot (e.g. Support -> 94). */
  telegram_no: number | null
  created_at: string
}

export interface ActivityType {
  id: string
  name: string
  is_active: boolean
  /** Numeric code used by the Telegram bot when the project has none. */
  telegram_no: number | null
  created_at: string
}

/** Base timesheet row (no joins). */
export interface TimesheetRow {
  id: string
  user_id: string
  project_id: string
  activity_type_id: string | null
  log_date: string
  hours_worked: number
  work_done: string
  created_at: string
}

export interface OptimisticTimesheet extends Omit<TimesheetRow, 'id'> {
  tempId: string
}

/** Timesheet row plus the embedded project/user/type fields used across the UI. */
export interface Timesheet extends TimesheetRow {
  projects?: Pick<Project, 'name'> | null
  profiles?: Pick<User, 'email'> | null
  activity_types?: Pick<ActivityType, 'name'> | null
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

export interface GlobalReminder {
  id: string
  message: string
  remind_at: string
  created_at: string
}

export interface AppSettings {
  id: number
  backfill_window_days: number
  updated_at: string
}

export interface WhitelistedDomain {
  id: string
  domain: string
  auto_activate: boolean
  created_at: string
}

