import type { ActivityType, Project, Timesheet } from '@/app/types'
import type { Actor } from '@/lib/db/repository'
import { getActorCapabilities } from '@/lib/roles'
import { identityLoginSchema, identityRefreshSchema } from '@vsis/contracts'
import type { TimesheetEntry } from '@vsis/contracts'
import type {
  MobileActorDto,
  ProjectDto,
  ActivityTypeDto,
  TitleItemDto,
  GlobalReminderDto,
} from '@vsis/contracts'

export type { TimesheetEntry as TimesheetEntryDto } from '@vsis/contracts'
export type {
  ActorCapabilities,
  MobileActorDto,
  ProjectDto,
  ActivityTypeDto,
  TitleItemDto,
  GlobalReminderDto,
  ReportBucketDto,
  ReportTotalsDto,
  PersonProfileDto,
} from '@vsis/contracts'

// Keep the transport-local names for route compatibility while ensuring the
// runtime schemas have one canonical definition in @vsis/contracts.
export const mobileLoginSchema = identityLoginSchema
export const mobileRefreshSchema = identityRefreshSchema

export function mapActorDto(actor: Actor): MobileActorDto {
  return {
    id: actor.id,
    email: actor.email,
    name: actor.name ?? null,
    department: actor.department ?? null,
    title: actor.title ?? null,
    managerId: actor.manager_id ?? null,
    role: actor.role,
    permissionRole: actor.permission_role,
    hierarchyRole: actor.hierarchy_role,
    isActive: actor.isActive,
    capabilities: getActorCapabilities(actor),
  }
}

export function mapTimesheetDto(row: Timesheet): TimesheetEntry {
  return {
    id: row.id,
    user_id: row.user_id,
    user_email: row.profiles?.email ?? undefined,
    project_id: row.project_id,
    project_name: row.projects?.name ?? undefined,
    activity_type_id: row.activity_type_id ?? null,
    activity_name: row.activity_types?.name ?? undefined,
    log_date: row.log_date,
    hours_worked: Number(row.hours_worked),
    work_done: row.work_done ?? '',
    created_at: row.created_at,
  }
}

export function mapProjectDto(project: Project): ProjectDto {
  return {
    id: project.id,
    name: project.name,
    so_number: project.so_number ?? null,
    telegram_no: project.telegram_no ?? null,
  }
}

export function mapActivityTypeDto(activityType: ActivityType): ActivityTypeDto {
  return {
    id: activityType.id,
    name: activityType.name,
    is_active: activityType.is_active,
    telegram_no: activityType.telegram_no ?? null,
  }
}

export interface MobileReferenceDto {
  projects: ProjectDto[]
  activityTypes: ActivityTypeDto[]
  titles?: string[]
  titleItems?: TitleItemDto[]
}

export function mapReferenceDto(
  projects: Project[],
  activityTypes: ActivityType[],
  titles?: string[],
  titleRecords?: Array<{ name: string; hierarchy_role: string }>
): MobileReferenceDto {
  return {
    projects: projects.map(mapProjectDto),
    activityTypes: activityTypes.map(mapActivityTypeDto),
    titles: titles ?? [],
    titleItems: (titleRecords ?? []).map((t) => ({
      name: t.name,
      hierarchyRole: t.hierarchy_role,
    })),
  }
}

export interface MobileDashboardDto {
  actor: MobileActorDto
  today: { date: string; hours: number }
  week: { from: string; to: string; hours: number }
  recentEntries: TimesheetEntry[]
  quickActions: string[]
}

export function mapGlobalReminderDto(r: {
  id: string
  message: string
  remind_at: string
  created_at?: string
}): GlobalReminderDto {
  return {
    id: r.id,
    message: r.message,
    remind_at: r.remind_at,
    created_at: r.created_at,
  }
}
