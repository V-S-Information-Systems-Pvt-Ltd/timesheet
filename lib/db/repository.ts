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
  LeaveEntry,
  Project,
  Reminder,
  Timesheet,
  TimesheetRow,
  User,
  UserRole,
} from '@/app/types'

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

  // --- projects ---
  listProjects(actor: Actor): Promise<Project[]>
  createProject(actor: Actor, name: string): Promise<DbWrite>
  renameProject(actor: Actor, id: string, name: string): Promise<DbWrite>
  setProjectSO(actor: Actor, id: string, soNumber: string | null): Promise<DbWrite>
  /** Deletes a project; fails if any timesheet references it. */
  deleteProject(actor: Actor, id: string): Promise<DbWrite>

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

  // --- app settings ---
  getBackfillWindow(actor: Actor): Promise<number>
  setBackfillWindow(actor: Actor, days: number): Promise<DbWrite>
}
