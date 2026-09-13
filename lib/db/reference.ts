import 'server-only'

import { repo } from '@/lib/db'
import type { ReferenceDomainDeps } from '@/lib/domain/reference'
import type { ReferencePersistence } from '@/lib/domain/reference-port'

/**
 * Narrow adapter from the backend-dispatched compatibility `Repository` to the
 * reference-data port. `repo` already resolves native PostgreSQL or the
 * request-scoped Supabase implementation, so this mapping adds no provider
 * behavior of its own; it only narrows the surface the reference module sees.
 *
 * `createProject`/`createActivityType` forward the provider options only when
 * the caller supplied them, preserving the exact repository call shape each
 * transport used before the migration.
 */
export const referencePersistence: ReferencePersistence = {
  listProjects: (actor) => repo.listProjects(actor),
  createProject: (actor, name, options) =>
    options === undefined ? repo.createProject(actor, name) : repo.createProject(actor, name, options),
  renameProject: (actor, id, name) => repo.renameProject(actor, id, name),
  setProjectSO: (actor, id, soNumber) => repo.setProjectSO(actor, id, soNumber),
  setProjectTelegramNo: (actor, id, telegramNo) => repo.setProjectTelegramNo(actor, id, telegramNo),
  deleteProject: (actor, id) => repo.deleteProject(actor, id),

  listActivityTypes: (actor) => repo.listActivityTypes(actor),
  listAllActivityTypes: (actor) => repo.listAllActivityTypes(actor),
  createActivityType: (actor, name, options) =>
    options === undefined
      ? repo.createActivityType(actor, name)
      : repo.createActivityType(actor, name, options),
  renameActivityType: (actor, id, name) => repo.renameActivityType(actor, id, name),
  setActivityTypeActive: (actor, id, isActive) => repo.setActivityTypeActive(actor, id, isActive),
  setActivityTypeTelegramNo: (actor, id, telegramNo) =>
    repo.setActivityTypeTelegramNo(actor, id, telegramNo),
  deleteActivityType: (actor, id) => repo.deleteActivityType(actor, id),

  listTitles: () => repo.listTitles(),
  listTitleRecords: () => repo.listTitleRecords(),
  addTitle: (actor, name, hierarchyRole) => repo.addTitle(actor, name, hierarchyRole),
  deleteTitle: (actor, name) => repo.deleteTitle(actor, name),
  reclassifyTitle: (actor, name, hierarchyRole, syncUsers) =>
    repo.reclassifyTitle(actor, name, hierarchyRole, syncUsers),
  getTitleImpact: (actor, name, proposedRole) => repo.getTitleImpact(actor, name, proposedRole),
}

/**
 * Server entry composition for the reference-data module. Transports depend on
 * this helper instead of resolving a database backend themselves; the
 * application operations receive the persistence port explicitly.
 */
export function referenceDeps(): ReferenceDomainDeps {
  return { persistence: referencePersistence }
}
