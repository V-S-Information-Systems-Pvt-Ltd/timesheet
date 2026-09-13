import { repo } from '@/lib/db'
import type { Actor } from '@/lib/db/repository'
import { canViewTeamActor } from '@/lib/roles'
import type { PersonProfileDto } from '@/lib/api/v1/contracts'
import type { MobileServiceResult } from './_result'

export async function listPeopleService(actor: Actor): Promise<MobileServiceResult<PersonProfileDto[]>> {
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
