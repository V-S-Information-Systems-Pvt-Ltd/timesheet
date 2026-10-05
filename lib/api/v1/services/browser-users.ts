import 'server-only'

import { browserCreateUserSchema, browserUserMutationSchema } from '@vsis/contracts'
import type { Actor } from '@/lib/db/types'
import { peopleDeps } from '@/lib/db/people'
import { isAdminActor } from '@/lib/roles'
import {
  createPersonDomain, togglePersonStatusDomain, updatePersonRolesDomain,
  updatePersonNameDomain, updatePersonDepartmentDomain, setPersonManagerDomain,
  updatePersonHierarchyDomain, type PeopleDomainResult,
} from '@/lib/domain/people'
import type { MobileServiceResult } from './_result'

type Acknowledgement = MobileServiceResult<{ success: true }>

function actorRefusal(actor: Actor): Acknowledgement | null {
  if (!actor.isActive) return { success: false, code: 'FORBIDDEN', message: 'Your account is not active.', status: 403 }
  if (!isAdminActor(actor)) return { success: false, code: 'FORBIDDEN', message: 'You do not have permission to perform this action.', status: 403 }
  return null
}

function acknowledgement(result: PeopleDomainResult<unknown>): Acknowledgement {
  if (result.ok) return { success: true, data: { success: true } }
  const { code, message, details } = result.error
  const status = code === 'FORBIDDEN' ? 403 : code === 'NOT_FOUND' ? 404 : code === 'CONFLICT' ? 409 : 400
  return {
    success: false, code: code === 'STORAGE_ERROR' ? 'BAD_REQUEST' : code,
    message: details?.reason === 'missing_credentials' ? 'Email and a password are required.' : message,
    status,
  }
}

export async function createBrowserUserService(actor: Actor, body: unknown): Promise<Acknowledgement> {
  const refusal = actorRefusal(actor)
  if (refusal) return refusal
  const parsed = browserCreateUserSchema.safeParse(body)
  if (!parsed.success) return { success: false, code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid user input.', status: 400 }
  return acknowledgement(await createPersonDomain(actor, parsed.data, peopleDeps()))
}

export async function mutateBrowserUserService(actor: Actor, userId: string, body: unknown): Promise<Acknowledgement> {
  const refusal = actorRefusal(actor)
  if (refusal) return refusal
  if (!userId) return { success: false, code: 'VALIDATION_ERROR', message: 'User ID is required.', status: 400 }
  const parsed = browserUserMutationSchema.safeParse(body)
  if (!parsed.success) return { success: false, code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid user operation.', status: 400 }
  const input = parsed.data
  const deps = peopleDeps()
  switch (input.operation) {
    case 'toggle-status': return acknowledgement(await togglePersonStatusDomain(actor, userId, deps))
    case 'roles': return acknowledgement(await updatePersonRolesDomain(actor, userId, input.permissionRole, input.hierarchyRole, deps))
    case 'name': return acknowledgement(await updatePersonNameDomain(actor, userId, input.name, deps))
    case 'department': return acknowledgement(await updatePersonDepartmentDomain(actor, userId, input.department, deps))
    case 'manager': return acknowledgement(await setPersonManagerDomain(actor, userId, input.managerId, deps))
    case 'hierarchy': return acknowledgement(await updatePersonHierarchyDomain(actor, userId, {
      managerId: input.managerId, title: input.title, hierarchyRole: input.hierarchyRole,
    }, deps))
  }
}
