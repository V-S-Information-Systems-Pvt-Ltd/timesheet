// lib/data/client.ts
// Client-side data abstraction. Components call dataClient instead of a
// database client directly. This is the ONE backend-neutral HTTP facade: it
// never selects a database backend and never imports a database client for
// application data. Every operation goes through the cookie-authenticated
// compatibility routes (`/api/data/*`) or the versioned `/api/v1/timesheets`
// resource, so the Supabase/native choice stays entirely server-side.

'use client'

import { ApiClientError, createApiClient } from '@vsis/client'
import type { TimesheetEntry } from '@vsis/contracts'
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
  getTimesheets(q?: TimesheetQuery): Promise<TimesheetResult>
  getAllUsers(): Promise<{ data: User[] | null; error: string | null }>
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

/** Read a `{ data, error }`-style compatibility response, normalizing missing keys to null. */
async function read<T>(path: string): Promise<{ data: T | null; error: string | null }> {
  const { body } = await send<{ data?: T | null; error?: string | null } | null>(path)
  return { data: body?.data ?? null, error: body?.error ?? null }
}

/** Write a `{ error }`-style compatibility response, normalizing a missing key to null. */
async function write(path: string, init?: RequestInit): Promise<{ error: string | null }> {
  const { body } = await send<{ error?: string | null } | null>(path, init)
  return { error: body?.error ?? null }
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
  async getProjects() {
    return read<Project[]>('/api/data/projects')
  },

  async getTimesheets(q: TimesheetQuery = {}) {
    return getTimesheetsOverHttp(q)
  },

  async getAllUsers() {
    return read<User[]>('/api/data/profiles')
  },

  // The compatibility route always resolves the signed-in actor's profile, so
  // the optional id only preserves the previous call signature.
  async getProfile() {
    return read<User>('/api/data/profile')
  },

  async getBackfillWindow() {
    const { data } = await read<BackfillSettings>('/api/data/backfill-window')
    return { data }
  },

  async getActivityTypes() {
    return read<ActivityType[]>('/api/data/activity-types')
  },

  async getAllActivityTypes() {
    return read<ActivityType[]>('/api/data/activity-types?all=1')
  },

  async getLeaves(opts: LeafQuery = {}) {
    const params = new URLSearchParams()
    if (opts.userId) params.set('userId', opts.userId)
    if (opts.from) params.set('from', opts.from)
    if (opts.to) params.set('to', opts.to)
    const qs = params.toString()
    return read<LeaveEntry[]>(`/api/data/leaves${qs ? `?${qs}` : ''}`)
  },

  async insertLeaves(rows) {
    return write('/api/data/leaves', {
      method: 'POST',
      body: JSON.stringify({ rows }),
    })
  },

  async deleteLeave(id) {
    return write(`/api/data/leaves?id=${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
  },

  async getReminders() {
    return read<Reminder[]>('/api/data/reminders')
  },

  async insertReminder(input) {
    return write('/api/data/reminders', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  },

  async updateReminder(id, done) {
    return write('/api/data/reminders', {
      method: 'PATCH',
      body: JSON.stringify({ id, done }),
    })
  },

  async deleteReminder(id) {
    return write(`/api/data/reminders?id=${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
  },

  async getDueGlobalReminders() {
    return read<GlobalReminder[]>('/api/data/global-reminders')
  },

  async getGlobalReminders() {
    return read<GlobalReminder[]>('/api/data/global-reminders?all=1')
  },

  async getReportTotals(q: ReportQuery = {}) {
    const params = new URLSearchParams()
    if (q.project) params.set('project', q.project)
    if (q.from) params.set('from', q.from)
    if (q.to) params.set('to', q.to)
    if (q.groupBy) params.set('groupBy', q.groupBy)
    const qs = params.toString()
    return read<NonNullable<ReportTotalsResult['data']>>(`/api/data/reports${qs ? `?${qs}` : ''}`)
  },
}
