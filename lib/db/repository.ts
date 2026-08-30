// lib/db/repository.ts
// Backend-agnostic data-access contract for the server side. The Supabase
// adapter (lib/db/supabase.ts) and the native PostgreSQL adapter
// (lib/db/native.ts) both implement this interface; app code and native route
// handlers talk to it instead of to a specific backend.
//
// Authorization: callers resolve the current actor with lib/auth (getActor)
// and pass it in. The native adapter enforces ownership/role in SQL; the
// Supabase adapter leans on Row Level Security and uses the actor only where
// application logic needs it.

import type {
  ActivityType,
  AdminDashboardLayout,
  BackupPayload,
  BackupRestoreResult,
  BackupExportResult,
  DashboardLayout,
  GlobalReminder,
  HierarchyRole,
  LeaveEntry,
  PermissionRole,
  Project,
  Reminder,
  Timesheet,
  TimesheetRow,
  User,
  UserRole,
  WhitelistedDomain,
} from '@/app/types'
import type { BackfillSettings } from '@/lib/validation'

export interface Actor {
  id: string
  email: string
  /** Legacy single role, kept in sync for the transition. */
  role: UserRole
  /** Authorization role. */
  permission_role: PermissionRole
  /** Reporting position. */
  hierarchy_role: HierarchyRole
  name?: string | null
  department?: string | null
  title?: string | null
  manager_id?: string | null
  isActive: boolean
}

export interface DbWrite {
  error: string | null
}

export interface DbResult<T> {
  data: T | null
  error: string | null
}

/** Global default panel order (user dashboard + admin panel). */
export interface DefaultLayouts {
  dashboard: DashboardLayout
  admin: AdminDashboardLayout
}

/** Reusable active-actor gate used by server actions and route handlers. */
export function requireActive(
  actor: Actor | null
): { ok: true; actor: Actor } | { ok: false; error: string } {
  if (!actor) return { ok: false, error: 'You must be signed in.' }
  if (!actor.isActive) return { ok: false, error: 'Your account is not active.' }
  return { ok: true, actor }
}

/** Reusable role gate used by server actions and route handlers (permission axis). */
export function requireRole(
  actor: Actor | null,
  allowed: PermissionRole[]
): { ok: true; actor: Actor } | { ok: false; error: string } {
  const activeGate = requireActive(actor)
  if (!activeGate.ok) return activeGate
  if (!allowed.includes(activeGate.actor.permission_role)) {
    return { ok: false, error: 'You do not have permission to perform this action.' }
  }
  return activeGate
}

export interface CreateUserInput {
  email: string
  password: string
  name: string
  department: string
  title: string
  /** Authorization role. */
  permissionRole: PermissionRole
  /** Reporting position. */
  hierarchyRole: HierarchyRole
  isActive: boolean
  /** Optional manager/team lead this user reports to. */
  managerId: string | null
}

export interface TimesheetInput {
  userId: string
  projectId: string
  /** Nullable: imports may omit the activity type; the form always sets it. */
  activityTypeId: string | null
  hoursWorked: number
  workDone: string
  logDate: string
}

export interface TimesheetListOptions {
  /** 0-based offset (like Supabase .range(from, to)). */
  from?: number
  /** Inclusive end offset. */
  to?: number
  /** Optional standalone row limit. */
  limit?: number
  /** Filter by specific user id (when caller has permission to view that user's entries). */
  userId?: string
  /** Filter by specific project id. */
  projectId?: string
  /** Inclusive earliest log_date (YYYY-MM-DD). */
  dateFrom?: string
  /** Inclusive latest log_date (YYYY-MM-DD). */
  dateTo?: string
  /** Whether to execute exact total count query (defaults to true for pagination compatibility). */
  includeCount?: boolean
}

export interface TimesheetListResult {
  rows: Timesheet[]
  count: number
}

export interface LeafRowInput {
  userId: string
  leaveDate: string
  reason: string
}

export interface ImportResult {
  imported: number
  skipped: number
  error: string | null
}

/** A pre-validated bulk timesheet patch applied atomically by the repository. */
export interface BulkTimesheetUpdate {
  id: string
  projectId: string
  activityTypeId: string | null
  hoursWorked: number
  workDone: string
  logDate: string
}

/** Per-row outcome for a bulk update (ownership/scope enforced in SQL). */
export interface BulkTimesheetUpdateResult {
  updated: number
  rowErrors: Array<{ id: string; error: string }>
  error: string | null
}

/** One grouped report bucket (project | user | activity). */
export interface ReportTotalsInput {
  projectId?: string
  from?: string
  to?: string
}

export interface ReportBucket {
  label: string
  hours: number
  entries: number
}

export interface Repository {
  // --- profiles ---
  getProfileById(id: string): Promise<User | null>
  getProfileByEmail(email: string): Promise<User | null>
  /** All profiles (admin/co); non-management callers must not use this. */
  listProfiles(actor: Actor): Promise<User[]>
  /** Admin provisioning: create auth credentials + profile. */
  createUser(actor: Actor, input: CreateUserInput): Promise<DbWrite>
  updateUserStatus(actor: Actor, userId: string, isActive: boolean): Promise<DbWrite>
  updateUserRoles(
    actor: Actor,
    userId: string,
    permissionRole: PermissionRole,
    hierarchyRole: HierarchyRole
  ): Promise<DbWrite>
  /** User edits their own department/title. */
  updateMyProfile(actor: Actor, input: { department: string; title: string }): Promise<DbWrite>
  /** Admin-only: change a user's full name. */
  updateUserName(actor: Actor, userId: string, name: string): Promise<DbWrite>
  /** Admin-only: set who a user reports to (null clears the reporting line). */
  updateUserManager(actor: Actor, userId: string, managerId: string | null): Promise<DbWrite>

  // --- projects ---
  listProjects(actor: Actor): Promise<Project[]>
  createProject(actor: Actor, name: string): Promise<DbWrite>
  renameProject(actor: Actor, id: string, name: string): Promise<DbWrite>
  setProjectSO(actor: Actor, id: string, soNumber: string | null): Promise<DbWrite>
  /** Admin/pm: set (or clear) the Telegram bot number for a project. */
  setProjectTelegramNo(actor: Actor, id: string, telegramNo: number | null): Promise<DbWrite>
  /** Deletes a project; fails if any timesheet references it. */
  deleteProject(actor: Actor, id: string): Promise<DbWrite>

  // --- activity types ---
  /** Active work categories (for the log-time form). */
  listActivityTypes(actor: Actor): Promise<ActivityType[]>
  /** All work categories, including inactive (admin management). */
  listAllActivityTypes(actor: Actor): Promise<ActivityType[]>
  createActivityType(actor: Actor, name: string): Promise<DbWrite>
  renameActivityType(actor: Actor, id: string, name: string): Promise<DbWrite>
  setActivityTypeActive(actor: Actor, id: string, isActive: boolean): Promise<DbWrite>
  /** Admin: set (or clear) the Telegram bot number for an activity type. */
  setActivityTypeTelegramNo(actor: Actor, id: string, telegramNo: number | null): Promise<DbWrite>

  // --- timesheets ---
  listTimesheets(actor: Actor, opts?: TimesheetListOptions): Promise<TimesheetListResult>
  getTimesheet(actor: Actor, id: string): Promise<TimesheetRow | null>
  findTimesheetByUserDate(actor: Actor, userId: string, logDate: string): Promise<TimesheetRow | null>
  getLatestTimesheet(actor: Actor, userId: string): Promise<TimesheetRow | null>
  createTimesheet(actor: Actor, input: TimesheetInput): Promise<DbWrite>
  updateTimesheet(actor: Actor, id: string, input: TimesheetInput): Promise<DbWrite>
  deleteTimesheet(actor: Actor, id: string): Promise<DbWrite>
  countTimesheetsByProject(actor: Actor, projectId: string): Promise<number>

  // --- leaves ---
  listLeaves(actor: Actor, opts?: { userId?: string; from?: string; to?: string }): Promise<LeaveEntry[]>
  createLeaves(actor: Actor, rows: LeafRowInput[]): Promise<DbWrite>
  deleteLeave(actor: Actor, id: string): Promise<DbWrite>

  // --- reminders ---
  listReminders(actor: Actor, userId: string): Promise<Reminder[]>
  createReminder(actor: Actor, input: { userId: string; message: string; remindAt: string }): Promise<DbWrite>
  updateReminder(actor: Actor, id: string, input: { done: boolean }): Promise<DbWrite>
  deleteReminder(actor: Actor, id: string): Promise<DbWrite>

  // --- global reminders ---
  /** Admin: all global reminders. */
  listGlobalReminders(actor: Actor): Promise<GlobalReminder[]>
  /** User: due global reminders not yet dismissed by them. */
  listDueGlobalReminders(actor: Actor): Promise<GlobalReminder[]>
  createGlobalReminder(actor: Actor, input: { message: string; remindAt: string }): Promise<DbWrite>
  deleteGlobalReminder(actor: Actor, id: string): Promise<DbWrite>
  dismissGlobalReminder(actor: Actor, reminderId: string): Promise<DbWrite>

  // --- app settings ---
  getBackfillWindow(actor: Actor): Promise<BackfillSettings>
  setBackfillWindow(actor: Actor, settings: BackfillSettings): Promise<DbWrite>
  /** Global default panel order (fallback for users without a saved layout). */
  getDefaultLayouts(actor: Actor): Promise<DbResult<DefaultLayouts>>
  /** Persist the global default panel order (super-admin gated at the action layer). */
  setDefaultLayouts(actor: Actor, layouts: DefaultLayouts): Promise<DbWrite>

  // --- dashboard layout (own profile) ---
  /** Saves the calling user's dashboard tile layout (their own row). */
  setDashboardLayout(actor: Actor, layout: DashboardLayout): Promise<DbWrite>
  /** Saves the calling user's admin-panel tile layout (their own row). */
  setAdminLayout(actor: Actor, layout: AdminDashboardLayout): Promise<DbWrite>

  // --- super-admin data lifecycle (callers gate via super-admin checks) ---
  /** Deletes a user's profile (cascading entries) and auth identity. */
  deleteUser(actor: Actor, userId: string): Promise<DbWrite>
  /** Deletes an activity type; timesheet references become null. */
  deleteActivityType(actor: Actor, id: string): Promise<DbWrite>
  /** Deletes all timesheet entries belonging to one user. */
  deleteUserTimesheets(actor: Actor, userId: string): Promise<DbWrite>
  /** Deletes all timesheet entries. */
  resetTimesheets(actor: Actor): Promise<DbWrite>
  /** Deletes timesheets, leaves, reminders, dismissals; re-seeds activity types. */
  resetActivityData(actor: Actor): Promise<DbWrite>
  /** Factory reset: clears all data (acting profile kept) and re-seeds defaults. */
  resetAllData(actor: Actor): Promise<DbWrite>
  /** Inserts timesheet rows as-is (callers validate totals before calling). */
  importTimesheets(actor: Actor, rows: TimesheetInput[]): Promise<ImportResult>

  /**
   * Applies a batch of pre-validated timesheet updates in one backend
   * round-trip, enforcing ownership/scope within the same transaction as each
   * individual update (Phase 4.4). The preceding per-row application logic
   * must already have run before the update is handed off.
   */
  bulkUpdateTimesheets(actor: Actor, rows: BulkTimesheetUpdate[]): Promise<BulkTimesheetUpdateResult>

  // --- backup & restore (admin) ---
  /** Exports all work data (projects, types, entries, leaves, reminders, settings). */
  exportBackup(actor: Actor): Promise<BackupExportResult>
  /** Merges a validated backup into the current data (skips duplicates + 24h cap). */
  restoreBackup(actor: Actor, payload: BackupPayload): Promise<BackupRestoreResult>

  // --- daily hour totals (multi-entry per day, capped at 24h) ---
  /** Total hours logged for a user on a date, optionally excluding one entry. */
  sumHoursForUserDate(
    actor: Actor,
    userId: string,
    logDate: string,
    excludeEntryId?: string
  ): Promise<number>
  /** All user/date hour totals (used by the import to validate the 24h cap). */
  getTimesheetDailyTotals(
    actor: Actor
  ): Promise<{ userId: string; logDate: string; hours: number }[]>

  /**
   * Grouped report totals with GROUP BY aggregation on the server (Phase 4.5),
   * instead of fetching every row and summing in JS. Scope is limited to the
   * calling actor's visible rows.
   */
  getGroupedReportTotals(
    actor: Actor,
    input: ReportTotalsInput,
    groupBy: 'user' | 'project' | 'activity'
  ): Promise<ReportBucket[]>

  // --- audit logging ---
  writeAuditLog(
    actor: Actor,
    input: {
      action: string
      targetId?: string | null
      detail?: Record<string, unknown> | null
    }
  ): Promise<DbWrite>

  // --- email domain whitelist (super-admin / registration) ---
  listWhitelistedDomains(actor?: Actor): Promise<WhitelistedDomain[]>
  addWhitelistedDomain(actor: Actor, domain: string, autoActivate: boolean): Promise<DbWrite>
  updateWhitelistedDomain(actor: Actor, id: string, autoActivate: boolean): Promise<DbWrite>
  deleteWhitelistedDomain(actor: Actor, id: string): Promise<DbWrite>
  findWhitelistedDomain(domain: string): Promise<WhitelistedDomain | null>

  // --- hierarchy & reporting structure ---
  updateUserHierarchy(
    actor: Actor,
    userId: string,
    data: { managerId: string | null; title?: string; hierarchyRole?: HierarchyRole }
  ): Promise<DbWrite>

  // --- titles management (super-admin / global) ---
  listTitles(actor?: Actor): Promise<string[]>
  addTitle(actor: Actor, name: string): Promise<DbWrite>
  deleteTitle(actor: Actor, name: string): Promise<DbWrite>
}

