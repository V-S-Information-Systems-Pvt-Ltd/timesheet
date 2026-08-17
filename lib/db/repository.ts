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
  DashboardLayout,
  GlobalReminder,
  LeaveEntry,
  Project,
  Reminder,
  Timesheet,
  TimesheetRow,
  User,
  UserRole,
} from '@/app/types'
import type { BackfillSettings } from '@/lib/validation'

export interface Actor {
  id: string
  email: string
  role: UserRole
  isActive: boolean
}

export interface DbWrite {
  error: string | null
}

export interface DbResult<T> {
  data: T | null
  error: string | null
}

/** Reusable role gate used by server actions and route handlers. */
export function requireRole(
  actor: Actor | null,
  allowed: UserRole[]
): { ok: true; actor: Actor } | { ok: false; error: string } {
  if (!actor) return { ok: false, error: 'You must be signed in.' }
  if (!allowed.includes(actor.role)) {
    return { ok: false, error: 'You do not have permission to perform this action.' }
  }
  return { ok: true, actor }
}

export interface CreateUserInput {
  email: string
  password: string
  name: string
  department: string
  title: string
  role: UserRole
  isActive: boolean
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

export interface Repository {
  // --- profiles ---
  getProfileById(id: string): Promise<User | null>
  getProfileByEmail(email: string): Promise<User | null>
  /** All profiles (admin/co); non-management callers must not use this. */
  listProfiles(actor: Actor): Promise<User[]>
  /** Admin provisioning: create auth credentials + profile. */
  createUser(actor: Actor, input: CreateUserInput): Promise<DbWrite>
  updateUserStatus(actor: Actor, userId: string, isActive: boolean): Promise<DbWrite>
  updateUserRole(actor: Actor, userId: string, role: UserRole): Promise<DbWrite>
  /** User edits their own department/title. */
  updateMyProfile(actor: Actor, input: { department: string; title: string }): Promise<DbWrite>
  /** Admin-only: change a user's full name. */
  updateUserName(actor: Actor, userId: string, name: string): Promise<DbWrite>

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

  // --- dashboard layout (own profile) ---
  /** Saves the calling user's dashboard tile layout (their own row). */
  setDashboardLayout(actor: Actor, layout: DashboardLayout): Promise<DbWrite>

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
  /** Inserts timesheet rows, skipping (user_id, log_date) duplicates. */
  importTimesheets(actor: Actor, rows: TimesheetInput[]): Promise<ImportResult>
}
