import 'server-only'

import type { WorkspaceDomainDeps } from '@/lib/domain/workspace'
import type { WorkspacePersistence } from '@/lib/domain/workspace-port'
import { nativeWorkspacePersistence } from './native/workspace'

/**
 * Directly composes the narrow WorkspacePersistence port from the native adapter.
 * Bypasses the broad compatibility Repository facade so domain operations talk directly
 * to their provider implementation.
 */
export const workspacePersistence: WorkspacePersistence = nativeWorkspacePersistence

/**
 * Server entry composition for the workspace module. Transports depend on this
 * helper instead of resolving a database backend themselves; the application
 * operations receive the workspace port explicitly.
 */
export function workspaceDeps(): WorkspaceDomainDeps {
  return { persistence: workspacePersistence }
}
