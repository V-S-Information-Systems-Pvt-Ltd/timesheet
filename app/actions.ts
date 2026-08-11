// app/actions.ts
'use server'

import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { getAdminClient } from '@/lib/supabase/admin'
import type { UserRole } from './types'

type ActionResult = { error?: string }

const ROLES: UserRole[] = ['admin', 'pm', 'co', 'user']

async function currentRole(supabase: SupabaseClient): Promise<
  | { ok: true; userId: string; role: UserRole }
  | { ok: false; error: string; userId: null; role: null }
> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { ok: false, error: 'You must be signed in.', userId: null, role: null }
  }

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (error || !profile) {
    return { ok: false, error: 'Profile not found.', userId: null, role: null }
  }

  return { ok: true, userId: user.id, role: profile.role as UserRole }
}

async function requireRoles(
  supabase: SupabaseClient,
  allowed: UserRole[]
): Promise<{ ok: true; userId: string } | { ok: false; error: string; userId: null }> {
  const current = await currentRole(supabase)
  if (!current.ok) return current
  if (!allowed.includes(current.role)) {
    return {
      ok: false,
      error: 'You do not have permission to perform this action.',
      userId: null,
    }
  }
  return { ok: true, userId: current.userId }
}

export async function logEntry(input: {
  projectId: string
  hoursWorked: number
  workDone: string
  logDate: string
}): Promise<ActionResult> {
  const supabase = await createClient()
  const current = await currentRole(supabase)
  if (!current.ok) {
    return { error: current.error }
  }

  const { error } = await supabase.from('timesheets').insert({
    user_id: current.userId,
    project_id: input.projectId,
    hours_worked: input.hoursWorked,
    work_done: input.workDone,
    log_date: input.logDate,
  })

  return error ? { error: error.message } : {}
}

export async function addProject(name: string): Promise<ActionResult> {
  const supabase = await createClient()
  const allowed = await requireRoles(supabase, ['admin', 'pm'])
  if (!allowed.ok) return { error: allowed.error }

  const { error } = await supabase.from('projects').insert({ name })

  return error ? { error: error.message } : {}
}

export async function renameProject(projectId: string, name: string): Promise<ActionResult> {
  const supabase = await createClient()
  const allowed = await requireRoles(supabase, ['admin', 'pm'])
  if (!allowed.ok) return { error: allowed.error }
  if (!name.trim()) return { error: 'Project name is required.' }

  const { error } = await supabase
    .from('projects')
    .update({ name: name.trim() })
    .eq('id', projectId)

  return error ? { error: error.message } : {}
}

export async function setProjectSO(projectId: string, soNumber: string): Promise<ActionResult> {
  const supabase = await createClient()
  const allowed = await requireRoles(supabase, ['admin', 'pm'])
  if (!allowed.ok) return { error: allowed.error }

  const { error } = await supabase
    .from('projects')
    .update({ so_number: soNumber.trim() || null })
    .eq('id', projectId)

  return error ? { error: error.message } : {}
}

export async function deleteProject(projectId: string): Promise<ActionResult> {
  const supabase = await createClient()
  const allowed = await requireRoles(supabase, ['admin', 'pm'])
  if (!allowed.ok) return { error: allowed.error }

  const { count, error: countError } = await supabase
    .from('timesheets')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', projectId)
  if (countError) return { error: countError.message }
  if (count && count > 0) {
    return { error: `Cannot delete: ${count} entries reference this project.` }
  }

  const { error } = await supabase.from('projects').delete().eq('id', projectId)

  return error ? { error: error.message } : {}
}

function toISODate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export async function logYesterday(input: {
  projectId: string
  hoursWorked: number
  workDone: string
  userId?: string
}): Promise<ActionResult> {
  const supabase = await createClient()
  const current = await currentRole(supabase)
  if (!current.ok) return { error: current.error }

  let targetUserId = current.userId
  if (input.userId && input.userId !== current.userId) {
    if (current.role !== 'admin') {
      return { error: 'Only admins can backfill for other users.' }
    }
    targetUserId = input.userId
  }

  if (!input.projectId || !input.workDone.trim() || !(input.hoursWorked > 0)) {
    return { error: 'All fields are required and hours must be greater than zero.' }
  }

  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  const yesterdayStr = toISODate(yesterday)

  const { count, error: countError } = await supabase
    .from('timesheets')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', targetUserId)
    .eq('log_date', yesterdayStr)
  if (countError) return { error: countError.message }
  if (count && count > 0) {
    return { error: 'An entry for yesterday already exists (cap: 1 per day).' }
  }

  const { error } = await supabase.from('timesheets').insert({
    user_id: targetUserId,
    project_id: input.projectId,
    hours_worked: input.hoursWorked,
    work_done: input.workDone,
    log_date: yesterdayStr,
  })

  return error ? { error: error.message } : {}
}

export async function deleteLastEntry(): Promise<ActionResult> {
  const supabase = await createClient()
  const current = await currentRole(supabase)
  if (!current.ok) return { error: current.error }

  const { data, error } = await supabase
    .from('timesheets')
    .select('id')
    .eq('user_id', current.userId)
    .order('log_date', { ascending: false })
    .limit(1)
  if (error) return { error: error.message }
  if (!data || data.length === 0) return { error: 'No entries to undo.' }

  const { error: deleteError } = await supabase.from('timesheets').delete().eq('id', data[0].id)

  return deleteError ? { error: deleteError.message } : {}
}

export async function updateTimesheet(
  entryId: string,
  input: {
    projectId: string
    hoursWorked: number
    workDone: string
    logDate: string
  }
): Promise<ActionResult> {
  const supabase = await createClient()
  const current = await currentRole(supabase)
  if (!current.ok) return { error: current.error }

  if (!input.projectId || !input.workDone.trim() || !input.logDate) {
    return { error: 'All fields are required.' }
  }
  if (!(input.hoursWorked > 0)) {
    return { error: 'Hours must be greater than zero.' }
  }

  const { data: target, error: targetError } = await supabase
    .from('timesheets')
    .select('user_id')
    .eq('id', entryId)
    .single()
  if (targetError || !target) return { error: 'Entry not found.' }
  if (target.user_id !== current.userId && current.role !== 'admin') {
    return { error: 'You can only modify your own entries.' }
  }

  const { error } = await supabase
    .from('timesheets')
    .update({
      project_id: input.projectId,
      hours_worked: input.hoursWorked,
      work_done: input.workDone,
      log_date: input.logDate,
    })
    .eq('id', entryId)

  return error ? { error: error.message } : {}
}

export async function deleteTimesheet(entryId: string): Promise<ActionResult> {
  const supabase = await createClient()
  const current = await currentRole(supabase)
  if (!current.ok) return { error: current.error }

  const { data: target, error: targetError } = await supabase
    .from('timesheets')
    .select('user_id')
    .eq('id', entryId)
    .single()
  if (targetError || !target) return { error: 'Entry not found.' }
  if (target.user_id !== current.userId && current.role !== 'admin') {
    return { error: 'You can only delete your own entries.' }
  }

  const { error } = await supabase.from('timesheets').delete().eq('id', entryId)

  return error ? { error: error.message } : {}
}

export async function addUser(input: {
  email: string
  password: string
  name: string
  department: string
  title: string
  role: UserRole
  isActive: boolean
}): Promise<ActionResult> {
  const supabase = await createClient()
  const admin = await requireRoles(supabase, ['admin'])
  if (!admin.ok) return { error: admin.error }

  if (!ROLES.includes(input.role)) {
    return { error: 'Invalid role.' }
  }
  if (!input.email.trim() || !input.password || input.password.length < 6) {
    return { error: 'Email and a password of at least 6 characters are required.' }
  }

  let adminClient: SupabaseClient
  try {
    adminClient = getAdminClient()
  } catch (err) {
    return { error: (err as Error).message }
  }

  const email = input.email.trim().toLowerCase()
  const { data: authUser, error: authError } = await adminClient.auth.admin.createUser({
    email,
    password: input.password,
    email_confirm: true,
    user_metadata: { name: input.name.trim() },
  })
  if (authError) return { error: authError.message }
  if (!authUser.user) return { error: 'Failed to create user.' }

  // The signup trigger may have already created a profile row, so upsert.
  const { error } = await adminClient.from('profiles').upsert(
    {
      id: authUser.user.id,
      email,
      name: input.name.trim(),
      department: input.department.trim(),
      title: input.title.trim(),
      role: input.role,
      is_active: input.isActive,
    },
    { onConflict: 'id' }
  )

  return error ? { error: error.message } : {}
}

export async function toggleUserStatus(userId: string): Promise<ActionResult> {
  const supabase = await createClient()
  const admin = await requireRoles(supabase, ['admin'])
  if (!admin.ok) return { error: admin.error }

  const { data: target, error: targetError } = await supabase
    .from('profiles')
    .select('is_active')
    .eq('id', userId)
    .single()
  if (targetError || !target) return { error: 'User not found.' }

  if (admin.userId === userId && target.is_active) {
    return { error: 'You cannot deactivate your own account.' }
  }

  const { error } = await supabase
    .from('profiles')
    .update({ is_active: !target.is_active })
    .eq('id', userId)

  return error ? { error: error.message } : {}
}

export async function updateUserRole(userId: string, role: UserRole): Promise<ActionResult> {
  const supabase = await createClient()
  const admin = await requireRoles(supabase, ['admin'])
  if (!admin.ok) return { error: admin.error }

  if (!ROLES.includes(role)) return { error: 'Invalid role.' }
  if (admin.userId === userId) return { error: 'You cannot change your own role.' }

  const { error } = await supabase
    .from('profiles')
    .update({ role })
    .eq('id', userId)

  return error ? { error: error.message } : {}
}
