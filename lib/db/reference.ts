import 'server-only'

import type { ReferenceDomainDeps } from '@/lib/domain/reference'
import type { ReferencePersistence } from '@/lib/domain/reference-port'
import { nativeReferencePersistence } from './native/reference'

/**
 * Directly composes the narrow ReferencePersistence port from the native adapter.
 * Bypasses the broad compatibility Repository facade so domain operations talk directly
 * to their provider implementation.
 */
export const referencePersistence: ReferencePersistence = nativeReferencePersistence

/**
 * Server entry composition for the reference-data module. Transports depend on
 * this helper instead of resolving a database backend themselves; the
 * application operations receive the persistence port explicitly.
 */
export function referenceDeps(): ReferenceDomainDeps {
  return { persistence: referencePersistence }
}
