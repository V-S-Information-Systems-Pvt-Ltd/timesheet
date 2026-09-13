import 'server-only'

import { workspaceDeps } from '@/lib/db/workspace'
import {
  getMobileLayoutState,
  resetMobileLayout,
  saveMobileLayout,
  getDefaultMobileLayout,
  resetDefaultMobileLayout,
  saveDefaultMobileLayout,
  type MobileLayoutState,
  type SavedMobileLayout,
  type WorkspaceDomainError,
} from '@/lib/domain/workspace'
import type { Actor } from '@/lib/db/repository'
import type { MobileLayout } from '@/app/types'
import type { MobileServiceResult } from './_result'

/**
 * Mobile transport adapter for the workspace layout operations. It only maps the
 * application service's domain result to the versioned HTTP service envelope;
 * validation, precedence, capability gating, super-admin policy, and persistence
 * stay in `lib/domain/workspace` and its provider port.
 */
function mapWorkspaceError<T>(error: WorkspaceDomainError): MobileServiceResult<T> {
  switch (error.code) {
    case 'FORBIDDEN':
      return { success: false, code: 'FORBIDDEN', message: error.message, status: 403 }
    case 'VALIDATION_ERROR':
      return { success: false, code: 'INVALID_PAYLOAD', message: error.message, status: 400 }
    case 'STORAGE_ERROR':
    default:
      return { success: false, code: 'INTERNAL_ERROR', message: error.message, status: 500 }
  }
}

export async function getPersonalLayoutService(
  actor: Actor
): Promise<MobileServiceResult<MobileLayoutState>> {
  const result = await getMobileLayoutState(actor, workspaceDeps())
  return result.ok ? { success: true, data: result.data } : mapWorkspaceError(result.error)
}

export async function savePersonalLayoutService(
  actor: Actor,
  layout: unknown
): Promise<MobileServiceResult<SavedMobileLayout>> {
  const result = await saveMobileLayout(actor, layout, workspaceDeps())
  return result.ok ? { success: true, data: result.data } : mapWorkspaceError(result.error)
}

export async function resetPersonalLayoutService(
  actor: Actor
): Promise<MobileServiceResult<{ layout: MobileLayout; savedLayout: null }>> {
  const result = await resetMobileLayout(actor, workspaceDeps())
  return result.ok ? { success: true, data: result.data } : mapWorkspaceError(result.error)
}

export async function getAdminLayoutService(
  actor: Actor
): Promise<MobileServiceResult<{ layout: MobileLayout }>> {
  const result = await getDefaultMobileLayout(actor, workspaceDeps())
  return result.ok ? { success: true, data: result.data } : mapWorkspaceError(result.error)
}

export async function saveAdminLayoutService(
  actor: Actor,
  layout: unknown
): Promise<MobileServiceResult<{ layout: MobileLayout }>> {
  const result = await saveDefaultMobileLayout(actor, layout, workspaceDeps())
  return result.ok ? { success: true, data: result.data } : mapWorkspaceError(result.error)
}

export async function resetAdminLayoutService(
  actor: Actor
): Promise<MobileServiceResult<{ layout: MobileLayout }>> {
  const result = await resetDefaultMobileLayout(actor, workspaceDeps())
  return result.ok ? { success: true, data: result.data } : mapWorkspaceError(result.error)
}
