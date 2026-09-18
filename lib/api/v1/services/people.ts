import 'server-only'

import type { Actor } from '@/lib/db/repository'
import type { User } from '@/app/types'
import type { PersonProfileDto } from '@/lib/api/v1/contracts'
import type { MobileServiceResult } from './_result'
import { peopleDeps } from '@/lib/db/people'
import { listPeopleDomain } from '@/lib/domain/people'

/** Row-to-DTO mapping stays in the transport, never in the domain/ports. */
export function toPersonProfileDto(p: User): PersonProfileDto {
  return {
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
  }
}

/**
 * Mobile team-people projection. Authorization (manager/team-lead visibility and
 * admin/co "see all") is owned by the people application service; this transport
 * only maps the domain profiles to the released wire DTO.
 */
export async function listPeopleService(
  actor: Actor
): Promise<MobileServiceResult<PersonProfileDto[]>> {
  const result = await listPeopleDomain(actor, peopleDeps())
  if (!result.ok) {
    if (result.error.code === 'FORBIDDEN') {
      return {
        success: false,
        code: 'FORBIDDEN',
        message: 'You do not have permission to view team profiles.',
        status: 403,
      }
    }
    return { success: false, code: 'INTERNAL_ERROR', message: result.error.message, status: 500 }
  }

  return { success: true, data: result.data.map(toPersonProfileDto) }
}
