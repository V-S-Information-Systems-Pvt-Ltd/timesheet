import 'server-only'

import { query } from '@/lib/db/pool'
import { getAdminClient } from '@/lib/supabase/admin'
import { IS_NATIVE } from '@/lib/backend'
import type { Actor } from '@/lib/db/repository'
import type { HierarchyRole, PermissionRole, UserRole } from '@/app/types'

interface ActorRow {
  id: string
  email: string
  role: UserRole
  permission_role: PermissionRole
  hierarchy_role: HierarchyRole
  is_active: boolean
}

function mapActor(row: ActorRow): Actor {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    permission_role: row.permission_role,
    hierarchy_role: row.hierarchy_role,
    isActive: row.is_active,
  }
}

export async function getMobileActor(userId: string): Promise<Actor | null> {
  if (IS_NATIVE) {
    const rows = await query<ActorRow>(
      'select id, email, role, permission_role, hierarchy_role, is_active from public.profiles where id = $1 limit 1',
      [userId]
    )
    return rows[0] ? mapActor(rows[0]) : null
  }

  const client = getAdminClient() as unknown as {
    from(table: string): {
      select(columns: string): {
        eq(column: string, value: string): {
          maybeSingle(): Promise<{ data: ActorRow | null; error: { message: string } | null }>
        }
      }
    }
  }
  const { data, error } = await client
    .from('profiles')
    .select('id,email,role,permission_role,hierarchy_role,is_active')
    .eq('id', userId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data ? mapActor(data) : null
}
