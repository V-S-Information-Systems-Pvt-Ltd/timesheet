import 'server-only'

import type {
  AdminDashboardLayout,
  DashboardLayout,
  HierarchyRole,
  MobileLayout,
  PermissionRole,
  TitleRecord,
  User,
  UserRole,
} from '@/app/types'
import { canSeeAllActor, isAdminActor, isLeaderActor, legacyRoleFromPair } from '@/lib/roles'
import { hashPassword } from '@/lib/auth/password'
import { query } from '../pool'
import type { Actor, CreateUserInput, DbWrite, UpdateUserInput } from '../repository'
import type { PeopleIdentity, PeoplePersistence } from '@/lib/domain/people-port'

interface ProfileRow {
  id: string
  email: string
  name: string
  department: string
  title: string
  role: UserRole
  permission_role: PermissionRole
  hierarchy_role: HierarchyRole
  is_active: boolean
  manager_id: string | null
  dashboard_layout: DashboardLayout | null
  admin_layout: AdminDashboardLayout | null
  mobile_layout: MobileLayout | null
  created_at: string
}

const PROFILE_COLS =
  'id, email, name, department, title, role, permission_role, hierarchy_role, is_active, manager_id, dashboard_layout, admin_layout, mobile_layout, created_at'

function mapProfile(r: ProfileRow): User {
  return {
    id: r.id,
    email: r.email,
    name: r.name,
    department: r.department,
    title: r.title,
    role: r.role,
    permission_role: r.permission_role,
    hierarchy_role: r.hierarchy_role,
    is_active: r.is_active,
    manager_id: r.manager_id ?? null,
    dashboard_layout: r.dashboard_layout ?? null,
    admin_layout: r.admin_layout ?? null,
    mobile_layout: r.mobile_layout ?? null,
    created_at: r.created_at,
  }
}

function friendlyWriteError(err: unknown): string {
  const e = err as { code?: string; constraint?: string } | null
  if (e?.code === '23505') {
    return 'A record with that value already exists.'
  }
  if (e?.code === '23503') {
    return 'This record is referenced by other data and cannot be changed.'
  }
  return 'Something went wrong. Please try again.'
}

async function write(sql: string, params?: unknown[]): Promise<DbWrite> {
  try {
    await query(sql, params)
    return { error: null }
  } catch (err) {
    return { error: friendlyWriteError(err) }
  }
}

export interface NativePeoplePersistence extends PeoplePersistence {
  getProfileByEmail(email: string): Promise<User | null>
}

export const nativePeoplePersistence: NativePeoplePersistence = {
  async getProfileById(id: string): Promise<User | null> {
    const rows = await query<ProfileRow>(
      `select ${PROFILE_COLS} from public.profiles where id = $1`,
      [id]
    )
    return rows[0] ? mapProfile(rows[0]) : null
  },

  async getProfileByEmail(email: string): Promise<User | null> {
    const rows = await query<ProfileRow>(
      `select ${PROFILE_COLS} from public.profiles where email = $1`,
      [email]
    )
    return rows[0] ? mapProfile(rows[0]) : null
  },

  async listProfiles(actor: Actor): Promise<User[]> {
    if (canSeeAllActor(actor)) {
      const rows = await query<ProfileRow>(
        `select ${PROFILE_COLS} from public.profiles order by lower(email) limit 500`
      )
      return rows.map(mapProfile)
    }
    if (isLeaderActor(actor)) {
      const rows = await query<ProfileRow>(
        `select ${PROFILE_COLS} from public.profiles
         where id = $1 or id = any(public.team_ids($1))
         order by lower(email) limit 500`,
        [actor.id]
      )
      return rows.map(mapProfile)
    }
    return []
  },

  async updateUserStatus(actor: Actor, userId: string, isActive: boolean): Promise<DbWrite> {
    if (!isAdminActor(actor)) return { error: 'You do not have permission to perform this action.' }
    return write('update public.profiles set is_active = $1 where id = $2', [isActive, userId])
  },

  async updateUserRoles(
    actor: Actor,
    userId: string,
    permissionRole: PermissionRole,
    hierarchyRole: HierarchyRole
  ): Promise<DbWrite> {
    if (!isAdminActor(actor)) return { error: 'You do not have permission to perform this action.' }
    const role = legacyRoleFromPair(permissionRole, hierarchyRole)
    return write(
      'update public.profiles set permission_role = $1, hierarchy_role = $2, role = $3 where id = $4',
      [permissionRole, hierarchyRole, role, userId]
    )
  },

  async updateMyProfile(actor: Actor, input: { department: string; title: string }): Promise<DbWrite> {
    const cleanTitle = (input.title || '').trim()
    if (cleanTitle) {
      const titleRows = await query<{ hierarchy_role: HierarchyRole }>(
        'select hierarchy_role from public.titles where lower(name) = lower($1)',
        [cleanTitle]
      )
      if (titleRows[0] && titleRows[0].hierarchy_role !== actor.hierarchy_role) {
        return {
          error: `Cannot change to title "${cleanTitle}" because it belongs to the "${titleRows[0].hierarchy_role}" hierarchy role. Changing hierarchy roles requires an administrator.`,
        }
      }
    }
    return write(
      'update public.profiles set department = $1, title = $2 where id = $3',
      [input.department, cleanTitle, actor.id]
    )
  },

  async updateUserName(actor: Actor, userId: string, name: string): Promise<DbWrite> {
    if (!isAdminActor(actor)) return { error: 'You do not have permission to perform this action.' }
    return write('update public.profiles set name = $1 where id = $2', [name, userId])
  },

  async updateUserManager(actor: Actor, userId: string, managerId: string | null): Promise<DbWrite> {
    if (!isAdminActor(actor)) return { error: 'You do not have permission to perform this action.' }
    return write('update public.profiles set manager_id = $1 where id = $2', [managerId, userId])
  },

  async updateUser(actor: Actor, userId: string, input: UpdateUserInput): Promise<DbWrite> {
    if (!isAdminActor(actor)) return { error: 'You do not have permission to perform this action.' }

    const rows = await query<ProfileRow>(
      'select id, name, department, title, role, permission_role, hierarchy_role, is_active, manager_id from public.profiles where id = $1',
      [userId]
    )
    if (!rows[0]) {
      return { error: 'User not found.' }
    }
    const current = rows[0]

    const sets: string[] = []
    const params: unknown[] = []

    if (input.name !== undefined) {
      sets.push(`name = $${params.length + 1}`)
      params.push(input.name.trim())
    }
    if (input.department !== undefined) {
      sets.push(`department = $${params.length + 1}`)
      params.push(input.department ? input.department.trim() : null)
    }
    if (input.title !== undefined) {
      sets.push(`title = $${params.length + 1}`)
      params.push(input.title ? input.title.trim() : null)
    }
    if (input.isActive !== undefined) {
      sets.push(`is_active = $${params.length + 1}`)
      params.push(input.isActive)
    }
    if (input.managerId !== undefined) {
      sets.push(`manager_id = $${params.length + 1}`)
      params.push(input.managerId ? input.managerId.trim() : null)
    }

    const nextPermRole = input.permissionRole ?? current.permission_role
    const nextHierRole = input.hierarchyRole ?? current.hierarchy_role
    if (input.permissionRole !== undefined) {
      sets.push(`permission_role = $${params.length + 1}`)
      params.push(input.permissionRole)
    }
    if (input.hierarchyRole !== undefined) {
      sets.push(`hierarchy_role = $${params.length + 1}`)
      params.push(input.hierarchyRole)
    }
    if (input.permissionRole !== undefined || input.hierarchyRole !== undefined) {
      const nextLegacyRole = legacyRoleFromPair(nextPermRole, nextHierRole)
      sets.push(`role = $${params.length + 1}`)
      params.push(nextLegacyRole)
    }

    if (sets.length === 0) {
      return { error: null }
    }

    params.push(userId)
    return write(
      `update public.profiles set ${sets.join(', ')} where id = $${params.length}`,
      params
    )
  },

  async updateUserHierarchy(
    actor: Actor,
    userId: string,
    data: { managerId: string | null; title?: string; hierarchyRole?: HierarchyRole }
  ): Promise<DbWrite> {
    if (!isAdminActor(actor)) {
      return { error: 'You do not have permission to update hierarchy.' }
    }

    const sets: string[] = []
    const params: unknown[] = []

    sets.push(`manager_id = $${params.length + 1}`)
    params.push(data.managerId ?? null)

    if (data.title !== undefined) {
      sets.push(`title = $${params.length + 1}`)
      params.push(data.title.trim())
    }

    if (data.hierarchyRole !== undefined) {
      const rows = await query<{ permission_role: PermissionRole }>(
        'select permission_role from public.profiles where id = $1',
        [userId]
      )
      const permission = rows[0]?.permission_role ?? 'user'
      const legacy = legacyRoleFromPair(permission, data.hierarchyRole)
      sets.push(`hierarchy_role = $${params.length + 1}`)
      params.push(data.hierarchyRole)
      sets.push(`role = $${params.length + 1}`)
      params.push(legacy)
    }

    params.push(userId)
    return write(
      `update public.profiles set ${sets.join(', ')} where id = $${params.length}`,
      params
    )
  },

  async listTitleRecords(): Promise<TitleRecord[]> {
    const rows = await query<TitleRecord>(
      'select id, name, hierarchy_role, created_at from public.titles order by name asc'
    )
    return rows
  },

  async writeAuditLog(
    actor: Actor,
    input: { action: string; targetId?: string | null; detail?: Record<string, unknown> | null }
  ): Promise<DbWrite> {
    return write(
      `insert into public.audit_logs (actor_id, actor_email, action, target_id, detail)
       values ($1, $2, $3, $4, $5)`,
      [actor.id, actor.email, input.action, input.targetId ?? null, input.detail ? JSON.stringify(input.detail) : null]
    )
  },
}

export const nativePeopleIdentity: PeopleIdentity = {
  async createAccount(actor: Actor, input: CreateUserInput): Promise<DbWrite> {
    if (!isAdminActor(actor)) return { error: 'You do not have permission to perform this action.' }
    const createdDomain = input.email.split('@')[1]?.toLowerCase()
    if (createdDomain) {
      const rows = await query<{ id: string }>(
        'select id from public.whitelisted_domains where lower(domain) = $1 limit 1',
        [createdDomain]
      ).catch(() => [])
      if (!rows[0]) {
        return {
          error: `User creation is restricted to approved email domains. Add @${createdDomain} to the whitelist first.`,
        }
      }
    }
    const passwordHash = await hashPassword(input.password)
    const role = legacyRoleFromPair(input.permissionRole, input.hierarchyRole)
    return write(
      `insert into public.profiles (email, name, department, title, role, permission_role, hierarchy_role, is_active, manager_id, password_hash)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        input.email,
        input.name,
        input.department,
        input.title,
        role,
        input.permissionRole,
        input.hierarchyRole,
        input.isActive,
        input.managerId,
        passwordHash,
      ]
    )
  },

  async deleteAccount(actor: Actor, userId: string): Promise<DbWrite> {
    if (!isAdminActor(actor)) return { error: 'You do not have permission to perform this action.' }
    return write('delete from public.profiles where id = $1', [userId])
  },
}
