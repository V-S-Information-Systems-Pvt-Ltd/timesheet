import 'server-only'

import { repo } from '@/lib/db'
import type {
  PeopleIdentity,
  PeoplePersistence,
  PeoplePorts,
} from '@/lib/domain/people-port'

/**
 * Narrow adapters from the backend-dispatched compatibility `Repository` to the
 * people ports. `repo` already resolves native PostgreSQL or the request-scoped
 * Supabase implementation, so these mappings add no provider behavior of their
 * own; they only narrow the surface the people module sees. Authorization, RLS
 * and provider error mapping stay inside the existing provider implementations.
 */
export const peoplePersistence: PeoplePersistence = {
  getProfileById: (id) => repo.getProfileById(id),
  listProfiles: (actor) => repo.listProfiles(actor),
  updateUserStatus: (actor, userId, isActive) => repo.updateUserStatus(actor, userId, isActive),
  updateUserRoles: (actor, userId, permissionRole, hierarchyRole) =>
    repo.updateUserRoles(actor, userId, permissionRole, hierarchyRole),
  updateMyProfile: (actor, input) => repo.updateMyProfile(actor, input),
  updateUserName: (actor, userId, name) => repo.updateUserName(actor, userId, name),
  updateUserManager: (actor, userId, managerId) => repo.updateUserManager(actor, userId, managerId),
  updateUser: (actor, userId, input) => repo.updateUser(actor, userId, input),
  updateUserHierarchy: (actor, userId, data) => repo.updateUserHierarchy(actor, userId, data),
  listTitleRecords: (actor) => repo.listTitleRecords(actor),
  writeAuditLog: (actor, input) => repo.writeAuditLog(actor, input),
}

/**
 * Provider identity boundary. Account provisioning keeps its existing atomic
 * password + profile creation inside the provider adapter; the people service
 * never sees or stores the credential itself.
 */
export const peopleIdentity: PeopleIdentity = {
  createAccount: (actor, input) => repo.createUser(actor, input),
}

/**
 * Server entry composition for the people module. Transports depend on this
 * helper instead of resolving the identity boundary or persistence themselves.
 */
export function peopleDeps(): PeoplePorts {
  return { persistence: peoplePersistence, identity: peopleIdentity }
}
