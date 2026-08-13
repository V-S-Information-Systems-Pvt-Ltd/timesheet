// lib/data/client.ts
// Client-side data abstraction. Components call dataClient instead of the
// Supabase browser client directly; the supabase implementation wraps
// supabase-js and the native implementation calls the /api/data route handlers
// (server-side authorization).

'use client'

import { IS_NATIVE } from '@/lib/backend/client'
import { createClient } from '@/lib/supabase/client'
import type { LeaveEntry, Project, Reminder, Timesheet, User } from '@/app/types'

export interface TimesheetQuery {
  from?: number
  to?: number
  limit?: number
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

export interface DataClient {
  getProjects(): Promise<{ data: Project[] | null; error: string | null }>
  getTimesheets(q?: TimesheetQuery): Promise<TimesheetResult>
  getAllUsers(): Promise<{ data: User[] | null; error: string | null }>
  getProfile(userId?: string): Promise<{ data: User | null; error: string | null }>
  getBackfillWindow(): Promise<{ data: number | null }>
  getLeaves(opts?: LeafQuery): Promise<{ data: LeaveEntry[] | null; error: string | null }>
  insertLeaves(rows: Array<{ userId: string; leaveDate: string; reason: string }>): Promise<{ error: string | null }>
  deleteLeave(id: string): Promise<{ error: string | null }>
  getReminders(userId?: string): Promise<{ data: Reminder[] | null; error: string | null }>
  insertReminder(input: { userId: string; message: string; remindAt: string }): Promise<{ error: string | null }>
  updateReminder(id: string, done: boolean): Promise<{ error: string | null }>
  deleteReminder(id: string): Promise<{ error: string | null }>
}

// --- supabase implementation -----------------------------------------------------

const supabase = createClient()

const supabaseDataClient: DataClient = {
  async getProjects() {
    const { data, error } = await supabase.from('projects').select('*').order('name')
    return { data: (data as Project[] | null) ?? null, error: error ? error.message : null }
  },

  async getTimesheets(q: TimesheetQuery = {}) {
    let query = supabase
      .from('timesheets')
      .select('*, projects(name), profiles(email)', { count: 'exact' })
      .order('log_date', { ascending: false })
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
    const { data, error } = await supabase.from('profiles').select('*').limit(500)
    return { data: (data as User[] | null) ?? null, error: error ? error.message : null }
  },

  async getProfile(userId) {
    if (!userId) return { data: null, error: 'User id required.' }
    const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle()
    return { data: (data as User | null) ?? null, error: error ? error.message : null }
  },

  async getBackfillWindow() {
    const { data } = await supabase
      .from('app_settings')
      .select('backfill_window_days')
      .eq('id', 1)
      .limit(1)
      .maybeSingle()
    return {
      data: data && typeof data.backfill_window_days === 'number' ? data.backfill_window_days : null,
    }
  },

  async getLeaves(opts: LeafQuery = {}) {
    let query = supabase.from('leaves').select('*').order('leave_date', { ascending: true })
    if (opts.userId) query = query.eq('user_id', opts.userId)
    if (opts.from) query = query.gte('leave_date', opts.from)
    if (opts.to) query = query.lte('leave_date', opts.to)
    query = query.limit(1000)
    const { data, error } = await query
    return { data: (data as LeaveEntry[] | null) ?? null, error: error ? error.message : null }
  },

  async insertLeaves(rows) {
    const { error } = await supabase.from('leaves').insert(
      rows.map((r) => ({ user_id: r.userId, leave_date: r.leaveDate, reason: r.reason }))
    )
    return { error: error ? error.message : null }
  },

  async deleteLeave(id) {
    const { error } = await supabase.from('leaves').delete().eq('id', id)
    return { error: error ? error.message : null }
  },

  async getReminders(userId) {
    if (!userId) return { data: null, error: 'User id required.' }
    const { data, error } = await supabase
      .from('reminders')
      .select('*')
      .eq('user_id', userId)
      .order('remind_at', { ascending: true })
      .limit(50)
    return { data: (data as Reminder[] | null) ?? null, error: error ? error.message : null }
  },

  async insertReminder(input) {
    const { error } = await supabase.from('reminders').insert({
      user_id: input.userId,
      message: input.message,
      remind_at: input.remindAt,
    })
    return { error: error ? error.message : null }
  },

  async updateReminder(id, done) {
    const { error } = await supabase.from('reminders').update({ done }).eq('id', id)
    return { error: error ? error.message : null }
  },

  async deleteReminder(id) {
    const { error } = await supabase.from('reminders').delete().eq('id', id)
    return { error: error ? error.message : null }
  },
}

// --- native implementation -------------------------------------------------------

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    credentials: 'same-origin',
  })
  return (await res.json()) as T
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
    return api<{ data: number | null }>('/api/data/backfill-window')
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
}

export const dataClient: DataClient = IS_NATIVE ? nativeDataClient : supabaseDataClient
