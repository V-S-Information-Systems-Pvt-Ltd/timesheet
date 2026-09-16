import 'server-only'

import { repo } from '@/lib/db'
import type { WorkspaceDomainDeps } from '@/lib/domain/workspace'
import type { WorkspacePersistence } from '@/lib/domain/workspace-port'

/**
 * Narrow adapter from the backend-dispatched compatibility `Repository` to the
 * workspace port. `repo` already resolves native PostgreSQL or the
 * request-scoped Supabase implementation, so this mapping adds no provider
 * behavior of its own; it only narrows the surface the workspace module sees.
 */
export const workspacePersistence: WorkspacePersistence = {
  getBackfillWindow: (actor) => repo.getBackfillWindow(actor),
  setBackfillWindow: (actor, settings) => repo.setBackfillWindow(actor, settings),
  getDefaultLayouts: (actor) => repo.getDefaultLayouts(actor),
  setDefaultLayouts: (actor, layouts) => repo.setDefaultLayouts(actor, layouts),
  getMobileLayout: (actor) => repo.getMobileLayout(actor),
  setMobileLayout: (actor, layout) => repo.setMobileLayout(actor, layout),
  setDashboardLayout: (actor, layout) => repo.setDashboardLayout(actor, layout),
  setAdminLayout: (actor, layout) => repo.setAdminLayout(actor, layout),
  getBranding: (actor) => repo.getBranding(actor),
  setBranding: (actor, branding) => repo.setBranding(actor, branding),
}

/**
 * Server entry composition for the workspace module. Transports depend on this
 * helper instead of resolving a database backend themselves; the application
 * operations receive the workspace port explicitly.
 */
export function workspaceDeps(): WorkspaceDomainDeps {
  return { persistence: workspacePersistence }
}
