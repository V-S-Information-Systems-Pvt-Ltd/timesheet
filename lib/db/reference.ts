import 'server-only'

import { IS_NATIVE } from '@/lib/backend/config'
import type { ReferenceDomainDeps } from '@/lib/domain/reference'
import type { ReferencePersistence } from '@/lib/domain/reference-port'
import { nativeReferencePersistence } from './native/reference'
import { supabaseReferencePersistence } from './supabase/reference'

/**
 * Directly composes the narrow ReferencePersistence port from the active provider adapter.
 * Bypasses the broad compatibility Repository facade so domain operations talk directly
 * to their provider implementation.
 */
export const referencePersistence: ReferencePersistence = IS_NATIVE
  ? nativeReferencePersistence
  : supabaseReferencePersistence

/**
 * Server entry composition for the reference-data module. Transports depend on
 * this helper instead of resolving a database backend themselves; the
 * application operations receive the persistence port explicitly.
 */
export function referenceDeps(): ReferenceDomainDeps {
  return { persistence: referencePersistence }
}
