// Shared persistence types and authorization guards.
//
// Provider adapters and domain ports depend on these contracts directly. This
// module intentionally contains no aggregate repository interface or backend
// selection.

import type {
  AdminDashboardLayout,
  ActivityCode,
  DashboardLayout,
  EntryType,
  HierarchyRole,
  MobileLayout,
  PermissionRole,
  Timesheet,
  UserRole,
} from '@/app/types'

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
  /** Present on row-returning writes (e.g. createTimesheet RETURNING id). */
  id?: string
}

export interface DbResult<T> {
  data: T | null
  error: string | null
}

export type DbCreateResult<T> =
  | { data: T; error: null }
  | { data: null; error: string }

export interface CreateProjectOptions {
  soNumber?: string | null
  telegramNo?: number | null
}

export interface CreateActivityTypeOptions {
  telegramNo?: number | null
}

/**
 * One unit of a shared rate-limit window.
 *
 * `subjectHash` is already HMAC'd by lib/rate-limit-subject.ts — adapters must
 * never receive or store a raw email, IP, or user id here. Window boundaries are
 * supplied by the caller rather than computed in SQL, so the limiter is
 * deterministic under test and the two adapters cannot drift on clock source.
 */
export interface RateLimitReserveInput {
  bucket: string
  subjectHash: string
  windowStart: Date
  resetAt: Date
  limit: number
}

export interface RateLimitReleaseInput {
  bucket: string
  subjectHash: string
  windowStart: Date
}

export interface RateLimitReserveResult {
  /** False when the window is already at its limit. */
  reserved: boolean
  /** Count after the attempt; equals the limit when `reserved` is false. */
  count: number
}

/**
 * Global default panel order (user dashboard + admin panel + mobile modules).
 * mobile semantics:
 * - undefined: preserve the current database value
 * - null: clear the workspace override (returns registry default on read)
 * - MobileLayout: replace the workspace override
 */
export interface DefaultLayouts {
  dashboard: DashboardLayout
  admin: AdminDashboardLayout
  mobile?: MobileLayout | null
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

export interface UpdateUserInput {
  name?: string
  department?: string | null
  title?: string | null
  permissionRole?: PermissionRole
  hierarchyRole?: HierarchyRole
  managerId?: string | null
  isActive?: boolean
}

export interface TimesheetInput {
  userId: string
  /** Null for new-format Support/Internal entries. */
  projectId: string | null
  /** Nullable: imports may omit the activity type; the form always sets it. */
  activityTypeId: string | null
  /** Classification v2. Null entryType = legacy-format write. */
  entryType?: EntryType | null
  activityCode?: ActivityCode | null
  activityOther?: string | null
  ticketNumber?: string | null
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
  entryType?: EntryType | 'legacy'
  activityCode?: ActivityCode
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

/** A pre-validated bulk timesheet patch applied atomically by the persistence adapter. */
export interface BulkTimesheetUpdate {
  id: string
  /** Null for new-format Support/Internal entries. */
  projectId: string | null
  activityTypeId: string | null
  /** Classification v2. Null entryType = legacy-format patch. */
  entryType?: EntryType | null
  activityCode?: ActivityCode | null
  activityOther?: string | null
  ticketNumber?: string | null
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
  entryType?: EntryType | 'legacy'
  activityCode?: ActivityCode
  userId?: string
  from?: string
  to?: string
}

export interface ReportBucket {
  label: string
  hours: number
  entries: number
}
