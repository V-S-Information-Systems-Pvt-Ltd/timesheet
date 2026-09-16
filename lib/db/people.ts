import 'server-only'

import { IS_NATIVE } from '@/lib/backend/config'
import type {
  PeopleIdentity,
  PeoplePersistence,
  PeoplePorts,
} from '@/lib/domain/people-port'
import { nativePeoplePersistence, nativePeopleIdentity } from './native/people'
import { supabasePeoplePersistence, supabasePeopleIdentity } from './supabase/people'

/**
 * Directly composes narrow PeoplePersistence and PeopleIdentity ports from the active provider adapter.
 * Bypasses the broad compatibility Repository facade so domain operations talk directly
 * to their provider implementation.
 */
export const peoplePersistence: PeoplePersistence = IS_NATIVE
  ? nativePeoplePersistence
  : supabasePeoplePersistence

export const peopleIdentity: PeopleIdentity = IS_NATIVE
  ? nativePeopleIdentity
  : supabasePeopleIdentity

/**
 * Server entry composition for the people module. Transports depend on this
 * helper instead of resolving the identity boundary or persistence themselves.
 */
export function peopleDeps(): PeoplePorts {
  return { persistence: peoplePersistence, identity: peopleIdentity }
}
