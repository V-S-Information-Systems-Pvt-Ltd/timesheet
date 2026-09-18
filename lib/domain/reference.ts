import 'server-only'

import type { ActivityType, HierarchyRole, Project, TitleRecord, WhitelistedDomain } from '@/app/types'
import type { Actor } from '@/lib/db/repository'
import { HIERARCHY_ROLES } from '@/lib/roles'
import { isSuperAdmin } from '@/lib/auth/super-admin'
import { isNonEmpty, isOneOf } from '@/lib/validation'
import type { ReferencePersistence, TitleImpact } from './reference-port'

/**
 * Reference-data application module: the single policy/orchestration owner for
 * project, activity-type and title operations. Transports (Server Actions,
 * `/api/data`, `/api/v1/admin`) resolve identity and map the domain result to
 * their own envelope; the module never resolves a global repository, cookies or
 * headers — it receives an explicit actor and persistence port.
 */
export interface ReferenceDomainDeps {
  persistence: ReferencePersistence
}

export type ReferenceErrorCode =
  | 'FORBIDDEN'
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'BAD_REQUEST'
  | 'STORAGE_ERROR'

export interface ReferenceError {
  code: ReferenceErrorCode
  message: string
}

export type ReferenceResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ReferenceError }

// --- canonical input contracts --------------------------------------------
// Defined once here and shared by every transport, replacing the per-transport
// inline validation that previously drifted between actions and routes.

export interface CreateProjectInput {
  name: string
  soNumber?: string | null
  telegramNo?: number | null
}

export interface UpdateProjectPatch {
  name?: string
  soNumber?: string | null
  telegramNo?: number | null
}

export interface CreateActivityTypeInput {
  name: string
  telegramNo?: number | null
}

export interface UpdateActivityTypePatch {
  name?: string
  isActive?: boolean
  telegramNo?: number | null
}

// --- canonical validation messages ----------------------------------------
export const PROJECT_NAME_REQUIRED = 'Project name is required.'
export const PROJECT_ID_REQUIRED = 'Project ID is required.'
export const ACTIVITY_TYPE_NAME_REQUIRED = 'Activity type name is required.'
export const ACTIVITY_TYPE_ID_REQUIRED = 'Activity type ID is required.'
export const TITLE_NAME_REQUIRED = 'Title name is required.'
export const TITLE_NAME_PARAMETER_REQUIRED = 'Title name parameter is required.'
export const INVALID_HIERARCHY_ROLE = 'Invalid hierarchy role.'
export const INVALID_PROPOSED_HIERARCHY_ROLE = 'Invalid proposed hierarchy role.'
export const INVALID_TELEGRAM_NO = 'Bot number must be a positive whole number.'
export const PROJECT_NOT_FOUND = 'Project not found.'
export const ACTIVITY_TYPE_NOT_FOUND = 'Activity type not found.'
const GENERIC_FORBIDDEN = 'You do not have permission to perform this action.'

function forbidden(message = GENERIC_FORBIDDEN): ReferenceResult<never> {
  return { ok: false, error: { code: 'FORBIDDEN', message } }
}
function validationError(message: string): ReferenceResult<never> {
  return { ok: false, error: { code: 'VALIDATION_ERROR', message } }
}
function notFound(message: string): ReferenceResult<never> {
  return { ok: false, error: { code: 'NOT_FOUND', message } }
}
function conflict(message: string): ReferenceResult<never> {
  return { ok: false, error: { code: 'CONFLICT', message } }
}
function badRequest(message: string): ReferenceResult<never> {
  return { ok: false, error: { code: 'BAD_REQUEST', message } }
}
function storageError(message: string): ReferenceResult<never> {
  return { ok: false, error: { code: 'STORAGE_ERROR', message } }
}

/**
 * Defense-in-depth active-account guard (mirrors the timesheet module).
 * Transport boundaries already reject inactive actors, but a direct caller
 * holding an inactive Actor must not proceed either.
 */
function inactiveActorError(actor: Actor): ReferenceResult<never> | null {
  if (!actor.isActive) return forbidden('Your account is not active.')
  return null
}

function canManageProjects(actor: Actor): boolean {
  return actor.permission_role === 'admin' || actor.permission_role === 'pm'
}

function canManageActivities(actor: Actor): boolean {
  return actor.permission_role === 'admin'
}

function canManageTitles(actor: Actor): boolean {
  return isSuperAdmin(actor)
}

function telegramError(value: number | null | undefined): string | null {
  if (value === null || value === undefined) return null
  if (!Number.isInteger(value) || value <= 0) return INVALID_TELEGRAM_NO
  return null
}

// ==========================================================================
// Projects
// ==========================================================================

/** Read the project list (any active actor — used by `/api/data` and the mobile reference payload). */
export async function listProjects(
  actor: Actor,
  deps: ReferenceDomainDeps
): Promise<ReferenceResult<Project[]>> {
  const inactive = inactiveActorError(actor)
  if (inactive) return inactive
  return { ok: true, data: await deps.persistence.listProjects(actor) }
}

/** Read the project list for the admin surface (admin/pm only). */
export async function listProjectsForAdmin(
  actor: Actor,
  deps: ReferenceDomainDeps
): Promise<ReferenceResult<Project[]>> {
  const inactive = inactiveActorError(actor)
  if (inactive) return inactive
  if (!canManageProjects(actor)) return forbidden()
  return { ok: true, data: await deps.persistence.listProjects(actor) }
}

/** Create a project atomically (the inserted row is returned by the provider). */
export async function createProject(
  actor: Actor,
  input: CreateProjectInput,
  deps: ReferenceDomainDeps
): Promise<ReferenceResult<Project | null>> {
  const inactive = inactiveActorError(actor)
  if (inactive) return inactive
  if (!canManageProjects(actor)) return forbidden()
  if (!isNonEmpty(input.name)) return validationError(PROJECT_NAME_REQUIRED)
  const telegramErr = telegramError(input.telegramNo)
  if (telegramErr) return validationError(telegramErr)

  const name = input.name.trim()
  const hasOptions = input.soNumber !== undefined || input.telegramNo !== undefined
  const result = hasOptions
    ? await deps.persistence.createProject(actor, name, {
        soNumber: input.soNumber ?? null,
        telegramNo: input.telegramNo ?? null,
      })
    : await deps.persistence.createProject(actor, name)

  if (result.error) return conflict(result.error)
  return { ok: true, data: result.data }
}

export async function renameProject(
  actor: Actor,
  id: string,
  name: string,
  deps: ReferenceDomainDeps
): Promise<ReferenceResult<void>> {
  const inactive = inactiveActorError(actor)
  if (inactive) return inactive
  if (!canManageProjects(actor)) return forbidden()
  if (!isNonEmpty(name)) return validationError(PROJECT_NAME_REQUIRED)
  const result = await deps.persistence.renameProject(actor, id, name.trim())
  if (result.error) return conflict(result.error)
  return { ok: true, data: undefined }
}

export async function setProjectSO(
  actor: Actor,
  id: string,
  soNumber: string | null,
  deps: ReferenceDomainDeps
): Promise<ReferenceResult<void>> {
  const inactive = inactiveActorError(actor)
  if (inactive) return inactive
  if (!canManageProjects(actor)) return forbidden()
  const normalized = typeof soNumber === 'string' ? soNumber.trim() || null : null
  const result = await deps.persistence.setProjectSO(actor, id, normalized)
  if (result.error) return badRequest(result.error)
  return { ok: true, data: undefined }
}

export async function setProjectTelegramNo(
  actor: Actor,
  id: string,
  telegramNo: number | null,
  deps: ReferenceDomainDeps
): Promise<ReferenceResult<void>> {
  const inactive = inactiveActorError(actor)
  if (inactive) return inactive
  if (!canManageProjects(actor)) return forbidden()
  const telegramErr = telegramError(telegramNo)
  if (telegramErr) return validationError(telegramErr)
  const result = await deps.persistence.setProjectTelegramNo(actor, id, telegramNo)
  if (result.error) return badRequest(result.error)
  return { ok: true, data: undefined }
}

export async function deleteProject(
  actor: Actor,
  id: string,
  deps: ReferenceDomainDeps
): Promise<ReferenceResult<void>> {
  const inactive = inactiveActorError(actor)
  if (inactive) return inactive
  if (!canManageProjects(actor)) return forbidden()
  if (!isNonEmpty(id)) return validationError(PROJECT_ID_REQUIRED)
  const result = await deps.persistence.deleteProject(actor, id)
  if (result.error) return conflict(result.error)
  return { ok: true, data: undefined }
}

/**
 * Apply a partial project update in the fixed order name -> SO number ->
 * Telegram number, then read back the updated row. Each field keeps the
 * provider/error semantics of the original transport branch.
 */
export async function updateProject(
  actor: Actor,
  id: string,
  patch: UpdateProjectPatch,
  deps: ReferenceDomainDeps
): Promise<ReferenceResult<Project>> {
  const inactive = inactiveActorError(actor)
  if (inactive) return inactive
  if (!canManageProjects(actor)) return forbidden()
  if (!isNonEmpty(id)) return validationError(PROJECT_ID_REQUIRED)

  if (patch.name !== undefined) {
    const result = await renameProject(actor, id, patch.name, deps)
    if (!result.ok) return result
  }
  if (patch.soNumber !== undefined) {
    const result = await setProjectSO(actor, id, patch.soNumber, deps)
    if (!result.ok) return result
  }
  if (patch.telegramNo !== undefined) {
    const result = await setProjectTelegramNo(actor, id, patch.telegramNo, deps)
    if (!result.ok) return result
  }

  const projects = await deps.persistence.listProjects(actor)
  const updated = projects.find((project) => project.id === id)
  if (!updated) return notFound(PROJECT_NOT_FOUND)
  return { ok: true, data: updated }
}

// ==========================================================================
// Activity types
// ==========================================================================

/** Read the active activity-type list (any active actor). */
export async function listActivityTypes(
  actor: Actor,
  deps: ReferenceDomainDeps
): Promise<ReferenceResult<ActivityType[]>> {
  const inactive = inactiveActorError(actor)
  if (inactive) return inactive
  return { ok: true, data: await deps.persistence.listActivityTypes(actor) }
}

/** Read every activity type, including inactive (any active actor). */
export async function listAllActivityTypes(
  actor: Actor,
  deps: ReferenceDomainDeps
): Promise<ReferenceResult<ActivityType[]>> {
  const inactive = inactiveActorError(actor)
  if (inactive) return inactive
  return { ok: true, data: await deps.persistence.listAllActivityTypes(actor) }
}

/** Read the activity-type list for the admin surface (admin only). */
export async function listActivityTypesForAdmin(
  actor: Actor,
  deps: ReferenceDomainDeps
): Promise<ReferenceResult<ActivityType[]>> {
  const inactive = inactiveActorError(actor)
  if (inactive) return inactive
  if (!canManageActivities(actor)) return forbidden()
  return { ok: true, data: await deps.persistence.listActivityTypes(actor) }
}

/** Create an activity type atomically (the inserted row is returned by the provider). */
export async function createActivityType(
  actor: Actor,
  input: CreateActivityTypeInput,
  deps: ReferenceDomainDeps
): Promise<ReferenceResult<ActivityType | null>> {
  const inactive = inactiveActorError(actor)
  if (inactive) return inactive
  if (!canManageActivities(actor)) return forbidden()
  if (!isNonEmpty(input.name)) return validationError(ACTIVITY_TYPE_NAME_REQUIRED)
  const telegramErr = telegramError(input.telegramNo)
  if (telegramErr) return validationError(telegramErr)

  const name = input.name.trim()
  const hasOptions = input.telegramNo !== undefined
  const result = hasOptions
    ? await deps.persistence.createActivityType(actor, name, {
        telegramNo: input.telegramNo ?? null,
      })
    : await deps.persistence.createActivityType(actor, name)

  if (result.error) return conflict(result.error)
  return { ok: true, data: result.data }
}

export async function renameActivityType(
  actor: Actor,
  id: string,
  name: string,
  deps: ReferenceDomainDeps
): Promise<ReferenceResult<void>> {
  const inactive = inactiveActorError(actor)
  if (inactive) return inactive
  if (!canManageActivities(actor)) return forbidden()
  if (!isNonEmpty(name)) return validationError(ACTIVITY_TYPE_NAME_REQUIRED)
  const result = await deps.persistence.renameActivityType(actor, id, name.trim())
  if (result.error) return conflict(result.error)
  return { ok: true, data: undefined }
}

export async function setActivityTypeActive(
  actor: Actor,
  id: string,
  isActive: boolean,
  deps: ReferenceDomainDeps
): Promise<ReferenceResult<void>> {
  const inactive = inactiveActorError(actor)
  if (inactive) return inactive
  if (!canManageActivities(actor)) return forbidden()
  const result = await deps.persistence.setActivityTypeActive(actor, id, isActive)
  if (result.error) return badRequest(result.error)
  return { ok: true, data: undefined }
}

export async function setActivityTypeTelegramNo(
  actor: Actor,
  id: string,
  telegramNo: number | null,
  deps: ReferenceDomainDeps
): Promise<ReferenceResult<void>> {
  const inactive = inactiveActorError(actor)
  if (inactive) return inactive
  if (!canManageActivities(actor)) return forbidden()
  const telegramErr = telegramError(telegramNo)
  if (telegramErr) return validationError(telegramErr)
  const result = await deps.persistence.setActivityTypeTelegramNo(actor, id, telegramNo)
  if (result.error) return badRequest(result.error)
  return { ok: true, data: undefined }
}

export async function deleteActivityType(
  actor: Actor,
  id: string,
  deps: ReferenceDomainDeps
): Promise<ReferenceResult<void>> {
  const inactive = inactiveActorError(actor)
  if (inactive) return inactive
  if (!canManageActivities(actor)) return forbidden()
  if (!isNonEmpty(id)) return validationError(ACTIVITY_TYPE_ID_REQUIRED)
  const result = await deps.persistence.deleteActivityType(actor, id)
  if (result.error) return conflict(result.error)
  return { ok: true, data: undefined }
}

/**
 * Apply a partial activity-type update in the fixed order name -> active flag
 * -> Telegram number, then read back the updated row.
 */
export async function updateActivityType(
  actor: Actor,
  id: string,
  patch: UpdateActivityTypePatch,
  deps: ReferenceDomainDeps
): Promise<ReferenceResult<ActivityType>> {
  const inactive = inactiveActorError(actor)
  if (inactive) return inactive
  if (!canManageActivities(actor)) return forbidden()
  if (!isNonEmpty(id)) return validationError(ACTIVITY_TYPE_ID_REQUIRED)

  if (patch.name !== undefined) {
    const result = await renameActivityType(actor, id, patch.name, deps)
    if (!result.ok) return result
  }
  if (patch.isActive !== undefined) {
    const result = await setActivityTypeActive(actor, id, patch.isActive, deps)
    if (!result.ok) return result
  }
  if (patch.telegramNo !== undefined) {
    const result = await setActivityTypeTelegramNo(actor, id, patch.telegramNo, deps)
    if (!result.ok) return result
  }

  const all = await deps.persistence.listActivityTypes(actor)
  const updated = all.find((activity) => activity.id === id)
  if (!updated) return notFound(ACTIVITY_TYPE_NOT_FOUND)
  return { ok: true, data: updated }
}

// ==========================================================================
// Titles (super-admin managed; lookup is available to active users)
// ==========================================================================

export async function listTitles(
  actor: Actor,
  deps: ReferenceDomainDeps
): Promise<ReferenceResult<string[]>> {
  const inactive = inactiveActorError(actor)
  if (inactive) return inactive
  return { ok: true, data: await deps.persistence.listTitles() }
}

export async function listTitleRecords(
  actor: Actor,
  deps: ReferenceDomainDeps
): Promise<ReferenceResult<TitleRecord[]>> {
  const inactive = inactiveActorError(actor)
  if (inactive) return inactive
  return { ok: true, data: await deps.persistence.listTitleRecords() }
}

/** Super-admin: add a title definition, returning the inserted row atomically. */
export async function addTitle(
  actor: Actor,
  name: string,
  hierarchyRole: HierarchyRole,
  deps: ReferenceDomainDeps
): Promise<ReferenceResult<TitleRecord | null>> {
  const inactive = inactiveActorError(actor)
  if (inactive) return inactive
  if (!canManageTitles(actor)) return forbidden('Super-admin access required.')
  if (!isNonEmpty(name)) return validationError(TITLE_NAME_REQUIRED)
  if (!isOneOf(hierarchyRole, HIERARCHY_ROLES)) return validationError(INVALID_HIERARCHY_ROLE)

  const result = await deps.persistence.addTitle(actor, name.trim(), hierarchyRole)
  if (result.error) return conflict(result.error)
  return { ok: true, data: result.data }
}

/** Super-admin: delete a title definition. */
export async function deleteTitle(
  actor: Actor,
  name: string,
  deps: ReferenceDomainDeps
): Promise<ReferenceResult<void>> {
  const inactive = inactiveActorError(actor)
  if (inactive) return inactive
  if (!canManageTitles(actor)) return forbidden('Super-admin access required.')
  if (!isNonEmpty(name)) return validationError(TITLE_NAME_REQUIRED)
  const result = await deps.persistence.deleteTitle(actor, name.trim())
  if (result.error) return conflict(result.error)
  return { ok: true, data: undefined }
}

/** Super-admin: reclassify a title and optionally synchronize affected users. */
export async function reclassifyTitle(
  actor: Actor,
  name: string,
  hierarchyRole: HierarchyRole,
  syncUsers: boolean,
  deps: ReferenceDomainDeps
): Promise<ReferenceResult<{ affectedCount?: number }>> {
  const inactive = inactiveActorError(actor)
  if (inactive) return inactive
  if (!canManageTitles(actor)) return forbidden('Super-admin access required.')
  if (!isNonEmpty(name)) return validationError(TITLE_NAME_REQUIRED)
  if (!isOneOf(hierarchyRole, HIERARCHY_ROLES)) return validationError(INVALID_HIERARCHY_ROLE)
  const result = await deps.persistence.reclassifyTitle(actor, name.trim(), hierarchyRole, syncUsers)
  if (result.error) return badRequest(result.error)
  return { ok: true, data: { affectedCount: result.affectedCount } }
}

/** Super-admin: preview the impact of reclassifying a title. */
export async function getTitleImpact(
  actor: Actor,
  name: string,
  proposedRole: HierarchyRole | undefined,
  deps: ReferenceDomainDeps
): Promise<ReferenceResult<TitleImpact>> {
  const inactive = inactiveActorError(actor)
  if (inactive) return inactive
  if (!canManageTitles(actor)) return forbidden('Super-admin access required.')
  if (!isNonEmpty(name)) return validationError(TITLE_NAME_REQUIRED)
  if (proposedRole && !isOneOf(proposedRole, HIERARCHY_ROLES)) {
    return validationError(INVALID_PROPOSED_HIERARCHY_ROLE)
  }
  const result = await deps.persistence.getTitleImpact(actor, name.trim(), proposedRole)
  if ('error' in result) return badRequest(result.error)
  return { ok: true, data: result }
}

// ========================================================================
// Email domain whitelist (super-admin managed)
// ========================================================================

const DOMAIN_REQUIRED = 'Please enter a valid domain (e.g. company.com).'

function requireSuperAdmin(actor: Actor): ReferenceResult<never> | null {
  const inactive = inactiveActorError(actor)
  if (inactive) return inactive
  if (!canManageTitles(actor)) return forbidden('Super-admin access required.')
  return null
}

export async function listWhitelistedDomains(
  actor: Actor,
  deps: ReferenceDomainDeps
): Promise<ReferenceResult<WhitelistedDomain[]>> {
  const denied = requireSuperAdmin(actor)
  if (denied) return denied
  try {
    return { ok: true, data: await deps.persistence.listWhitelistedDomains(actor) }
  } catch (err) {
    return storageError(err instanceof Error ? err.message : 'Failed to fetch domains.')
  }
}

export async function addWhitelistedDomain(
  actor: Actor,
  domain: string,
  autoActivate: boolean,
  deps: ReferenceDomainDeps
): Promise<ReferenceResult<{ domain: string }>> {
  const denied = requireSuperAdmin(actor)
  if (denied) return denied

  const clean = domain.trim().toLowerCase().replace(/^@/, '')
  if (!clean || !clean.includes('.')) return validationError(DOMAIN_REQUIRED)

  const result = await deps.persistence.addWhitelistedDomain(actor, clean, autoActivate)
  if (result.error) return storageError(result.error)
  return { ok: true, data: { domain: clean } }
}

export async function updateWhitelistedDomain(
  actor: Actor,
  id: string,
  autoActivate: boolean,
  deps: ReferenceDomainDeps
): Promise<ReferenceResult<void>> {
  const denied = requireSuperAdmin(actor)
  if (denied) return denied
  const result = await deps.persistence.updateWhitelistedDomain(actor, id, autoActivate)
  if (result.error) return storageError(result.error)
  return { ok: true, data: undefined }
}

export async function deleteWhitelistedDomain(
  actor: Actor,
  id: string,
  deps: ReferenceDomainDeps
): Promise<ReferenceResult<void>> {
  const denied = requireSuperAdmin(actor)
  if (denied) return denied
  const result = await deps.persistence.deleteWhitelistedDomain(actor, id)
  if (result.error) return storageError(result.error)
  return { ok: true, data: undefined }
}
