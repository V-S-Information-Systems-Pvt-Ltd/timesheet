// lib/db/native/reference.ts
// Native PostgreSQL implementation of ReferencePersistence.
import 'server-only'

import { query, getPool, transaction } from '@/lib/db/pool'
import { hasPermission, HIERARCHY_ROLES, isOrgAdmin } from '@/lib/roles'
import type { ActivityType, Department, HierarchyRole, Project, TitleRecord, WhitelistedDomain } from '@/app/types'
import type {
  Actor,
  CreateProjectOptions,
  DbCreateResult,
  DbWrite,
} from '@/lib/db/types'
import { DEPARTMENT_FORBIDDEN, type ReferencePersistence, type TitleImpact } from '@/lib/domain/reference-port'

interface ProjectRow {
  id: string
  name: string
  so_number: string | null
  is_timesheet_project: boolean
  created_at: string
}

interface ActivityTypeRow {
  id: string
  name: string
  is_active: boolean
  created_at: string
  entry_type: 'project' | 'support' | 'internal' | null
  code: string | null
}

const ACTIVITY_TYPE_COLS = 'id, name, is_active, created_at::text as created_at, entry_type, code'

/** Stable code for a new catalogue activity: a slug of its name. */
export function activityCodeFromName(name: string): string {
  return name.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 50) || 'activity'
}

interface WhitelistedDomainRow {
  id: string
  domain: string
  auto_activate: boolean
  created_at: string
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

async function writeReturning<T>(
  sql: string,
  params?: unknown[]
): Promise<DbCreateResult<T>> {
  try {
    const rows = await query<T>(sql, params)
    if (!rows[0]) {
      return { data: null, error: 'Record could not be created.' }
    }
    return { data: rows[0], error: null }
  } catch (err) {
    return { data: null, error: friendlyWriteError(err) }
  }
}

export const nativeReferencePersistence: ReferencePersistence = {
  // --- projects ---

  async listProjects(_actor: Actor): Promise<Project[]> {
    const rows = await query<ProjectRow>(
      'select id, name, so_number, is_timesheet_project, created_at from public.projects order by name'
    )
    return rows as Project[]
  },

  async createProject(
    actor: Actor,
    nameOrInput: string | { name: string; soNumber?: string | null },
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
    return writeReturning<Project>(
      'insert into public.projects (name, so_number) values ($1, $2) returning id, name, so_number, is_timesheet_project, created_at::text as created_at',
      [name, soNumber]
    )
  },

  async renameProject(actor: Actor, id: string, name: string): Promise<DbWrite> {
    if (!hasPermission(actor, ['admin', 'pm'])) {
      return { error: 'You do not have permission to perform this action.' }
    }
    return write('update public.projects set name = $1 where id = $2', [name, id])
  },

  async setProjectSO(actor: Actor, id: string, soNumber: string | null): Promise<DbWrite> {
    if (!hasPermission(actor, ['admin', 'pm'])) {
      return { error: 'You do not have permission to perform this action.' }
    }
    return write('update public.projects set so_number = $1 where id = $2', [soNumber, id])
  },

  async deleteProject(actor: Actor, id: string): Promise<DbWrite> {
    if (!hasPermission(actor, ['admin', 'pm'])) {
      return { error: 'You do not have permission to perform this action.' }
    }
    const counts = await query<{ c: number }>(
      'select count(*)::int as c from public.timesheets where project_id = $1',
      [id]
    )
    const count = counts[0]?.c ?? 0
    if (count > 0) {
      return { error: `Cannot delete: ${count} entries reference this project.` }
    }
    return write('delete from public.projects where id = $1', [id])
  },

  // --- activity types ---

  async listActivityTypes(_actor: Actor): Promise<ActivityType[]> {
    const rows = await query<ActivityTypeRow>(
      `select ${ACTIVITY_TYPE_COLS} from public.activity_types where is_active = true order by name`
    )
    return rows as ActivityType[]
  },

  async listAllActivityTypes(_actor: Actor): Promise<ActivityType[]> {
    const rows = await query<ActivityTypeRow>(
      `select ${ACTIVITY_TYPE_COLS} from public.activity_types order by entry_type nulls first, name`
    )
    return rows as ActivityType[]
  },

  async createActivityType(
    actor: Actor,
    name: string,
    entryType?: 'project' | 'internal' | null
  ): Promise<DbCreateResult<ActivityType>> {
    if (!hasPermission(actor, ['admin', 'pm'])) {
      return { data: null, error: 'You do not have permission to perform this action.' }
    }
    const clean = name.trim()
    if (!clean) return { data: null, error: 'Activity type name is required.' }
    if (entryType) {
      return writeReturning<ActivityType>(
        `insert into public.activity_types (entry_type, code, name) values ($1, $2, $3) returning ${ACTIVITY_TYPE_COLS}`,
        [entryType, activityCodeFromName(clean), clean]
      )
    }
    return writeReturning<ActivityType>(
      `insert into public.activity_types (name) values ($1) returning ${ACTIVITY_TYPE_COLS}`,
      [clean]
    )
  },

  async renameActivityType(actor: Actor, id: string, name: string): Promise<DbWrite> {
    if (!hasPermission(actor, ['admin', 'pm'])) {
      return { error: 'You do not have permission to perform this action.' }
    }
    return write("update public.activity_types set name = $1 where id = $2 and entry_type is distinct from 'support'", [name, id])
  },

  async setActivityTypeActive(actor: Actor, id: string, isActive: boolean): Promise<DbWrite> {
    if (!hasPermission(actor, ['admin', 'pm'])) {
      return { error: 'You do not have permission to perform this action.' }
    }
    // Support activities are fixed: they back required form branches.
    return write("update public.activity_types set is_active = $1 where id = $2 and entry_type is distinct from 'support'", [isActive, id])
  },

  async deleteActivityType(actor: Actor, id: string): Promise<DbWrite> {
    if (!hasPermission(actor, ['admin', 'pm'])) {
      return { error: 'You do not have permission to perform this action.' }
    }
    return write('delete from public.activity_types where id = $1', [id])
  },

  // --- departments ---

  async listDepartments(): Promise<Department[]> {
    return query<Department>(
      `select d.id, d.name, d.created_at::text as created_at,
              (select count(*) from public.profiles p where p.department = d.name)::int as member_count
       from public.departments d order by lower(d.name)`
    )
  },

  async createDepartment(actor: Actor, name: string): Promise<DbCreateResult<Department>> {
    if (!isOrgAdmin(actor)) return { data: null, error: DEPARTMENT_FORBIDDEN }
    return writeReturning<Department>(
      'insert into public.departments (name) values ($1) returning id, name, created_at::text as created_at, 0 as member_count',
      [name.trim()]
    )
  },

  /** Renames the department and every profile and admin scope that uses it. */
  async renameDepartment(actor: Actor, id: string, name: string): Promise<DbWrite> {
    if (!isOrgAdmin(actor)) return { error: DEPARTMENT_FORBIDDEN }
    const clean = name.trim()
    try {
      return await transaction(async client => {
        const current = await client.query<{ name: string }>('select name from public.departments where id = $1 for update', [id])
        if (!current.rows[0]) return { error: 'Department not found.' }
        const old = current.rows[0].name
        await client.query('update public.departments set name = $1 where id = $2', [clean, id])
        await client.query('update public.profiles set department = $1 where department = $2', [clean, old])
        await client.query(
          'update public.profiles set scope_departments = array_replace(scope_departments, $2, $1) where $2 = any(scope_departments)',
          [clean, old]
        )
        return { error: null }
      })
    } catch (err) {
      return { error: friendlyWriteError(err) }
    }
  },

  /** Only a department with no members and no admin scope can be deleted. */
  async deleteDepartment(actor: Actor, id: string): Promise<DbWrite> {
    if (!isOrgAdmin(actor)) return { error: DEPARTMENT_FORBIDDEN }
    try {
      return await transaction(async client => {
        const current = await client.query<{ name: string; members: number }>(
          `select d.name, (select count(*) from public.profiles p where p.department = d.name)::int as members
           from public.departments d where d.id = $1 for update`,
          [id]
        )
        const row = current.rows[0]
        if (!row) return { error: 'Department not found.' }
        if (row.members > 0) return { error: `Move the ${row.members} member(s) of ${row.name} to another department first.` }
        // Removing a scope's last department would leave that admin unrestricted.
        const scoped = await client.query<{ n: number }>('select count(*)::int as n from public.profiles where $1 = any(scope_departments)', [row.name])
        if ((scoped.rows[0]?.n ?? 0) > 0) return { error: `Remove ${row.name} from admin department access first.` }
        await client.query('delete from public.departments where id = $1', [id])
        return { error: null }
      })
    } catch (err) {
      return { error: friendlyWriteError(err) }
    }
  },

  // --- titles ---

  async listTitles(): Promise<string[]> {
    const rows = await query<{ name: string }>(
      'select name from public.titles order by name asc'
    )
    return rows.map((r) => r.name)
  },

  async listTitleRecords(): Promise<TitleRecord[]> {
    const rows = await query<TitleRecord>(
      'select id, name, hierarchy_role, created_at from public.titles order by name asc'
    )
    return rows
  },

  async addTitle(
    actor: Actor,
    name: string,
    hierarchyRole: HierarchyRole = 'user'
  ): Promise<DbCreateResult<TitleRecord>> {
    if (!isOrgAdmin(actor)) {
      return { data: null, error: 'You do not have permission to manage titles.' }
    }
    const clean = name.trim()
    if (!clean) return { data: null, error: 'Title name is required.' }
    if (!HIERARCHY_ROLES.includes(hierarchyRole)) {
      return { data: null, error: 'Invalid hierarchy role.' }
    }
    return writeReturning<TitleRecord>(
      `insert into public.titles (name, hierarchy_role) values ($1, $2)
       on conflict (name) do update set hierarchy_role = excluded.hierarchy_role
       returning id, name, hierarchy_role, created_at::text as created_at`,
      [clean, hierarchyRole]
    )
  },

  async deleteTitle(actor: Actor, name: string): Promise<DbWrite> {
    if (!isOrgAdmin(actor)) {
      return { error: 'You do not have permission to manage titles.' }
    }
    const clean = name.trim()
    return write('delete from public.titles where lower(name) = lower($1)', [clean])
  },

  async reclassifyTitle(
    actor: Actor,
    name: string,
    hierarchyRole: HierarchyRole,
    syncUsers = false
  ): Promise<{ error: string | null; affectedCount?: number }> {
    if (!isOrgAdmin(actor)) {
      return { error: 'You do not have permission to manage titles.' }
    }
    const clean = name.trim()
    if (!clean) return { error: 'Title name is required.' }
    if (!HIERARCHY_ROLES.includes(hierarchyRole)) {
      return { error: 'Invalid hierarchy role.' }
    }
    const pool = getPool()
    const client = await pool.connect()
    try {
      await client.query('begin')

      const titleRes = await client.query<{ name: string; hierarchy_role: string }>(
        'select name, hierarchy_role from public.titles where lower(name) = lower($1) for update',
        [clean]
      )
      if (titleRes.rows.length === 0) {
        await client.query('rollback')
        return { error: `Title "${clean}" not found.` }
      }

      const profilesRes = await client.query<{ id: string }>(
        'select id from public.profiles where lower(title) = lower($1) for update',
        [clean]
      )
      const affectedCount = profilesRes.rows.length

      await client.query(
        'update public.titles set hierarchy_role = $1 where lower(name) = lower($2)',
        [hierarchyRole, clean]
      )

      if (syncUsers && affectedCount > 0) {
        const legacy = hierarchyRole === 'manager' || hierarchyRole === 'team_lead' ? hierarchyRole : 'user'
        await client.query(
          `update public.profiles
           set hierarchy_role = $1,
               role = case when permission_role in ('admin', 'pm', 'co') then permission_role else $2 end
           where lower(title) = lower($3)`,
          [hierarchyRole, legacy, clean]
        )
      }

      await client.query('commit')
      return { error: null, affectedCount }
    } catch (err) {
      await client.query('rollback')
      return { error: err instanceof Error ? err.message : 'Failed to reclassify title.' }
    } finally {
      client.release()
    }
  },

  async getTitleImpact(
    actor: Actor,
    name: string,
    proposedRole?: HierarchyRole
  ): Promise<TitleImpact | { error: string }> {
    if (!isOrgAdmin(actor)) {
      return { error: 'You do not have permission to manage titles.' }
    }
    const clean = name.trim()
    if (!clean) return { error: 'Title name is required.' }

    const titleRows = await query<{ name: string; hierarchy_role: string }>(
      'select name, hierarchy_role from public.titles where lower(name) = lower($1) limit 1',
      [clean]
    )
    if (titleRows.length === 0) {
      return { error: `Title "${clean}" not found.` }
    }
    const currentHierarchyRole = (titleRows[0].hierarchy_role || 'user') as HierarchyRole
    const proposed = proposedRole && HIERARCHY_ROLES.includes(proposedRole) ? proposedRole : currentHierarchyRole

    const affectedRows = await query<{ count: string }>(
      'select count(*)::text as count from public.profiles where lower(title) = lower($1)',
      [clean]
    )
    const affectedCount = parseInt(affectedRows[0]?.count || '0', 10)
    const syncRequired = affectedCount > 0 && currentHierarchyRole !== proposed

    return {
      title: titleRows[0].name,
      currentHierarchyRole,
      proposedHierarchyRole: proposed,
      affectedCount,
      syncRequired,
    }
  },

  // --- email domain whitelist ---

  async listWhitelistedDomains(_actor?: Actor): Promise<WhitelistedDomain[]> {
    const rows = await query<WhitelistedDomainRow>(
      'select id, domain, auto_activate, created_at from public.whitelisted_domains order by domain asc'
    )
    return rows as WhitelistedDomain[]
  },

  async addWhitelistedDomain(actor: Actor, domain: string, autoActivate: boolean): Promise<DbWrite> {
    if (!isOrgAdmin(actor)) {
      return { error: 'You do not have permission to manage email domains.' }
    }
    const clean = domain.trim().toLowerCase().replace(/^@/, '')
    if (!clean) return { error: 'Domain name is required.' }
    return write(
      'insert into public.whitelisted_domains (domain, auto_activate) values ($1, $2)',
      [clean, autoActivate]
    )
  },

  async updateWhitelistedDomain(actor: Actor, id: string, autoActivate: boolean): Promise<DbWrite> {
    if (!isOrgAdmin(actor)) {
      return { error: 'You do not have permission to manage email domains.' }
    }
    return write(
      'update public.whitelisted_domains set auto_activate = $1 where id = $2',
      [autoActivate, id]
    )
  },

  async deleteWhitelistedDomain(actor: Actor, id: string): Promise<DbWrite> {
    if (!isOrgAdmin(actor)) {
      return { error: 'You do not have permission to manage email domains.' }
    }
    return write('delete from public.whitelisted_domains where id = $1', [id])
  },
}
