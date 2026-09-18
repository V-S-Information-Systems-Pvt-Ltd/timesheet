import 'server-only'

import type { HierarchyRole, PermissionRole, TitleRecord, User, UserRole } from '@/app/types'
import { extractError, logger } from '@/lib/logger'
import { canSeeAllActor, isAdminActor, isLeaderActor, legacyRoleFromPair } from '@/lib/roles'
import { getAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { getMobileSupabaseClient } from '@/lib/supabase/bearer'
import type { Json } from '@/lib/supabase/database.types'
import type { Actor, CreateUserInput, DbWrite, UpdateUserInput } from '../repository'
import type { PeopleIdentity, PeoplePersistence } from '@/lib/domain/people-port'

async function server() {
  const mobileClient = getMobileSupabaseClient()
  if (mobileClient) return mobileClient
  return createClient()
}

function writeError(err: { message: string; code?: string } | null): DbWrite {
  if (!err) return { error: null }
  if (err.code === '23505') {
    return { error: 'A record with that value already exists.' }
  }
  if (err.code === '23503') {
    return { error: 'This record is referenced by other data and cannot be changed.' }
  }
  return { error: err.message || 'Database write failed.' }
}

async function getSubordinateIds(supabase: unknown, leaderId: string): Promise<string[]> {
  const client = supabase as {
    rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>
  }
  try {
    const { data, error } = await client.rpc('team_ids', { target: leaderId })
    if (error) {
      logger.error('Failed to lookup subordinate IDs', { leaderId, error: error.message })
      throw new Error(`Subordinate lookup failed: ${error.message}`)
    }
    if (Array.isArray(data)) {
      return data.map((x) =>
        typeof x === 'string'
          ? x
          : x && typeof x === 'object' && 'subordinate_id' in x
            ? String((x as { subordinate_id: unknown }).subordinate_id)
            : x && typeof x === 'object' && 'id' in x
              ? String((x as { id: unknown }).id)
              : String(x)
      )
    }
    return []
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Subordinate lookup failed:')) throw err
    logger.error('Failed to lookup subordinate IDs', { leaderId, error: extractError(err) })
    throw new Error(`Subordinate lookup failed: ${extractError(err)}`)
  }
}

export interface SupabasePeoplePersistence extends PeoplePersistence {
  getProfileByEmail(email: string): Promise<User | null>
}

export const supabasePeoplePersistence: SupabasePeoplePersistence = {
  async getProfileById(id: string): Promise<User | null> {
    const supabase = await server()
    const { data, error } = await supabase.from('profiles').select('*').eq('id', id).maybeSingle()
    if (error) throw new Error(error.message)
    return (data as User | null) ?? null
  },

  async getProfileByEmail(email: string): Promise<User | null> {
    const supabase = await server()
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('email', email)
      .maybeSingle()
    if (error) throw new Error(error.message)
    return (data as User | null) ?? null
  },

  async listProfiles(actor: Actor): Promise<User[]> {
    if (canSeeAllActor(actor)) {
      const supabase = await server()
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .order('email', { ascending: true })
        .limit(500)
      if (error) throw new Error(error.message)
      return (data as User[]) ?? []
    }
    if (isLeaderActor(actor)) {
      const supabase = await server()
      const teamIds = await getSubordinateIds(supabase, actor.id)
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .in('id', [actor.id, ...teamIds])
        .order('email', { ascending: true })
        .limit(500)
      if (error) throw new Error(error.message)
      return (data as User[]) ?? []
    }
    return []
  },

  async updateUserStatus(actor: Actor, userId: string, isActive: boolean): Promise<DbWrite> {
    if (!isAdminActor(actor)) return { error: 'You do not have permission to perform this action.' }
    const supabase = await server()
    const { error } = await supabase.from('profiles').update({ is_active: isActive }).eq('id', userId)
    return writeError(error)
  },

  async updateUserRoles(
    actor: Actor,
    userId: string,
    permissionRole: PermissionRole,
    hierarchyRole: HierarchyRole
  ): Promise<DbWrite> {
    if (!isAdminActor(actor)) return { error: 'You do not have permission to perform this action.' }
    const supabase = await server()
    const { error } = await supabase
      .from('profiles')
      .update({
        permission_role: permissionRole,
        hierarchy_role: hierarchyRole,
        role: legacyRoleFromPair(permissionRole, hierarchyRole),
      })
      .eq('id', userId)
    return writeError(error)
  },

  async updateMyProfile(actor: Actor, input: { department: string; title: string }): Promise<DbWrite> {
    const cleanTitle = (input.title || '').trim()
    const supabase = await server()
    if (cleanTitle) {
      const { data: titleData } = await supabase
        .from('titles')
        .select('hierarchy_role')
        .ilike('name', cleanTitle)
        .maybeSingle()
      if (titleData && titleData.hierarchy_role !== actor.hierarchy_role) {
        return {
          error: `Cannot change to title "${cleanTitle}" because it belongs to the "${titleData.hierarchy_role}" hierarchy role. Changing hierarchy roles requires an administrator.`,
        }
      }
    }
    const { error } = await supabase
      .from('profiles')
      .update({ department: input.department, title: cleanTitle })
      .eq('id', actor.id)
    return writeError(error)
  },

  async updateUserName(actor: Actor, userId: string, name: string): Promise<DbWrite> {
    if (!isAdminActor(actor) && actor.id !== userId) {
      return { error: 'You do not have permission to perform this action.' }
    }
    const supabase = await server()
    const { error } = await supabase.from('profiles').update({ name }).eq('id', userId)
    return writeError(error)
  },

  async updateUserManager(actor: Actor, userId: string, managerId: string | null): Promise<DbWrite> {
    if (!isAdminActor(actor)) {
      return { error: 'You do not have permission to perform this action.' }
    }
    const supabase = await server()
    const { error } = await supabase
      .from('profiles')
      .update({ manager_id: managerId })
      .eq('id', userId)
    return writeError(error)
  },

  async updateUser(actor: Actor, userId: string, input: UpdateUserInput): Promise<DbWrite> {
    if (!isAdminActor(actor)) return { error: 'You do not have permission to perform this action.' }
    const supabase = await server()
    const { data: current, error: getErr } = await supabase
      .from('profiles')
      .select('permission_role, hierarchy_role')
      .eq('id', userId)
      .maybeSingle()
    if (getErr) return writeError(getErr)
    if (!current) return { error: 'User not found.' }

    const updates: {
      name?: string
      department?: string | null
      title?: string | null
      is_active?: boolean
      manager_id?: string | null
      permission_role?: PermissionRole
      hierarchy_role?: HierarchyRole
      role?: UserRole
    } = {}
    if (input.name !== undefined) updates.name = input.name.trim()
    if (input.department !== undefined) updates.department = input.department ? input.department.trim() : null
    if (input.title !== undefined) updates.title = input.title ? input.title.trim() : null
    if (input.isActive !== undefined) updates.is_active = input.isActive
    if (input.managerId !== undefined) updates.manager_id = input.managerId ? input.managerId.trim() : null

    const nextPermRole = input.permissionRole ?? (current.permission_role as PermissionRole) ?? 'user'
    const nextHierRole = input.hierarchyRole ?? (current.hierarchy_role as HierarchyRole) ?? 'user'
    if (input.permissionRole !== undefined) updates.permission_role = input.permissionRole
    if (input.hierarchyRole !== undefined) updates.hierarchy_role = input.hierarchyRole
    if (input.permissionRole !== undefined || input.hierarchyRole !== undefined) {
      updates.role = legacyRoleFromPair(nextPermRole, nextHierRole)
    }

    if (Object.keys(updates).length === 0) {
      return { error: null }
    }

    const { error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', userId)
    return writeError(error)
  },

  async updateUserHierarchy(
    actor: Actor,
    userId: string,
    data: { managerId: string | null; title?: string; hierarchyRole?: HierarchyRole }
  ): Promise<DbWrite> {
    if (!isAdminActor(actor)) {
      return { error: 'You do not have permission to update hierarchy.' }
    }
    const supabase = await server()
    const updates: {
      manager_id?: string | null
      title?: string
      hierarchy_role?: HierarchyRole
      role?: UserRole
    } = {
      manager_id: data.managerId ?? null,
    }
    if (data.title !== undefined) updates.title = data.title.trim()
    if (data.hierarchyRole !== undefined) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('permission_role')
        .eq('id', userId)
        .maybeSingle()
      const permission: PermissionRole = (profile?.permission_role as PermissionRole | undefined) ?? 'user'
      updates.hierarchy_role = data.hierarchyRole
      updates.role = legacyRoleFromPair(permission, data.hierarchyRole)
    }

    const { error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', userId)
    return writeError(error)
  },

  async listTitleRecords(): Promise<TitleRecord[]> {
    const supabase = await server()
    const { data, error } = await supabase
      .from('titles')
      .select('name, hierarchy_role, created_at')
      .order('name', { ascending: true })
    if (error) throw new Error(error.message)
    return (data as TitleRecord[]) ?? []
  },

  async writeAuditLog(
    actor: Actor,
    input: { action: string; targetId?: string | null; detail?: Record<string, unknown> | null }
  ): Promise<DbWrite> {
    const supabase = await server()
    const { error } = await supabase.from('audit_logs').insert({
      actor_id: actor.id,
      actor_email: actor.email,
      action: input.action,
      target_id: input.targetId ?? null,
      detail: (input.detail as Json) ?? null,
    })
    return writeError(error)
  },
}

export const supabasePeopleIdentity: PeopleIdentity = {
  async createAccount(actor: Actor, input: CreateUserInput): Promise<DbWrite> {
    if (!isAdminActor(actor)) return { error: 'You do not have permission to perform this action.' }

    const createdDomain = input.email.split('@')[1]?.toLowerCase()
    let adminClient
    try {
      adminClient = getAdminClient()
    } catch (err) {
      return { error: (err as Error).message }
    }

    if (createdDomain) {
      const { data: whitelisted } = await adminClient
        .from('whitelisted_domains')
        .select('id, domain')
        .ilike('domain', createdDomain)
        .maybeSingle()
      if (!whitelisted) {
        return {
          error: `User creation is restricted to approved email domains. Add @${createdDomain} to the whitelist first.`,
        }
      }
    }

    const { data: authUser, error: authError } = await adminClient.auth.admin.createUser({
      email: input.email,
      password: input.password,
      email_confirm: true,
      user_metadata: { name: input.name },
    })
    if (authError) return { error: authError.message }
    if (!authUser.user) return { error: 'Failed to create user.' }

    const { error } = await adminClient.from('profiles').upsert(
      {
        id: authUser.user.id,
        email: input.email,
        name: input.name,
        department: input.department,
        title: input.title,
        role: legacyRoleFromPair(input.permissionRole, input.hierarchyRole),
        permission_role: input.permissionRole,
        hierarchy_role: input.hierarchyRole,
        is_active: input.isActive,
        manager_id: input.managerId,
      },
      { onConflict: 'id' }
    )
    return writeError(error)
  },

  async deleteAccount(actor: Actor, userId: string): Promise<DbWrite> {
    if (!isAdminActor(actor)) return { error: 'You do not have permission to perform this action.' }
    const admin = getAdminClient()
    const { error: tsError } = await admin.from('timesheets').delete().eq('user_id', userId)
    if (tsError) return { error: tsError.message }
    const { error: profileError } = await admin.from('profiles').delete().eq('id', userId)
    if (profileError) return { error: profileError.message }
    const { error: authError } = await admin.auth.admin.deleteUser(userId)
    return authError ? { error: authError.message } : { error: null }
  },
}
