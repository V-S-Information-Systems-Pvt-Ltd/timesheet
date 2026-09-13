import 'server-only'

import type { ActivityType, HierarchyRole, Project, TitleRecord } from '@/app/types'
import type { Actor } from '@/lib/db/repository'
import { referenceDeps } from '@/lib/db/reference'
import {
  addTitle as addTitleDomain,
  createActivityType as createActivityTypeDomain,
  createProject as createProjectDomain,
  deleteActivityType as deleteActivityTypeDomain,
  deleteProject as deleteProjectDomain,
  deleteTitle as deleteTitleDomain,
  getTitleImpact as getTitleImpactDomain,
  listActivityTypesForAdmin as listActivityTypesForAdminDomain,
  listProjectsForAdmin as listProjectsForAdminDomain,
  listTitleRecords as listTitleRecordsDomain,
  reclassifyTitle as reclassifyTitleDomain,
  updateActivityType as updateActivityTypeDomain,
  updateProject as updateProjectDomain,
  TITLE_NAME_PARAMETER_REQUIRED,
  TITLE_NAME_REQUIRED,
  type CreateActivityTypeInput,
  type CreateProjectInput,
  type ReferenceError,
  type ReferenceErrorCode,
  type UpdateActivityTypePatch,
  type UpdateProjectPatch,
} from '@/lib/domain/reference'
import type { TitleImpact } from '@/lib/domain/reference-port'
import type { MobileServiceResult } from './_result'

// lib/api/v1/services/reference-admin.ts
// Transport-shaped adapters for the `/api/v1/admin` reference-data routes. The
// domain module owns policy/orchestration/validation; these wrappers only map
// the domain result to the released v1 envelope (code/status/message). The
// forbidden wording stays here because the admin routes established a more
// specific audience message than the generic Server Action gate.

const ERROR_ENVELOPE: Record<ReferenceErrorCode, { code: string; status: number }> = {
  FORBIDDEN: { code: 'FORBIDDEN', status: 403 },
  VALIDATION_ERROR: { code: 'VALIDATION_ERROR', status: 400 },
  NOT_FOUND: { code: 'NOT_FOUND', status: 404 },
  CONFLICT: { code: 'CONFLICT', status: 409 },
  BAD_REQUEST: { code: 'BAD_REQUEST', status: 400 },
}

function mapError<T>(error: ReferenceError, forbiddenMessage: string): MobileServiceResult<T> {
  if (error.code === 'FORBIDDEN') {
    return { success: false, code: 'FORBIDDEN', message: forbiddenMessage, status: 403 }
  }
  const envelope = ERROR_ENVELOPE[error.code]
  return { success: false, code: envelope.code, message: error.message, status: envelope.status }
}

// --- projects ---------------------------------------------------------------

export async function listProjectsAdmin(actor: Actor): Promise<MobileServiceResult<Project[]>> {
  const result = await listProjectsForAdminDomain(actor, referenceDeps())
  if (!result.ok) {
    return mapError(result.error, 'Only admins and project managers can view project administration.')
  }
  return { success: true, data: result.data }
}

export async function createProjectAdmin(
  actor: Actor,
  input: CreateProjectInput
): Promise<MobileServiceResult<Project>> {
  const result = await createProjectDomain(actor, input, referenceDeps())
  if (!result.ok) {
    return mapError(result.error, 'Only admins and project managers can create projects.')
  }
  if (!result.data) {
    return { success: false, code: 'CONFLICT', message: 'Failed to create project.', status: 409 }
  }
  return { success: true, data: result.data, status: 201 }
}

export async function updateProjectAdmin(
  actor: Actor,
  id: string,
  patch: UpdateProjectPatch
): Promise<MobileServiceResult<Project>> {
  const result = await updateProjectDomain(actor, id, patch, referenceDeps())
  if (!result.ok) {
    return mapError(result.error, 'Only admins and project managers can modify projects.')
  }
  return { success: true, data: result.data }
}

export async function deleteProjectAdmin(
  actor: Actor,
  id: string
): Promise<MobileServiceResult<{ success: true; id: string }>> {
  const result = await deleteProjectDomain(actor, id, referenceDeps())
  if (!result.ok) {
    return mapError(result.error, 'Only admins and project managers can delete projects.')
  }
  return { success: true, data: { success: true, id } }
}

// --- activity types ---------------------------------------------------------

export async function listActivityTypesAdmin(
  actor: Actor
): Promise<MobileServiceResult<ActivityType[]>> {
  const result = await listActivityTypesForAdminDomain(actor, referenceDeps())
  if (!result.ok) {
    return mapError(result.error, 'Only admins can view activity type administration.')
  }
  return { success: true, data: result.data }
}

export async function createActivityTypeAdmin(
  actor: Actor,
  input: CreateActivityTypeInput
): Promise<MobileServiceResult<ActivityType>> {
  const result = await createActivityTypeDomain(actor, input, referenceDeps())
  if (!result.ok) {
    return mapError(result.error, 'Only admins can create activity types.')
  }
  if (!result.data) {
    return {
      success: false,
      code: 'CONFLICT',
      message: 'Failed to create activity type.',
      status: 409,
    }
  }
  return { success: true, data: result.data, status: 201 }
}

export async function updateActivityTypeAdmin(
  actor: Actor,
  id: string,
  patch: UpdateActivityTypePatch
): Promise<MobileServiceResult<ActivityType>> {
  const result = await updateActivityTypeDomain(actor, id, patch, referenceDeps())
  if (!result.ok) {
    return mapError(result.error, 'Only admins can modify activity types.')
  }
  return { success: true, data: result.data }
}

export async function deleteActivityTypeAdmin(
  actor: Actor,
  id: string
): Promise<MobileServiceResult<{ success: true; id: string }>> {
  const result = await deleteActivityTypeDomain(actor, id, referenceDeps())
  if (!result.ok) {
    return mapError(result.error, 'Only admins can delete activity types.')
  }
  return { success: true, data: { success: true, id } }
}

// --- titles -----------------------------------------------------------------

export async function listTitleRecordsAdmin(actor: Actor): Promise<MobileServiceResult<TitleRecord[]>> {
  const result = await listTitleRecordsDomain(actor, referenceDeps())
  if (!result.ok) {
    return mapError(result.error, 'You do not have permission to perform this action.')
  }
  return { success: true, data: result.data }
}

export async function addTitleAdmin(
  actor: Actor,
  name: string,
  hierarchyRole: HierarchyRole
): Promise<MobileServiceResult<TitleRecord>> {
  const result = await addTitleDomain(actor, name, hierarchyRole, referenceDeps())
  if (!result.ok) {
    return mapError(result.error, 'Super-admin access required to create title definitions.')
  }
  if (!result.data) {
    return { success: false, code: 'INTERNAL_ERROR', message: 'Internal server error.', status: 500 }
  }
  return { success: true, data: result.data, status: 201 }
}

export async function reclassifyTitleAdmin(
  actor: Actor,
  name: string,
  hierarchyRole: HierarchyRole,
  syncUsers: boolean
): Promise<MobileServiceResult<{ name: string; hierarchyRole: HierarchyRole; affectedCount?: number }>> {
  // The domain persists the trimmed name; echo the same value the previous
  // route returned so a padded request body cannot change the response.
  const cleanName = name.trim()
  const result = await reclassifyTitleDomain(actor, cleanName, hierarchyRole, syncUsers, referenceDeps())
  if (!result.ok) {
    return mapError(result.error, 'Super-admin access required to reclassify title definitions.')
  }
  return { success: true, data: { name: cleanName, hierarchyRole, affectedCount: result.data.affectedCount } }
}

export async function deleteTitleAdmin(
  actor: Actor,
  name: string
): Promise<MobileServiceResult<{ success: true; name: string }>> {
  const result = await deleteTitleDomain(actor, name, referenceDeps())
  if (!result.ok) {
    return mapError(result.error, 'Super-admin access required to delete title definitions.')
  }
  return { success: true, data: { success: true, name } }
}

export async function getTitleImpactAdmin(
  actor: Actor,
  name: string,
  proposedRole?: HierarchyRole
): Promise<MobileServiceResult<TitleImpact>> {
  const result = await getTitleImpactDomain(actor, name, proposedRole, referenceDeps())
  if (!result.ok) {
    // The admin route historically reported an empty name with a query-specific
    // message; translate the shared validation message to keep the wire body.
    if (result.error.code === 'VALIDATION_ERROR' && result.error.message === TITLE_NAME_REQUIRED) {
      return {
        success: false,
        code: 'VALIDATION_ERROR',
        message: TITLE_NAME_PARAMETER_REQUIRED,
        status: 400,
      }
    }
    return mapError(result.error, 'Super-admin access required to check title impact.')
  }
  return { success: true, data: result.data }
}
