// app/types.ts
// Application-facing domain types. These are independent of the
// persistence layer: the native PostgreSQL adapters map their rows onto these
// shapes, so UI code never depends on query-result types.

import type { MobileLayout } from '@vsis/contracts'

export type { MobileLayout, MobileModuleId, MobileModuleSetting, WorkspaceBranding } from '@vsis/contracts'
export type { EntryType, ActivityCode } from '@vsis/contracts'
import type { EntryType, ActivityCode } from '@vsis/contracts'

export type UserRole = 'admin' | 'pm' | 'co' | 'manager' | 'team_lead' | 'user'

/** Authorization axis: what a user is allowed to do. */
export type PermissionRole = 'admin' | 'pm' | 'co' | 'user'

/** Reporting/hierarchy axis: where a user sits in the org tree. */
export type HierarchyRole = 'manager' | 'team_lead' | 'engineer' | 'user'

export interface User {
  id: string
  email: string
  name: string
  department: string
  title: string
  role: UserRole
  /** Authorization role (see types.roles). */
  permission_role: PermissionRole
  /** Reporting position (see types.roles). */
  hierarchy_role: HierarchyRole
  is_active: boolean
  /** Reporting line: the id of this user's manager or team lead (null = top-level). */
  manager_id: string | null
  /** Per-user dashboard tile order/visibility (null = default layout). */
  dashboard_layout: DashboardLayout | null
  /** Per-admin panel tile order/visibility (null = default layout). */
  admin_layout: AdminDashboardLayout | null
  /** Per-user mobile module order/visibility (null = default layout). */
  mobile_layout: MobileLayout | null
  /** Test accounts are visible only to the super admin. */
  is_test_user?: boolean
  /** Admin/CO department limit; null or absent means unrestricted. */
  scope_departments?: string[] | null
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

export interface DashboardTileSetting {
  id: TileId
  enabled: boolean
}

export interface DashboardLayout {
  /** Ordered tile list; disabled tiles stay in place and are hidden. */
  tiles: DashboardTileSetting[]
  /** Team/Reports menu items (nav keys such as 'reports:compare') hidden from the sidebar. */
  hidden?: string[]
}

/** Admin-panel tiles that can be enabled/disabled and reordered. */
export type AdminTileId =
  | 'settings'
  | 'user-whitelist'
  | 'hierarchy'
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
  | 'departments'

export interface AdminDashboardLayout {
  tiles: { id: AdminTileId; enabled: boolean }[]
}

export interface BackupProject {
  name: string
  so_number: string | null
  /** Required in version 2; inferred only for explicit version 1 imports. */
  is_timesheet_project?: boolean
}

export interface BackupActivityType {
  name: string
  is_active: boolean
  /** Catalogue activities (Project/Support/Internal); absent on legacy types. */
  entry_type?: EntryType | null
  code?: string | null
}

export interface BackupTimesheet {
  email: string
  log_date: string
  project: string | null
  activity_type: string | null
  entry_type?: EntryType | null
  activity_code?: ActivityCode | null
  activity_other?: string | null
  ticket_number?: string | null
  customer?: string | null
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
  display_as_banner?: boolean
}

export interface BackupPayload {
  version: 1 | 2
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
  /** Eligible for the new-format Project picker. The reserved reference rows
   * (Internal, Internal IT, Support) are false; real projects default true.
   * Absent means eligible (older caches predate the flag). */
  is_timesheet_project?: boolean
  created_at: string
}

export interface ActivityType {
  id: string
  name: string
  is_active: boolean
  created_at: string
  /** Catalogue rows (Project/Support/Internal activities); null for legacy types. */
  entry_type?: EntryType | null
  code?: string | null
}

/** Base timesheet row (no joins). */
export interface TimesheetRow {
  id: string
  user_id: string
  /** Null for new-format Support/Internal entries. */
  project_id: string | null
  activity_type_id: string | null
  /** Classification v2. Null/absent identifies a historical-format row. */
  entry_type?: EntryType | null
  activity_code?: ActivityCode | null
  activity_other?: string | null
  ticket_number?: string | null
  customer?: string | null
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
  profiles?: { email: string; name?: string | null } | null
  activity_types?: Pick<ActivityType, 'name'> | null
  /** Catalogue display name of a new-format activity. */
  activity_label?: string | null
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
  display_as_banner?: boolean
}

export interface WhitelistedDomain {
  id: string
  domain: string
  auto_activate: boolean
  created_at: string
}

export interface Department {
  id: string
  name: string
  member_count: number
  created_at: string
}

export interface TitleRecord {
  id: string
  name: string
  hierarchy_role: HierarchyRole
  created_at: string
}

