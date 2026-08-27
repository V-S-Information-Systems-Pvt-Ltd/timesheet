import { repo } from '@/lib/db'
import type { Actor } from '@/lib/db/repository'

export type ServiceResult<T> =
  | { success: true; data: T; status?: number }
  | { success: false; code: string; message: string; status: number }

export async function listPeopleService(actor: Actor): Promise<ServiceResult<unknown>> {
  const profiles = await repo.listProfiles(actor)
  const data = profiles.map((p) => ({
    id: p.id,
    email: p.email,
    name: p.name || p.email,
    role: p.role,
    permissionRole: p.permission_role,
    hierarchyRole: p.hierarchy_role,
    department: p.department,
    title: p.title,
    managerId: p.manager_id,
    isActive: p.is_active ?? true,
  }))

  return { success: true, data }
}
