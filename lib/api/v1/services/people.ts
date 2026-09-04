import { repo } from '@/lib/db'
import type { Actor } from '@/lib/db/repository'
import { canViewTeamActor } from '@/lib/roles'
import type { PersonProfileDto } from '@/lib/api/v1/contracts'

export type ServiceResult<T> =
  | { success: true; data: T; status?: number }
  | { success: false; code: string; message: string; status: number }

export async function listPeopleService(actor: Actor): Promise<ServiceResult<PersonProfileDto[]>> {
  if (!canViewTeamActor(actor)) {
    return {
      success: false,
      code: 'FORBIDDEN',
      message: 'You do not have permission to view team profiles.',
      status: 403,
    }
  }

  const profiles = await repo.listProfiles(actor)
  const data: PersonProfileDto[] = profiles.map((p) => ({
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
