import 'server-only'

import type { ActivityType, HierarchyRole, Project, TitleRecord } from '@/app/types'
import type {
  Actor,
  CreateActivityTypeOptions,
  CreateProjectOptions,
  DbCreateResult,
  DbWrite,
} from '@/lib/db/repository'

/** Result of previewing the impact of a title reclassification. */
export interface TitleImpact {
  title: string
  currentHierarchyRole: HierarchyRole
  proposedHierarchyRole: HierarchyRole
  affectedCount: number
  syncRequired: boolean
}

/**
 * Narrow persistence port owned by the reference-data application module. It
 * exposes only the project, activity-type and title operations the reference
 * use cases need, so each backend can implement it without re-exposing the wide
 * compatibility `Repository`.
 *
 * Authorization, RLS, transaction boundaries, uniqueness constraints and
 * provider error mapping stay inside the implementation (native SQL or Supabase
 * request-scoped client). Row-to-DTO mapping stays in the transports.
 */
export interface ReferencePersistence {
  // --- projects ---
  listProjects(actor: Actor): Promise<Project[]>
  createProject(
    actor: Actor,
    name: string,
    options?: CreateProjectOptions
  ): Promise<DbCreateResult<Project>>
  renameProject(actor: Actor, id: string, name: string): Promise<DbWrite>
  setProjectSO(actor: Actor, id: string, soNumber: string | null): Promise<DbWrite>
  setProjectTelegramNo(actor: Actor, id: string, telegramNo: number | null): Promise<DbWrite>
  deleteProject(actor: Actor, id: string): Promise<DbWrite>

  // --- activity types ---
  listActivityTypes(actor: Actor): Promise<ActivityType[]>
  listAllActivityTypes(actor: Actor): Promise<ActivityType[]>
  createActivityType(
    actor: Actor,
    name: string,
    options?: CreateActivityTypeOptions
  ): Promise<DbCreateResult<ActivityType>>
  renameActivityType(actor: Actor, id: string, name: string): Promise<DbWrite>
  setActivityTypeActive(actor: Actor, id: string, isActive: boolean): Promise<DbWrite>
  setActivityTypeTelegramNo(actor: Actor, id: string, telegramNo: number | null): Promise<DbWrite>
  deleteActivityType(actor: Actor, id: string): Promise<DbWrite>

  // --- titles ---
  listTitles(): Promise<string[]>
  listTitleRecords(): Promise<TitleRecord[]>
  addTitle(actor: Actor, name: string, hierarchyRole?: HierarchyRole): Promise<DbCreateResult<TitleRecord>>
  deleteTitle(actor: Actor, name: string): Promise<DbWrite>
  reclassifyTitle(
    actor: Actor,
    name: string,
    hierarchyRole: HierarchyRole,
    syncUsers?: boolean
  ): Promise<{ error: string | null; affectedCount?: number }>
  getTitleImpact(
    actor: Actor,
    name: string,
    proposedRole?: HierarchyRole
  ): Promise<TitleImpact | { error: string }>
}
