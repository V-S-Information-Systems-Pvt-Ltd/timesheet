import 'server-only'

import type {
  PeopleIdentity,
  PeoplePersistence,
  PeoplePorts,
} from '@/lib/domain/people-port'
import { nativePeoplePersistence, nativePeopleIdentity } from './native/people'

/**
 * Directly composes narrow PeoplePersistence and PeopleIdentity ports from the native adapter.
 * Bypasses the broad compatibility Repository facade so domain operations talk directly
 * to their provider implementation.
 */
export const peoplePersistence: PeoplePersistence = nativePeoplePersistence

export const peopleIdentity: PeopleIdentity = nativePeopleIdentity

/**
 * Server entry composition for the people module. Transports depend on this
 * helper instead of resolving the identity boundary or persistence themselves.
 */
export function peopleDeps(): PeoplePorts {
  return { persistence: peoplePersistence, identity: peopleIdentity }
}
