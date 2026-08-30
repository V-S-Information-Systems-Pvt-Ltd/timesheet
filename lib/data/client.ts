// lib/data/client.ts
// Client-side data abstraction. Components call dataClient instead of the
// Supabase browser client directly; the supabase implementation wraps
// supabase-js and the native implementation calls the /api/data route handlers
// (server-side authorization).

'use client'

import { IS_NATIVE } from '@/lib/backend/client'
import type { createClient as createClientFn } from '@/lib/supabase/client'
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

// --- supabase implementation -----------------------------------------------------

let supabase: ReturnType<typeof createClientFn> | null = null

/**
 * Lazily create the Supabase browser client.
 *
 * Deliberately NOT at module scope: `next build` evaluates module top-level
 * code even in the native backend, and creating the client without the
 * Supabase env vars crashes prerendering (see .github/workflows/ci.yml,
 * container-build). The client is only ever needed at runtime in the browser.
 */
async function getSupabase() {
  if (!supabase) {
    const { createClient } = await import('@/lib/supabase/client')
    supabase = createClient()
  }
  return supabase
}

const supabaseDataClient: DataClient = {
  async getProjects() {
    const sb = await getSupabase()
    const { data, error } = await sb.from('projects').select('*').order('name')
    return { data: (data as Project[] | null) ?? null, error: error ? error.message : null }
  },

  async getTimesheets(q: TimesheetQuery = {}) {
    const sb = await getSupabase()
    let query = sb
      .from('timesheets')
      .select('*, projects(name), profiles(email), activity_types(name)', { count: 'exact' })
      .order('log_date', { ascending: false })
    if (q.userId) query = query.eq('user_id', q.userId)
    if (q.dateFrom) query = query.gte('log_date', q.dateFrom)
    if (q.dateTo) query = query.lte('log_date', q.dateTo)
    if (q.from !== undefined || q.to !== undefined) {
      const from = q.from ?? 0
      const to = q.to ?? from + 999
      query = query.range(from, to)
    } else if (q.limit !== undefined) {
      query = query.limit(q.limit)
    }
    const { data, error, count } = await query
    return {
      data: (data as Timesheet[] | null) ?? null,
      count: count ?? null,
      error: error ? error.message : null,
    }
  },

  async getAllUsers() {
    const sb = await getSupabase()
    const { data, error } = await sb.from('profiles').select('*').limit(500)
    return { data: (data as User[] | null) ?? null, error: error ? error.message : null }
  },

  async getProfile(userId) {
    if (!userId) return { data: null, error: 'User id required.' }
    const sb = await getSupabase()
    const { data, error } = await sb.from('profiles').select('*').eq('id', userId).maybeSingle()
    return { data: (data as User | null) ?? null, error: error ? error.message : null }
  },

  async getBackfillWindow() {
    const sb = await getSupabase()
    const { data } = await sb
      .from('app_settings')
      .select('backfill_window_days, backfill_mode, backfill_extra_days')
      .eq('id', 1)
      .limit(1)
      .maybeSingle()
    return {
      data: {
        mode: data?.backfill_mode === 'month_start' ? 'month_start' : 'days',
        windowDays: typeof data?.backfill_window_days === 'number' ? data.backfill_window_days : 1,
        extraDays: typeof data?.backfill_extra_days === 'number' ? data.backfill_extra_days : 0,
      },
    }
  },

  async getActivityTypes() {
    const sb = await getSupabase()
    const { data, error } = await sb
      .from('activity_types')
      .select('*')
      .eq('is_active', true)
      .order('name')
    return { data: (data as ActivityType[] | null) ?? null, error: error ? error.message : null }
  },

  async getAllActivityTypes() {
    const sb = await getSupabase()
    const { data, error } = await sb.from('activity_types').select('*').order('name')
    return { data: (data as ActivityType[] | null) ?? null, error: error ? error.message : null }
  },

  async getLeaves(opts: LeafQuery = {}) {
    const sb = await getSupabase()
    let query = sb.from('leaves').select('*').order('leave_date', { ascending: true })
    if (opts.userId) query = query.eq('user_id', opts.userId)
    if (opts.from) query = query.gte('leave_date', opts.from)
    if (opts.to) query = query.lte('leave_date', opts.to)
    query = query.limit(1000)
    const { data, error } = await query
    return { data: (data as LeaveEntry[] | null) ?? null, error: error ? error.message : null }
  },

  async insertLeaves(rows) {
    const sb = await getSupabase()
    const { error } = await sb.from('leaves').insert(
      rows.map((r) => ({ user_id: r.userId, leave_date: r.leaveDate, reason: r.reason }))
    )
    return { error: error ? error.message : null }
  },

  async deleteLeave(id) {
    const sb = await getSupabase()
    const { error } = await sb.from('leaves').delete().eq('id', id)
    return { error: error ? error.message : null }
  },

  async getReminders(userId) {
    if (!userId) return { data: null, error: 'User id required.' }
    const sb = await getSupabase()
    const { data, error } = await sb
      .from('reminders')
      .select('*')
      .eq('user_id', userId)
      .order('remind_at', { ascending: true })
      .limit(50)
    return { data: (data as Reminder[] | null) ?? null, error: error ? error.message : null }
  },

  async insertReminder(input) {
    const sb = await getSupabase()
    const { error } = await sb.from('reminders').insert({
      user_id: input.userId,
      message: input.message,
      remind_at: input.remindAt,
    })
    return { error: error ? error.message : null }
  },

  async updateReminder(id, done) {
    const sb = await getSupabase()
    const { error } = await sb.from('reminders').update({ done }).eq('id', id)
    return { error: error ? error.message : null }
  },

  async deleteReminder(id) {
    const sb = await getSupabase()
    const { error } = await sb.from('reminders').delete().eq('id', id)
    return { error: error ? error.message : null }
  },

  async getDueGlobalReminders() {
    const now = new Date().toISOString()
    const sb = await getSupabase()
    const { data, error } = await sb
      .from('global_reminders')
      .select('*')
      .lte('remind_at', now)
      .order('remind_at', { ascending: true })
    if (error) return { data: null, error: error.message }
    if (!data || data.length === 0) return { data: [], error: null }

    const { data: dismissals, error: dErr } = await sb
      .from('global_reminder_dismissals')
      .select('reminder_id')
    if (dErr) return { data: null, error: dErr.message }
    const dismissed = new Set((dismissals ?? []).map((d) => d.reminder_id))

    return { data: (data as GlobalReminder[]).filter((r) => !dismissed.has(r.id)), error: null }
  },

  async getGlobalReminders() {
    const sb = await getSupabase()
    const { data, error } = await sb
      .from('global_reminders')
      .select('*')
      .order('remind_at', { ascending: true })
    return { data: (data as GlobalReminder[] | null) ?? null, error: error ? error.message : null }
  },

  async getReportTotals(q: ReportQuery = {}) {
    const params = new URLSearchParams()
    if (q.project) params.set('project', q.project)
    if (q.from) params.set('from', q.from)
    if (q.to) params.set('to', q.to)
    if (q.groupBy) params.set('groupBy', q.groupBy)
    const qs = params.toString()
    const res = await fetch(`/api/data/reports${qs ? `?${qs}` : ''}`, { credentials: 'same-origin' })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      return { data: null, error: err.error ?? 'Failed to fetch report totals' }
    }
    return (await res.json()) as ReportTotalsResult
  },
}

// --- native implementation -------------------------------------------------------

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

function apiKey(path: string, init?: RequestInit): string {
  return `${init?.method ?? 'GET'}:${path}:${init?.body ?? ''}`
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  return withSingleFlight(apiKey(path, init), async () => {
    const res = await fetch(path, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
      credentials: 'same-origin',
    })
    return (await res.json()) as T
  })
}

const nativeDataClient: DataClient = {
  async getProjects() {
    return api<{ data: Project[] | null; error: string | null }>('/api/data/projects')
  },

  async getTimesheets(q: TimesheetQuery = {}) {
    const params = new URLSearchParams()
    if (q.from !== undefined) params.set('from', String(q.from))
    if (q.to !== undefined) params.set('to', String(q.to))
    if (q.limit !== undefined) params.set('limit', String(q.limit))
    if (q.userId) params.set('userId', q.userId)
    if (q.dateFrom) params.set('dateFrom', q.dateFrom)
    if (q.dateTo) params.set('dateTo', q.dateTo)
    const qs = params.toString()
    return api<TimesheetResult>(`/api/data/timesheets${qs ? `?${qs}` : ''}`)
  },

  async getAllUsers() {
    return api<{ data: User[] | null; error: string | null }>('/api/data/profiles')
  },

  async getProfile() {
    return api<{ data: User | null; error: string | null }>('/api/data/profile')
  },

  async getBackfillWindow() {
    return api<{ data: BackfillSettings | null }>('/api/data/backfill-window')
  },

  async getActivityTypes() {
    return api<{ data: ActivityType[] | null; error: string | null }>('/api/data/activity-types')
  },

  async getAllActivityTypes() {
    return api<{ data: ActivityType[] | null; error: string | null }>('/api/data/activity-types?all=1')
  },

  async getLeaves(opts: LeafQuery = {}) {
    const params = new URLSearchParams()
    if (opts.userId) params.set('userId', opts.userId)
    if (opts.from) params.set('from', opts.from)
    if (opts.to) params.set('to', opts.to)
    const qs = params.toString()
    return api<{ data: LeaveEntry[] | null; error: string | null }>(`/api/data/leaves${qs ? `?${qs}` : ''}`)
  },

  async insertLeaves(rows) {
    return api<{ error: string | null }>('/api/data/leaves', {
      method: 'POST',
      body: JSON.stringify({ rows }),
    })
  },

  async deleteLeave(id) {
    return api<{ error: string | null }>(`/api/data/leaves?id=${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
  },

  async getReminders() {
    return api<{ data: Reminder[] | null; error: string | null }>('/api/data/reminders')
  },

  async insertReminder(input) {
    return api<{ error: string | null }>('/api/data/reminders', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  },

  async updateReminder(id, done) {
    return api<{ error: string | null }>('/api/data/reminders', {
      method: 'PATCH',
      body: JSON.stringify({ id, done }),
    })
  },

  async deleteReminder(id) {
    return api<{ error: string | null }>(`/api/data/reminders?id=${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
  },

  async getDueGlobalReminders() {
    return api<{ data: GlobalReminder[] | null; error: string | null }>('/api/data/global-reminders')
  },

  async getGlobalReminders() {
    return api<{ data: GlobalReminder[] | null; error: string | null }>('/api/data/global-reminders?all=1')
  },

  async getReportTotals(q: ReportQuery = {}) {
    const params = new URLSearchParams()
    if (q.project) params.set('project', q.project)
    if (q.from) params.set('from', q.from)
    if (q.to) params.set('to', q.to)
    if (q.groupBy) params.set('groupBy', q.groupBy)
    const qs = params.toString()
    return api<ReportTotalsResult>(`/api/data/reports${qs ? `?${qs}` : ''}`)
  },
}

export const dataClient: DataClient = IS_NATIVE ? nativeDataClient : supabaseDataClient
