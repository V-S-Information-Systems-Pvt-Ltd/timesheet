import 'server-only'

import { IS_NATIVE } from '@/lib/backend/config'
import type { WorkspaceDomainDeps } from '@/lib/domain/workspace'
import type { WorkspacePersistence } from '@/lib/domain/workspace-port'
import { nativeWorkspacePersistence } from './native/workspace'
import { supabaseWorkspacePersistence } from './supabase/workspace'

/**
 * Directly composes the narrow WorkspacePersistence port from the active provider adapter.
 * Bypasses the broad compatibility Repository facade so domain operations talk directly
 * to their provider implementation.
 */
export const workspacePersistence: WorkspacePersistence = IS_NATIVE
  ? nativeWorkspacePersistence
  : supabaseWorkspacePersistence

/**
 * Server entry composition for the workspace module. Transports depend on this
 * helper instead of resolving a database backend themselves; the application
 * operations receive the workspace port explicitly.
 */
export function workspaceDeps(): WorkspaceDomainDeps {
  return { persistence: workspacePersistence }
}
