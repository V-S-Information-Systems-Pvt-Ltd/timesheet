import 'server-only'

import { IS_NATIVE, BACKEND } from '@/lib/backend/config'
import { mobileSessionStore } from '@/lib/auth/mobile-session-store'
import { cleanupIdempotencyKeys } from '@/lib/idempotency'
import type { OperationsDomainDeps } from '@/lib/domain/operations'
import type {
  MaintenancePersistence,
  OperationsPersistence,
} from '@/lib/domain/operations-port'
import { nativeOperationsPersistence } from './native/operations'
import { supabaseOperationsPersistence } from './supabase/operations'

/**
 * Directly composes the narrow OperationsPersistence port from the active provider adapter.
 * Bypasses the broad compatibility Repository facade so domain operations talk directly
 * to their provider implementation.
 */
export const operationsPersistence: OperationsPersistence = IS_NATIVE
  ? nativeOperationsPersistence
  : supabaseOperationsPersistence

const activeOperationsAdapter = IS_NATIVE
  ? nativeOperationsPersistence
  : supabaseOperationsPersistence

/**
 * Scheduled-maintenance adapter. Session expiry and idempotency retention are
 * infrastructure operations; rate-limit cleanup delegates directly to the
 * active operations adapter rather than the compatibility Repository facade.
 */
export const maintenancePersistence: MaintenancePersistence = {
  cleanupExpiredSessions: () => mobileSessionStore.cleanupExpired(),
  cleanupRateLimits: (before) => activeOperationsAdapter.cleanupRateLimits(before),
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
