// lib/db/supabase/reference.ts
// Supabase implementation of ReferencePersistence.
import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { getMobileSupabaseClient } from '@/lib/supabase/bearer'
import { getAdminClient } from '@/lib/supabase/admin'
import { hasPermission, isAdminActor, HIERARCHY_ROLES } from '@/lib/roles'
import { logger } from '@/lib/logger'
import type { ActivityType, HierarchyRole, Project, TitleRecord, WhitelistedDomain } from '@/app/types'
import type {
  Actor,
  CreateActivityTypeOptions,
  CreateProjectOptions,
  DbCreateResult,
  DbWrite,
} from '@/lib/db/repository'
import type { ReferencePersistence, TitleImpact } from '@/lib/domain/reference-port'

async function server() {
  const mobileClient = getMobileSupabaseClient()
  if (mobileClient) return mobileClient
  return createClient()
}

function writeError(err: { message?: string; code?: string; details?: string } | null): DbWrite {
  if (!err) return { error: null }
  if (err.code === '23505') {
    return { error: 'A record with that value already exists.' }
  }
  if (err.code === '23503') {
    return { error: 'This record is referenced by other data and cannot be changed.' }
  }
  logger.error('Supabase write error', { error: err.message, code: err.code, details: err.details })
  return { error: 'Something went wrong. Please try again.' }
}

function writeReturningError<T>(
  data: T | null,
  err: { message: string; code?: string; details?: string } | null
): DbCreateResult<T> {
  if (err) {
    return { data: null, error: writeError(err).error ?? 'Database operation failed.' }
  }
  if (!data) {
    return { data: null, error: 'Record could not be created.' }
  }
  return { data, error: null }
}

type DynamicQueryWithSingle = {
  select?: (columns?: string) => DynamicQueryWithSingle
  single?: () => Promise<{ data: unknown; error: { message: string; code?: string; details?: string } | null }>
  maybeSingle?: () => Promise<{ data: unknown; error: { message: string; code?: string; details?: string } | null }>
}

async function executeSelectSingle(targetQuery: unknown): Promise<{
  data: unknown
  error: { message: string; code?: string; details?: string } | null
}> {
  let target = targetQuery as DynamicQueryWithSingle
  if (typeof target?.select === 'function') {
    target = target.select()
  }
  if (typeof target?.single === 'function') {
    return target.single()
  }
  if (typeof target?.maybeSingle === 'function') {
    return target.maybeSingle()
  }
  return (target as unknown as Promise<{
    data: unknown
    error: { message: string; code?: string; details?: string } | null
  }>)
}

export const supabaseReferencePersistence: ReferencePersistence = {
  // --- projects ---

  async listProjects(_actor: Actor): Promise<Project[]> {
    const supabase = await server()
    const { data, error } = await supabase.from('projects').select('*')
    if (error) throw new Error(error.message)
    return (data as Project[]) ?? []
  },

  async createProject(
    actor: Actor,
    nameOrInput: string | { name: string; soNumber?: string | null; telegramNo?: number | null },
    options?: CreateProjectOptions
  ): Promise<DbCreateResult<Project>> {
    if (!hasPermission(actor, ['admin', 'pm'])) {
      return { data: null, error: 'You do not have permission to perform this action.' }
    }
    const name = (typeof nameOrInput === 'string' ? nameOrInput : nameOrInput.name).trim()
    const soNumber =
      (typeof nameOrInput === 'object' && nameOrInput.soNumber !== undefined
        ? nameOrInput.soNumber
        : options?.soNumber)?.trim() || null
    const telegramNo =
      typeof nameOrInput === 'object' && nameOrInput.telegramNo !== undefined
        ? nameOrInput.telegramNo
        : options?.telegramNo ?? null

    const supabase = await server()
    const { data, error } = await executeSelectSingle(
      supabase.from('projects').insert({ name, so_number: soNumber, telegram_no: telegramNo })
    )
    return writeReturningError(data as Project, error)
  },

  async renameProject(actor: Actor, id: string, name: string): Promise<DbWrite> {
    if (!hasPermission(actor, ['admin', 'pm'])) {
      return { error: 'You do not have permission to perform this action.' }
    }
    const supabase = await server()
    const { error } = await supabase.from('projects').update({ name }).eq('id', id)
    return writeError(error)
  },

  async setProjectSO(actor: Actor, id: string, soNumber: string | null): Promise<DbWrite> {
    if (!hasPermission(actor, ['admin', 'pm'])) {
      return { error: 'You do not have permission to perform this action.' }
    }
    const supabase = await server()
    const { error } = await supabase
      .from('projects')
      .update({ so_number: soNumber || null })
      .eq('id', id)
    return writeError(error)
  },

  async setProjectTelegramNo(actor: Actor, id: string, telegramNo: number | null): Promise<DbWrite> {
    if (!hasPermission(actor, ['admin', 'pm'])) {
      return { error: 'You do not have permission to perform this action.' }
    }
    const supabase = await server()
    const { error } = await supabase
      .from('projects')
      .update({ telegram_no: telegramNo })
      .eq('id', id)
    return writeError(error)
  },

  async deleteProject(actor: Actor, id: string): Promise<DbWrite> {
    if (!hasPermission(actor, ['admin', 'pm'])) {
      return { error: 'You do not have permission to perform this action.' }
    }
    const supabase = await server()
    const { count, error: countError } = await supabase
      .from('timesheets')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', id)
    if (countError) return { error: countError.message }
    if (count && count > 0) {
      return { error: `Cannot delete: ${count} entries reference this project.` }
    }
    const { error } = await supabase.from('projects').delete().eq('id', id)
    return writeError(error)
  },

  // --- activity types ---

  async listActivityTypes(_actor: Actor): Promise<ActivityType[]> {
    const supabase = await server()
    const { data, error } = await supabase
      .from('activity_types')
      .select('*')
      .eq('is_active', true)
      .order('name')
    if (error) throw new Error(error.message)
    return (data as ActivityType[]) ?? []
  },

  async listAllActivityTypes(actor: Actor): Promise<ActivityType[]> {
    if (!isAdminActor(actor)) return this.listActivityTypes(actor)
    const supabase = await server()
    const { data, error } = await supabase.from('activity_types').select('*').order('name')
    if (error) throw new Error(error.message)
    return (data as ActivityType[]) ?? []
  },

  async createActivityType(
    actor: Actor,
    nameOrInput: string | { name: string; telegramNo?: number | null },
    options?: CreateActivityTypeOptions
  ): Promise<DbCreateResult<ActivityType>> {
    if (!isAdminActor(actor)) {
      return { data: null, error: 'You do not have permission to perform this action.' }
    }
    const name = (typeof nameOrInput === 'string' ? nameOrInput : nameOrInput.name).trim()
    const telegramNo =
      typeof nameOrInput === 'object' && nameOrInput.telegramNo !== undefined
        ? nameOrInput.telegramNo
        : options?.telegramNo ?? null

    const supabase = await server()
    const { data, error } = await executeSelectSingle(
      supabase.from('activity_types').insert({ name, telegram_no: telegramNo })
    )
    return writeReturningError(data as ActivityType, error)
  },

  async renameActivityType(actor: Actor, id: string, name: string): Promise<DbWrite> {
    if (!isAdminActor(actor)) {
      return { error: 'You do not have permission to perform this action.' }
    }
    const supabase = await server()
    const { error } = await supabase.from('activity_types').update({ name }).eq('id', id)
    return writeError(error)
  },

  async setActivityTypeActive(actor: Actor, id: string, isActive: boolean): Promise<DbWrite> {
    if (!isAdminActor(actor)) {
      return { error: 'You do not have permission to perform this action.' }
    }
    const supabase = await server()
    const { error } = await supabase.from('activity_types').update({ is_active: isActive }).eq('id', id)
    return writeError(error)
  },

  async setActivityTypeTelegramNo(actor: Actor, id: string, telegramNo: number | null): Promise<DbWrite> {
    if (!isAdminActor(actor)) {
      return { error: 'You do not have permission to perform this action.' }
    }
    const supabase = await server()
    const { error } = await supabase
      .from('activity_types')
      .update({ telegram_no: telegramNo })
      .eq('id', id)
    return writeError(error)
  },

  async deleteActivityType(actor: Actor, id: string): Promise<DbWrite> {
    if (!isAdminActor(actor)) {
      return { error: 'You do not have permission to perform this action.' }
    }
    const admin = getAdminClient()
    const { error } = await admin.from('activity_types').delete().eq('id', id)
    return writeError(error)
  },

  // --- titles ---

  async listTitles(): Promise<string[]> {
    const supabase = await server()
    const { data, error } = await supabase
      .from('titles')
      .select('name')
      .order('name', { ascending: true })
    if (error) throw new Error(error.message)
    return ((data ?? []) as { name: string }[]).map((r) => r.name)
  },

  async listTitleRecords(): Promise<TitleRecord[]> {
    const supabase = await server()
    const { data, error } = await supabase
      .from('titles')
      .select('id, name, hierarchy_role, created_at')
      .order('name', { ascending: true })
    if (error) throw new Error(error.message)
    return (data ?? []) as TitleRecord[]
  },

  async addTitle(
    actor: Actor,
    name: string,
    hierarchyRole: HierarchyRole = 'user'
  ): Promise<DbCreateResult<TitleRecord>> {
    if (!isAdminActor(actor)) {
      return { data: null, error: 'You do not have permission to manage titles.' }
    }
    const clean = name.trim()
    if (!clean) return { data: null, error: 'Title name is required.' }
    if (!HIERARCHY_ROLES.includes(hierarchyRole)) {
      return { data: null, error: 'Invalid hierarchy role.' }
    }
    const supabase = await server()
    const { data, error } = await executeSelectSingle(
      supabase
        .from('titles')
        .upsert({ name: clean, hierarchy_role: hierarchyRole }, { onConflict: 'name' })
    )
    return writeReturningError(data as TitleRecord, error)
  },

  async deleteTitle(actor: Actor, name: string): Promise<DbWrite> {
    if (!isAdminActor(actor)) {
      return { error: 'You do not have permission to manage titles.' }
    }
    const clean = name.trim()
    const supabase = await server()
    const { error } = await supabase.from('titles').delete().ilike('name', clean)
    return writeError(error)
  },

  async reclassifyTitle(
    actor: Actor,
    name: string,
    hierarchyRole: HierarchyRole,
    syncUsers = false
  ): Promise<{ error: string | null; affectedCount?: number }> {
    if (!isAdminActor(actor)) {
      return { error: 'You do not have permission to manage titles.' }
    }
    const clean = name.trim()
    if (!clean) return { error: 'Title name is required.' }
    if (!HIERARCHY_ROLES.includes(hierarchyRole)) {
      return { error: 'Invalid hierarchy role.' }
    }

    const admin = getAdminClient()
    const { data, error } = await (admin.rpc as unknown as (
      name: string,
      args: { p_title: string; p_hierarchy_role: string; p_sync_users: boolean }
    ) => Promise<{ data: number | null; error: { message: string } | null }>)(
      'reclassify_title_atomic',
      {
        p_title: clean,
        p_hierarchy_role: hierarchyRole,
        p_sync_users: syncUsers,
      }
    )

    if (error) return { error: error.message }
    return { error: null, affectedCount: Number(data ?? 0) }
  },

  async getTitleImpact(
    actor: Actor,
    name: string,
    proposedRole?: HierarchyRole
  ): Promise<TitleImpact | { error: string }> {
    if (!isAdminActor(actor)) {
      return { error: 'You do not have permission to manage titles.' }
    }
    const clean = name.trim()
    if (!clean) return { error: 'Title name is required.' }

    const admin = getAdminClient()
    const { data: titleRow, error: titleErr } = await admin
      .from('titles')
      .select('name, hierarchy_role')
      .ilike('name', clean)
      .maybeSingle()

    if (titleErr || !titleRow) {
      return { error: titleErr?.message ?? `Title "${clean}" not found.` }
    }

    const currentHierarchyRole = ((titleRow as { hierarchy_role?: string }).hierarchy_role || 'user') as HierarchyRole
    const proposed = proposedRole && HIERARCHY_ROLES.includes(proposedRole) ? proposedRole : currentHierarchyRole

    const { count } = await admin
      .from('profiles')
      .select('*', { count: 'exact', head: true })
      .ilike('title', clean)

    const affectedCount = count ?? 0
    const syncRequired = affectedCount > 0 && currentHierarchyRole !== proposed

    return {
      title: (titleRow as { name: string }).name,
      currentHierarchyRole,
      proposedHierarchyRole: proposed,
      affectedCount,
      syncRequired,
    }
  },

  // --- email domain whitelist ---

  async listWhitelistedDomains(_actor?: Actor): Promise<WhitelistedDomain[]> {
    const supabase = await server()
    const { data, error } = await supabase
      .from('whitelisted_domains')
      .select('*')
      .order('domain', { ascending: true })
    if (error) throw new Error(error.message)
    return (data as WhitelistedDomain[]) ?? []
  },

  async addWhitelistedDomain(actor: Actor, domain: string, autoActivate: boolean): Promise<DbWrite> {
    if (!isAdminActor(actor)) {
      return { error: 'You do not have permission to manage email domains.' }
    }
    const clean = domain.trim().toLowerCase().replace(/^@/, '')
    if (!clean) return { error: 'Domain name is required.' }
    const supabase = await server()
    const { error } = await supabase
      .from('whitelisted_domains')
      .insert({ domain: clean, auto_activate: autoActivate })
    return writeError(error)
  },

  async updateWhitelistedDomain(actor: Actor, id: string, autoActivate: boolean): Promise<DbWrite> {
    if (!isAdminActor(actor)) {
      return { error: 'You do not have permission to manage email domains.' }
    }
    const supabase = await server()
    const { error } = await supabase
      .from('whitelisted_domains')
      .update({ auto_activate: autoActivate })
      .eq('id', id)
    return writeError(error)
  },

  async deleteWhitelistedDomain(actor: Actor, id: string): Promise<DbWrite> {
    if (!isAdminActor(actor)) {
      return { error: 'You do not have permission to manage email domains.' }
    }
    const supabase = await server()
    const { error } = await supabase
      .from('whitelisted_domains')
      .delete()
      .eq('id', id)
    return writeError(error)
  },
}
