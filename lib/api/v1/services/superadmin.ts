import 'server-only'

import type { HierarchyRole, WhitelistedDomain } from '@/app/types'
import { safeAudit } from '@/lib/audit'
import { isSuperAdmin } from '@/lib/auth/super-admin'
import { operationsDeps } from '@/lib/db/operations'
import { peopleDeps } from '@/lib/db/people'
import { referenceDeps } from '@/lib/db/reference'
import type { Actor } from '@/lib/db/types'
import { resetOperationalData } from '@/lib/domain/operations'
import { deletePersonDomain } from '@/lib/domain/people'
import {
  addTitle,
  addWhitelistedDomain,
  deleteActivityType,
  deleteTitle,
  deleteWhitelistedDomain,
  listWhitelistedDomains,
  reclassifyTitle,
  updateWhitelistedDomain,
} from '@/lib/domain/reference'
import type { MobileServiceResult } from './_result'

type DomainError = { code: string; message: string }

function failure<T>(error: DomainError): MobileServiceResult<T> {
  const status = error.code === 'FORBIDDEN'
    ? 403
    : error.code === 'NOT_FOUND'
      ? 404
      : error.code === 'CONFLICT'
        ? 409
        : error.code === 'STORAGE_ERROR'
          ? 500
          : 400
  return { success: false, code: error.code, message: error.message, status }
}

const acknowledged = (status?: number): MobileServiceResult<{ success: true }> => ({
  success: true,
  data: { success: true },
  ...(status ? { status } : {}),
})

export async function resetDatabaseBrowser(
  actor: Actor,
  mode: 'timesheets' | 'activity' | 'all'
): Promise<MobileServiceResult<{ success: true }>> {
  const result = await resetOperationalData(actor, mode, operationsDeps())
  return result.ok ? acknowledged() : failure(result.error)
}

export async function deleteUserBrowser(
  actor: Actor,
  userId: string
): Promise<MobileServiceResult<{ success: true }>> {
  const result = await deletePersonDomain(actor, userId, peopleDeps())
  return result.ok ? acknowledged() : failure(result.error)
}

export async function deleteActivityTypeBrowser(
  actor: Actor,
  id: string
): Promise<MobileServiceResult<{ success: true }>> {
  if (!isSuperAdmin(actor)) {
    return { success: false, code: 'FORBIDDEN', message: 'Super-admin access required.', status: 403 }
  }
  const result = await deleteActivityType(actor, id, referenceDeps())
  if (!result.ok) return failure(result.error)
  await safeAudit(actor, { action: 'activity_type.delete', targetId: id })
  return acknowledged()
}

export async function listWhitelistedDomainsBrowser(
  actor: Actor
): Promise<MobileServiceResult<WhitelistedDomain[]>> {
  const result = await listWhitelistedDomains(actor, referenceDeps())
  return result.ok ? { success: true, data: result.data } : failure(result.error)
}

export async function addWhitelistedDomainBrowser(
  actor: Actor,
  domain: string,
  autoActivate: boolean
): Promise<MobileServiceResult<{ success: true }>> {
  const result = await addWhitelistedDomain(actor, domain, autoActivate, referenceDeps())
  if (!result.ok) return failure(result.error)
  await safeAudit(actor, {
    action: 'domain.whitelist_add',
    detail: { domain: result.data.domain, autoActivate },
  })
  return acknowledged(201)
}

export async function updateWhitelistedDomainBrowser(
  actor: Actor,
  id: string,
  autoActivate: boolean
): Promise<MobileServiceResult<{ success: true }>> {
  const result = await updateWhitelistedDomain(actor, id, autoActivate, referenceDeps())
  if (!result.ok) return failure(result.error)
  await safeAudit(actor, {
    action: 'domain.whitelist_toggle',
    targetId: id,
    detail: { autoActivate },
  })
  return acknowledged()
}

export async function deleteWhitelistedDomainBrowser(
  actor: Actor,
  id: string
): Promise<MobileServiceResult<{ success: true }>> {
  const result = await deleteWhitelistedDomain(actor, id, referenceDeps())
  if (!result.ok) return failure(result.error)
  await safeAudit(actor, { action: 'domain.whitelist_delete', targetId: id })
  return acknowledged()
}

export async function addTitleBrowser(
  actor: Actor,
  name: string,
  hierarchyRole: HierarchyRole
): Promise<MobileServiceResult<{ success: true }>> {
  const result = await addTitle(actor, name, hierarchyRole, referenceDeps())
  if (!result.ok) return failure(result.error)
  await safeAudit(actor, {
    action: 'title.add',
    detail: { title: name.trim(), hierarchyRole },
  })
  return acknowledged(201)
}

export async function reclassifyTitleBrowser(
  actor: Actor,
  name: string,
  hierarchyRole: HierarchyRole,
  syncUsers: boolean
): Promise<MobileServiceResult<{ affectedCount?: number }>> {
  const clean = name.trim()
  const result = await reclassifyTitle(actor, clean, hierarchyRole, syncUsers, referenceDeps())
  if (!result.ok) return failure(result.error)
  await safeAudit(actor, {
    action: 'title.reclassify',
    detail: { title: clean, hierarchyRole, syncUsers, affectedCount: result.data.affectedCount },
  })
  return { success: true, data: { affectedCount: result.data.affectedCount } }
}

export async function deleteTitleBrowser(
  actor: Actor,
  name: string
): Promise<MobileServiceResult<{ success: true }>> {
  const clean = name.trim()
  const result = await deleteTitle(actor, clean, referenceDeps())
  if (!result.ok) return failure(result.error)
  await safeAudit(actor, { action: 'title.delete', detail: { title: clean } })
  return acknowledged()
}
