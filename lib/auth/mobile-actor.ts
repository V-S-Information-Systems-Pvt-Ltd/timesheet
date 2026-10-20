import 'server-only'

import { query } from '@/lib/db/pool'
import type { Actor } from '@/lib/db/types'
import type { HierarchyRole, PermissionRole, UserRole } from '@/app/types'

interface ActorRow {
  id: string
  email: string
  role: UserRole
  permission_role: PermissionRole
  hierarchy_role: HierarchyRole
  is_active: boolean
  scope_departments: string[] | null
}

function mapActor(row: ActorRow): Actor {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    permission_role: row.permission_role,
    hierarchy_role: row.hierarchy_role,
    scope_departments: row.scope_departments,
    isActive: row.is_active,
  }
}

export async function getMobileActor(userId: string): Promise<Actor | null> {
  const rows = await query<ActorRow>(
    'select id, email, role, permission_role, hierarchy_role, is_active, scope_departments from public.profiles where id = $1 limit 1',
    [userId]
  )
  return rows[0] ? mapActor(rows[0]) : null
}
