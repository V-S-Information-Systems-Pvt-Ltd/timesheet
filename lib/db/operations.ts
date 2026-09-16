import 'server-only'

import { repo } from '@/lib/db'
import { BACKEND } from '@/lib/backend/config'
import { mobileSessionStore } from '@/lib/auth/mobile-session-store'
import { cleanupIdempotencyKeys } from '@/lib/idempotency'
import type { OperationsDomainDeps } from '@/lib/domain/operations'
import type {
  MaintenancePersistence,
  OperationsPersistence,
} from '@/lib/domain/operations-port'

/**
 * Narrow adapter from the backend-dispatched compatibility `Repository` to the
 * operations port. `repo` already resolves native PostgreSQL or the Supabase
 * admin implementation, so this mapping adds no provider behavior of its own; it
 * only narrows the surface the operations module sees.
 *
 * `restoreBackup` is forwarded as a single call: the whole native transaction /
 * Supabase `restore_backup_tx` RPC stays indivisible.
 */
export const operationsPersistence: OperationsPersistence = {
  exportBackup: (actor) => repo.exportBackup(actor),
  restoreBackup: (actor, payload) => repo.restoreBackup(actor, payload),
  importTimesheets: (actor, rows) => repo.importTimesheets(actor, rows),
  deleteUserTimesheets: (actor, userId) => repo.deleteUserTimesheets(actor, userId),
  resetTimesheets: (actor) => repo.resetTimesheets(actor),
  resetActivityData: (actor) => repo.resetActivityData(actor),
  resetAllData: (actor) => repo.resetAllData(actor),
  writeAuditLog: (actor, entry) => repo.writeAuditLog(actor, entry),
}

/**
 * Scheduled-maintenance adapter. Session expiry and idempotency retention are
 * infrastructure operations (not `Repository` methods); rate-limit cleanup stays
 * on the backend-dispatched repository.
 */
export const maintenancePersistence: MaintenancePersistence = {
  cleanupExpiredSessions: () => mobileSessionStore.cleanupExpired(),
  cleanupRateLimits: (before) => repo.cleanupRateLimits(before),
  cleanupIdempotencyKeys: (retentionDays) => cleanupIdempotencyKeys(retentionDays),
}

/**
 * Server entry composition for the operations module. Transports depend on this
 * helper instead of resolving a database backend themselves; the application
 * operations receive the ports, clock and backend label explicitly.
 */
export function operationsDeps(
  overrides: Partial<OperationsDomainDeps> = {}
): OperationsDomainDeps {
  return {
    persistence: overrides.persistence ?? operationsPersistence,
    maintenance: overrides.maintenance ?? maintenancePersistence,
    clock: overrides.clock ?? (() => new Date()),
    backend: overrides.backend ?? BACKEND,
  }
}
