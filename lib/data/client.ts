// lib/data/client.ts
// Client-side data abstraction. Components call dataClient instead of a
// database client directly. This is the ONE backend-neutral HTTP facade: it
// never selects a database backend and never imports a database client for
// application data. Every operation goes through the cookie-authenticated
// compatibility routes (`/api/data/*`) or versioned `/api/v1/*` resources, so
// the Supabase/native choice stays entirely server-side.

'use client'

import { ApiClientError, createApiClient } from '@vsis/client'
import type { ActivityTypeDto, PersonProfileDto, ProjectDto, TimesheetEntry } from '@vsis/contracts'
import type { BatchUpdateTimesheetItem, BatchUpdateTimesheetsResponse } from '@vsis/contracts'
import type { BrowserCreateUserInput, BrowserUserMutation } from '@vsis/contracts'
import type { ActivityType, GlobalReminder, LeaveEntry, Project, Reminder, Timesheet, User } from '@/app/types'
import type { BackfillSettings } from '@/lib/validation'

export interface TimesheetQuery {
  from?: number
  to?: number
  limit?: number
  userId?: string
  dateFrom?: string
  dateTo?: string
}

export interface TimesheetResult {
  data: Timesheet[] | null
  count: number | null
  error: string | null
}

export interface TimesheetMutationInput {
  projectId: string
  activityTypeId: string
  hoursWorked: number
  workDone: string
  logDate: string
}

export interface MutationResult {
  error: string | null
  fieldErrors?: Record<string, string[]>
  code?: string
}

export interface LeafQuery {
  userId?: string
  from?: string
  to?: string
}

export interface ReportGroupTotal {
  label: string
  hours: number
  entries: number
}

export interface ReportQuery {
  project?: string
  from?: string
  to?: string
  groupBy?: 'user' | 'project' | 'activity'
}

export interface ReportTotalsResult {
  data: {
    totalHours: number
    totalEntries: number
    byGroup: ReportGroupTotal[]
  } | null
  error: string | null
}

export interface DataClient {
  getProjects(): Promise<{ data: Project[] | null; error: string | null }>
  addProject(name: string): Promise<MutationResult>
  renameProject(id: string, name: string): Promise<MutationResult>
  setProjectSO(id: string, soNumber: string): Promise<MutationResult>
  setProjectTelegramNo(id: string, telegramNo: number | null): Promise<MutationResult>
  deleteProject(id: string): Promise<MutationResult>
  getTimesheets(q?: TimesheetQuery): Promise<TimesheetResult>
  createTimesheet(input: TimesheetMutationInput): Promise<MutationResult>
  logYesterday(input: Omit<TimesheetMutationInput, 'logDate'> & { userId?: string }): Promise<MutationResult>
  updateTimesheet(id: string, input: TimesheetMutationInput): Promise<MutationResult>
  deleteTimesheet(id: string): Promise<MutationResult>
  deleteLastTimesheet(): Promise<MutationResult>
  duplicateTimesheet(id: string): Promise<MutationResult>
  bulkUpdateTimesheets(entries: BatchUpdateTimesheetItem[]): Promise<MutationResult & Partial<BatchUpdateTimesheetsResponse>>
  getAllUsers(): Promise<{ data: User[] | null; error: string | null }>
  addUser(input: BrowserCreateUserInput): Promise<MutationResult>
  toggleUserStatus(id: string): Promise<MutationResult>
  updateUserRoles(id: string, permissionRole: User['permission_role'], hierarchyRole: User['hierarchy_role']): Promise<MutationResult>
  updateUserName(id: string, name: string): Promise<MutationResult>
  updateUserDepartment(id: string, department: string): Promise<MutationResult>
  setUserManager(id: string, managerId: string | null): Promise<MutationResult>
  updateUserHierarchy(id: string, data: { managerId: string | null; title?: string; hierarchyRole?: User['hierarchy_role'] }): Promise<MutationResult>
  getProfile(userId?: string): Promise<{ data: User | null; error: string | null }>
  getBackfillWindow(): Promise<{ data: BackfillSettings | null }>
  getActivityTypes(): Promise<{ data: ActivityType[] | null; error: string | null }>
  getAllActivityTypes(): Promise<{ data: ActivityType[] | null; error: string | null }>
  getLeaves(opts?: LeafQuery): Promise<{ data: LeaveEntry[] | null; error: string | null }>
  insertLeaves(rows: Array<{ userId: string; leaveDate: string; reason: string }>): Promise<{ error: string | null }>
  deleteLeave(id: string): Promise<{ error: string | null }>
  getReminders(userId?: string): Promise<{ data: Reminder[] | null; error: string | null }>
  insertReminder(input: { userId: string; message: string; remindAt: string }): Promise<{ error: string | null }>
  updateReminder(id: string, done: boolean): Promise<{ error: string | null }>
  deleteReminder(id: string): Promise<{ error: string | null }>
  getDueGlobalReminders(): Promise<{ data: GlobalReminder[] | null; error: string | null }>
  getGlobalReminders(): Promise<{ data: GlobalReminder[] | null; error: string | null }>
  getReportTotals(q?: ReportQuery): Promise<ReportTotalsResult>
}

// --- shared HTTP transport -------------------------------------------------------
// One client for the whole facade. `getAuth` returns null because browser
// requests authenticate with the same-origin session cookie; no backend is
// selected here.

const api = createApiClient({
  baseUrl:
    typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : 'http://localhost',
  getAuth: () => null,
})

// In-flight dedupe cache (single-flight). While a given request is in flight,
// concurrent identical calls share the same promise instead of firing duplicate
// fetches. Entries are removed once settled, so results never go stale: the
// next distinct call always re-fetches. Keyed by method + path + body.
const inFlightRequests = new Map<string, Promise<unknown>>()

function withSingleFlight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inFlightRequests.get(key) as Promise<T> | undefined
  if (existing) return existing
  const run = fn().finally(() => inFlightRequests.delete(key))
  inFlightRequests.set(key, run)
  return run
}

function transportKey(path: string, init?: RequestInit): string {
  return `${init?.method ?? 'GET'}:${path}:${init?.body ?? ''}`
}

/**
 * Send one request through the shared transport with single-flight dedupe and
 * same-origin credentials, returning the raw parsed body. The compatibility
 * routes answer a bare body (`{ data }`, `{ error }`, `{ data, count }`), which
 * the callers below map to the established `DataClient` shapes.
 */
function send<T>(path: string, init?: RequestInit): Promise<{ status: number; ok: boolean; body: T }> {
  return withSingleFlight(transportKey(path, init), () =>
    api.send<T>(path, { credentials: 'same-origin', ...init })
  )
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function errorMessageFromBody(body: unknown): string | null {
  const record = asRecord(body)
  const error = record?.error
  if (typeof error === 'string' && error.trim()) return error
  const errorRecord = asRecord(error)
  if (errorRecord && typeof errorRecord.message === 'string') {
    if (errorRecord.message.trim()) return errorRecord.message
  }
  return null
}

function transportError(status: number, body: unknown): string {
  return errorMessageFromBody(body) ?? `Request failed with status ${status}.`
}

function mutationFieldErrors(body: unknown): Record<string, string[]> | undefined {
  const error = asRecord(asRecord(body)?.error)
  const raw = asRecord(error?.fieldErrors)
  if (!raw) return undefined

  const fields: Record<string, string[]> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
      fields[key] = value as string[]
    }
  }
  return Object.keys(fields).length > 0 ? fields : undefined
}

function mutationCode(body: unknown): string | undefined {
  const error = asRecord(asRecord(body)?.error)
  return typeof error?.code === 'string' ? error.code : undefined
}

const INVALID_RESPONSE_ERROR = 'The server returned an invalid response.'

/** Read a `{ data, error }`-style compatibility response with status/payload validation. */
async function read<T>(path: string): Promise<{ data: T | null; error: string | null }> {
  const response = await send<unknown>(path)
  if (!response.ok) return { data: null, error: transportError(response.status, response.body) }

  const body = asRecord(response.body)
  if (!body || !Object.prototype.hasOwnProperty.call(body, 'data')) {
    return { data: null, error: INVALID_RESPONSE_ERROR }
  }

  const error = body.error
  if (error !== undefined && error !== null && typeof error !== 'string') {
    return { data: null, error: INVALID_RESPONSE_ERROR }
  }
  return { data: (body.data ?? null) as T | null, error: typeof error === 'string' ? error : null }
}

/** Write a `{ error }`-style compatibility response with status/payload validation. */
async function write(path: string, init?: RequestInit): Promise<{ error: string | null }> {
  const response = await send<unknown>(path, init)
  if (!response.ok) return { error: transportError(response.status, response.body) }

  const body = asRecord(response.body)
  if (!body || !Object.prototype.hasOwnProperty.call(body, 'error')) {
    return { error: INVALID_RESPONSE_ERROR }
  }

  const error = body.error
  if (error !== undefined && error !== null && typeof error !== 'string') {
    return { error: INVALID_RESPONSE_ERROR }
  }
  return { error: typeof error === 'string' ? error : null }
}

// --- browser timesheet access (backend-neutral) ----------------------------------
// Both backends read timesheets through the versioned HTTP resource under the
// browser cookie session: no runtime backend selection, no direct database
// client. The flat wire DTO is mapped back to the row shape the UI consumes.

function toTimesheetRow(dto: TimesheetEntry): Timesheet {
  return {
    id: dto.id,
    user_id: dto.user_id,
    project_id: dto.project_id,
    activity_type_id: dto.activity_type_id,
    log_date: dto.log_date,
    hours_worked: Number(dto.hours_worked),
    work_done: dto.work_done,
    created_at: dto.created_at,
    projects: dto.project_name ? { name: dto.project_name } : null,
    profiles: dto.user_email ? { email: dto.user_email } : null,
    activity_types: dto.activity_name ? { name: dto.activity_name } : null,
  }
}

async function mutation(path: string, init?: RequestInit): Promise<MutationResult> {
  // Separate submissions remain separate writes, as with the Server Actions.
  // Browser mutations have no persisted retry queue or stable delivery key.
  const response = await api.send<unknown>(path, { credentials: 'same-origin', ...init })
  if (!response.ok) {
    return {
      error: transportError(response.status, response.body),
      fieldErrors: mutationFieldErrors(response.body),
      code: mutationCode(response.body),
    }
  }

  const body = asRecord(response.body)
  if (!body || !Object.prototype.hasOwnProperty.call(body, 'error') || body.error !== null) {
    return { error: INVALID_RESPONSE_ERROR }
  }
  return { error: null }
}

function userMutation(id: string, input: BrowserUserMutation): Promise<MutationResult> {
  return mutation(`/api/v1/admin/users/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) })
}

function toBrowserUser(dto: PersonProfileDto): User {
  return {
    id: dto.id,
    email: dto.email,
    name: dto.name,
    department: dto.department ?? '',
    title: dto.title ?? '',
    role: dto.role as User['role'],
    permission_role: dto.permissionRole as User['permission_role'],
    hierarchy_role: dto.hierarchyRole as User['hierarchy_role'],
    is_active: dto.isActive,
    manager_id: dto.managerId ?? null,
    dashboard_layout: dto.dashboardLayout as User['dashboard_layout'],
    admin_layout: dto.adminLayout as User['admin_layout'],
    mobile_layout: dto.mobileLayout as User['mobile_layout'],
    created_at: dto.createdAt,
  }
}

async function getTimesheetsOverHttp(q: TimesheetQuery = {}): Promise<TimesheetResult> {
  const params = new URLSearchParams()
  if (q.from !== undefined) params.set('from', String(q.from))
  if (q.to !== undefined) params.set('to', String(q.to))
  if (q.limit !== undefined) params.set('limit', String(q.limit))
  if (q.userId) params.set('userId', q.userId)
  if (q.dateFrom) params.set('dateFrom', q.dateFrom)
  if (q.dateTo) params.set('dateTo', q.dateTo)
  const qs = params.toString()
  const path = `/api/v1/timesheets${qs ? `?${qs}` : ''}`

  return withSingleFlight(`GET:${path}`, async () => {
    try {
      const payload = api.unwrap(
        await api.request<{ rows: TimesheetEntry[]; count: number }>(path),
        200
      )
      return {
        data: payload.rows.map(toTimesheetRow),
        count: payload.count ?? null,
        error: null,
      }
    } catch (err) {
      return {
        data: null,
        count: null,
        error: err instanceof ApiClientError ? err.message : 'Failed to fetch timesheets',
      }
    }
  })
}

export const dataClient: DataClient = {
  async addUser(input) {
    return mutation('/api/v1/admin/users', { method: 'POST', body: JSON.stringify(input) })
  },
  async toggleUserStatus(id) { return userMutation(id, { operation: 'toggle-status' }) },
  async updateUserRoles(id, permissionRole, hierarchyRole) {
    return userMutation(id, { operation: 'roles', permissionRole, hierarchyRole })
  },
  async updateUserName(id, name) { return userMutation(id, { operation: 'name', name }) },
  async updateUserDepartment(id, department) { return userMutation(id, { operation: 'department', department }) },
  async setUserManager(id, managerId) { return userMutation(id, { operation: 'manager', managerId }) },
  async updateUserHierarchy(id, data) { return userMutation(id, { ...data, operation: 'hierarchy' }) },
  async getProjects() {
    const result = await read<{ projects: ProjectDto[] }>('/api/v1/reference')
    if (!result.data) return { data: null, error: result.error }
    return {
      data: result.data.projects.map((project) => ({
        id: project.id,
        name: project.name,
        so_number: project.so_number ?? null,
        telegram_no: project.telegram_no ?? null,
        created_at: project.created_at,
      })),
      error: null,
    }
  },

  async getTimesheets(q: TimesheetQuery = {}) {
    return getTimesheetsOverHttp(q)
  },

  async addProject(name) {
    return mutation('/api/v1/admin/projects', { method: 'POST', body: JSON.stringify({ name }) })
  },

  async renameProject(id, name) {
    return mutation(`/api/v1/admin/projects/${encodeURIComponent(id)}`, {
      method: 'PATCH', body: JSON.stringify({ name }),
    })
  },

  async setProjectSO(id, soNumber) {
    return mutation(`/api/v1/admin/projects/${encodeURIComponent(id)}`, {
      method: 'PATCH', body: JSON.stringify({ soNumber }),
    })
  },

  async setProjectTelegramNo(id, telegramNo) {
    return mutation(`/api/v1/admin/projects/${encodeURIComponent(id)}`, {
      method: 'PATCH', body: JSON.stringify({ telegramNo }),
    })
  },

  async deleteProject(id) {
    return mutation(`/api/v1/admin/projects/${encodeURIComponent(id)}`, { method: 'DELETE' })
  },

  async createTimesheet(input) {
    return mutation('/api/v1/timesheets', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  },

  async bulkUpdateTimesheets(entries) {
    const response = await api.send<unknown>('/api/v1/timesheets/batch-update', {
      method: 'POST',
      credentials: 'same-origin',
      body: JSON.stringify({ entries }),
    })
    if (!response.ok) return { error: transportError(response.status, response.body) }
    const body = asRecord(response.body)
    const data = asRecord(body?.data)
    const errors = data?.errors
    if (body?.error !== null || !data || typeof data.updated !== 'number' ||
      !Number.isInteger(data.updated) || data.updated < 0 ||
      (errors !== undefined && (!Array.isArray(errors) || !errors.every((error) => typeof error === 'string')))) {
      return { error: INVALID_RESPONSE_ERROR }
    }
    const rowErrors = errors as string[] | undefined
    return {
      error: data.updated === 0 && rowErrors?.length ? 'All edits failed.' : null,
      updated: data.updated,
      errors: rowErrors?.length ? rowErrors : undefined,
    }
  },

  async logYesterday(input) {
    return mutation('/api/v1/timesheets/yesterday', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  },

  async updateTimesheet(id, input) {
    const result = await mutation(`/api/v1/timesheets/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    })
    if (result.code === 'NOT_FOUND') return { ...result, error: 'Entry not found.' }
    if (result.code === 'FORBIDDEN') return { ...result, error: 'You can only modify your own entries.' }
    return result
  },

  async deleteTimesheet(id) {
    const result = await mutation(`/api/v1/timesheets/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
    if (result.code === 'NOT_FOUND') return { ...result, error: 'Entry not found.' }
    return result
  },

  async deleteLastTimesheet() {
    return mutation('/api/v1/timesheets/last', {
      method: 'DELETE',
    })
  },

  async duplicateTimesheet(id) {
    const result = await mutation(`/api/v1/timesheets/${encodeURIComponent(id)}/duplicate`, {
      method: 'POST',
      body: JSON.stringify({}),
    })
    if (result.code === 'NOT_FOUND') return { ...result, error: 'Entry not found.' }
    return result
  },

  async getAllUsers() {
    const result = await read<PersonProfileDto[]>('/api/v1/people')
    if (!result.data) return { data: null, error: result.error }
    return { data: result.data.map(toBrowserUser), error: null }
  },

  // The compatibility route always resolves the signed-in actor's profile, so
  // the optional id only preserves the previous call signature.
  async getProfile() {
    return read<User>('/api/v1/profile')
  },

  async getBackfillWindow() {
    const { data } = await read<BackfillSettings>('/api/v1/settings/backfill')
    return { data }
  },

  async getActivityTypes() {
    const result = await read<{ activityTypes: ActivityTypeDto[] }>('/api/v1/reference')
    if (!result.data) return { data: null, error: result.error }
    return {
      data: result.data.activityTypes.map((activityType) => ({
        id: activityType.id,
        name: activityType.name,
        is_active: activityType.is_active ?? true,
        telegram_no: activityType.telegram_no ?? null,
        created_at: activityType.created_at,
      })),
      error: null,
    }
  },

  async getAllActivityTypes() {
    const result = await read<{ activityTypes: ActivityTypeDto[] }>('/api/v1/reference?all=1')
    if (!result.data) return { data: null, error: result.error }
    return {
      data: result.data.activityTypes.map((activityType) => ({
        id: activityType.id,
        name: activityType.name,
        is_active: activityType.is_active ?? true,
        telegram_no: activityType.telegram_no ?? null,
        created_at: activityType.created_at,
      })),
      error: null,
    }
  },

  async getLeaves(opts: LeafQuery = {}) {
    const params = new URLSearchParams()
    if (opts.userId) params.set('userId', opts.userId)
    if (opts.from) params.set('from', opts.from)
    if (opts.to) params.set('to', opts.to)
    const qs = params.toString()
    return read<LeaveEntry[]>(`/api/v1/leaves${qs ? `?${qs}` : ''}`)
  },

  async insertLeaves(rows) {
    return write('/api/v1/leaves', {
      method: 'POST',
      body: JSON.stringify({ rows }),
    })
  },

  async deleteLeave(id) {
    return write(`/api/v1/leaves/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
  },

  async getReminders() {
    return read<Reminder[]>('/api/v1/reminders')
  },

  async insertReminder(input) {
    return write('/api/v1/reminders', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  },

  async updateReminder(id, done) {
    return write(`/api/v1/reminders/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ done }),
    })
  },

  async deleteReminder(id) {
    return write(`/api/v1/reminders/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
  },

  async getDueGlobalReminders() {
    return read<GlobalReminder[]>('/api/v1/reminders/global')
  },

  async getGlobalReminders() {
    return read<GlobalReminder[]>('/api/v1/reminders/global?all=1')
  },

  async getReportTotals(q: ReportQuery = {}) {
    const params = new URLSearchParams()
    if (q.project) params.set('project', q.project)
    if (q.from) params.set('from', q.from)
    if (q.to) params.set('to', q.to)
    if (q.groupBy) params.set('groupBy', q.groupBy)
    const qs = params.toString()
    return read<NonNullable<ReportTotalsResult['data']>>(`/api/v1/reports${qs ? `?${qs}` : ''}`)
  },
}
