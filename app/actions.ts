// app/actions.ts
'use server'

import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'

type ActionResult = { error?: string }

async function ensureAdmin(supabase: SupabaseClient): Promise<
  | { ok: true; userId: string }
  | { ok: false; error: string; userId: null }
> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'You must be signed in.', userId: null }

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()

  if (error || !profile?.is_admin) {
    return { ok: false, error: 'Admin access required.', userId: null }
  }

  return { ok: true, userId: user.id }
}

export async function logEntry(input: {
  projectId: string
  hoursWorked: number
  workDone: string
  logDate: string
}): Promise<ActionResult> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'You must be signed in to log time.' }
  }

  const { error } = await supabase.from('timesheets').insert({
    user_id: user.id,
    project_id: input.projectId,
    hours_worked: input.hoursWorked,
    work_done: input.workDone,
    log_date: input.logDate,
  })

  return error ? { error: error.message } : {}
}

export async function addProject(name: string): Promise<ActionResult> {
  const supabase = await createClient()
  const admin = await ensureAdmin(supabase)
  if (!admin.ok) return { error: admin.error }

  const { error } = await supabase.from('projects').insert({ name })

  return error ? { error: error.message } : {}
}

export async function toggleUserStatus(userId: string): Promise<ActionResult> {
  const supabase = await createClient()
  const admin = await ensureAdmin(supabase)
  if (!admin.ok) return { error: admin.error }

  const { data: target, error: targetError } = await supabase
    .from('profiles')
    .select('is_active')
    .eq('id', userId)
    .single()
  if (targetError || !target) return { error: 'User not found.' }

  const { error } = await supabase
    .from('profiles')
    .update({ is_active: !target.is_active })
    .eq('id', userId)

  return error ? { error: error.message } : {}
}

export async function toggleAdminStatus(userId: string): Promise<ActionResult> {
  const supabase = await createClient()
  const admin = await ensureAdmin(supabase)
  if (!admin.ok) return { error: admin.error }

  const { data: target, error: targetError } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', userId)
    .single()
  if (targetError || !target) return { error: 'User not found.' }

  if (admin.userId === userId && target.is_admin) {
    return { error: 'You cannot remove your own admin role.' }
  }

  const { error } = await supabase
    .from('profiles')
    .update({ is_admin: !target.is_admin })
    .eq('id', userId)

  return error ? { error: error.message } : {}
}
