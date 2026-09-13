import 'server-only'

import type { Actor, CreateUserInput, DbWrite, UpdateUserInput } from '@/lib/db/repository'
import type { HierarchyRole, PermissionRole, TitleRecord, User } from '@/app/types'

/**
 * Narrow persistence port owned by the people application module. It exposes
 * only profile reads/writes and audit/title lookups the people use cases need,
 * so each backend can implement it without re-exposing the wide compatibility
 * `Repository`.
 *
 * Authorization, RLS, SQL scoping (manager/team-lead visibility) and provider
 * error mapping stay inside the implementation (native SQL or the
 * request-scoped Supabase client). Row-to-DTO mapping stays in the transports.
 *
 * Provider identity and credentials deliberately do NOT appear here: account
 * provisioning is a separate boundary (`PeopleIdentity`) so password/credential
 * lifecycle never leaks into profile persistence. See `lib/db/people.ts` for
 * the composition over the retained backend dispatch.
 */
export interface PeoplePersistence {
  getProfileById(id: string): Promise<User | null>
  /** Profile list scoped by the caller's permission/hierarchy visibility. */
  listProfiles(actor: Actor): Promise<User[]>
  updateUserStatus(actor: Actor, userId: string, isActive: boolean): Promise<DbWrite>
  updateUserRoles(
    actor: Actor,
    userId: string,
    permissionRole: PermissionRole,
    hierarchyRole: HierarchyRole
  ): Promise<DbWrite>
  updateMyProfile(actor: Actor, input: { department: string; title: string }): Promise<DbWrite>
  updateUserName(actor: Actor, userId: string, name: string): Promise<DbWrite>
  updateUserManager(actor: Actor, userId: string, managerId: string | null): Promise<DbWrite>
  updateUser(actor: Actor, userId: string, input: UpdateUserInput): Promise<DbWrite>
  updateUserHierarchy(
    actor: Actor,
    userId: string,
    data: { managerId: string | null; title?: string; hierarchyRole?: HierarchyRole }
  ): Promise<DbWrite>
  listTitleRecords(actor?: Actor): Promise<TitleRecord[]>
  writeAuditLog(
    actor: Actor,
    input: { action: string; targetId?: string | null; detail?: Record<string, unknown> | null }
  ): Promise<DbWrite>
}

/**
 * Provider identity boundary used by account administration. `createAccount`
 * provisions auth credentials AND the matching profile in one provider-atomic
 * operation; the password never enters the people persistence port. The web and
 * native providers already implement this behind the existing identity facade
 * (slice 10 replaces its internals).
 */
export interface PeopleIdentity {
  createAccount(actor: Actor, input: CreateUserInput): Promise<DbWrite>
}

/** Explicit dependencies for the people application module. */
export interface PeoplePorts {
  persistence: PeoplePersistence
  identity: PeopleIdentity
}
