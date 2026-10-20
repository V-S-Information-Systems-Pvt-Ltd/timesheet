import 'server-only'

import type { Department } from '@/app/types'
import { safeAudit } from '@/lib/audit'
import { peopleDeps } from '@/lib/db/people'
import { referenceDeps } from '@/lib/db/reference'
import type { Actor } from '@/lib/db/types'
import { createDepartment, deleteDepartment, listDepartments, renameDepartment } from '@/lib/domain/reference'
import type { MobileServiceResult } from './_result'

type DomainError = { code: string; message: string }

function failure<T>(error: DomainError): MobileServiceResult<T> {
  const status = error.code === 'FORBIDDEN' ? 403 : error.code === 'CONFLICT' ? 409 : 400
  return { success: false, code: error.code, message: error.message, status }
}

const acknowledged: MobileServiceResult<{ success: true }> = { success: true, data: { success: true } }

export async function listDepartmentsService(actor: Actor): Promise<MobileServiceResult<Department[]>> {
  const result = await listDepartments(actor, referenceDeps())
  return result.ok ? { success: true, data: result.data } : failure(result.error)
}

export async function createDepartmentService(actor: Actor, name: string): Promise<MobileServiceResult<Department>> {
  const result = await createDepartment(actor, name, referenceDeps())
  if (!result.ok) return failure(result.error)
  if (!result.data) return { success: false, code: 'INTERNAL_ERROR', message: 'Internal server error.', status: 500 }
  await safeAudit(actor, { action: 'department.create', targetId: result.data.id, detail: { name: result.data.name } })
  return { success: true, data: result.data, status: 201 }
}

export async function renameDepartmentService(actor: Actor, id: string, name: string): Promise<MobileServiceResult<{ success: true }>> {
  const result = await renameDepartment(actor, id, name, referenceDeps())
  if (!result.ok) return failure(result.error)
  await safeAudit(actor, { action: 'department.rename', targetId: id, detail: { name: name.trim() } })
  return acknowledged
}

export async function deleteDepartmentService(actor: Actor, id: string): Promise<MobileServiceResult<{ success: true }>> {
  const result = await deleteDepartment(actor, id, referenceDeps())
  if (!result.ok) return failure(result.error)
  await safeAudit(actor, { action: 'department.delete', targetId: id })
  return acknowledged
}

/** Sets which departments an admin/CO is limited to; an empty list removes the limit. */
export async function setDepartmentScopeService(actor: Actor, userId: string, departments: string[]): Promise<MobileServiceResult<{ success: true }>> {
  const result = await peopleDeps().persistence.setDepartmentScope(actor, userId, departments)
  if (result.error) {
    const forbidden = result.error.startsWith('Only admins')
    return { success: false, code: forbidden ? 'FORBIDDEN' : 'VALIDATION_ERROR', message: result.error, status: forbidden ? 403 : 400 }
  }
  await safeAudit(actor, { action: 'user.department_scope', targetId: userId, detail: { departments } })
  return acknowledged
}
