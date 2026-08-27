import { z } from 'zod'
import type { ActivityType, Project, Timesheet } from '@/app/types'
import type { Actor } from '@/lib/db/repository'
import { getActorCapabilities, type ActorCapabilities as MobileActorCapabilities } from '@/lib/roles'

export const mobileLoginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
  deviceName: z.string().trim().max(120).optional(),
  platform: z.enum(['android', 'ios', 'windows']).optional(),
})

export const mobileRefreshSchema = z.object({
  refreshToken: z.string().min(1),
})

export type { MobileActorCapabilities }

export interface MobileActorDto {
  id: string
  email: string
  role: string
  permissionRole: string
  hierarchyRole: string
  isActive: boolean
  capabilities: MobileActorCapabilities
}

export function mapActorDto(actor: Actor): MobileActorDto {
  return {
    id: actor.id,
    email: actor.email,
    role: actor.role,
    permissionRole: actor.permission_role,
    hierarchyRole: actor.hierarchy_role,
    isActive: actor.isActive,
    capabilities: getActorCapabilities(actor),
  }
}

export interface TimesheetEntryDto {
  id: string
  user_id: string
  user_email?: string
  project_id: string
  project_name?: string
  activity_type_id: string | null
  activity_name?: string | null
  log_date: string
  hours_worked: number
  work_done: string
  created_at: string
}

export function mapTimesheetDto(row: Timesheet): TimesheetEntryDto {
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

export interface ProjectDto {
  id: string
  name: string
  so_number?: string | null
  telegram_no?: number | null
}

export function mapProjectDto(project: Project): ProjectDto {
  return {
    id: project.id,
    name: project.name,
    so_number: project.so_number ?? null,
    telegram_no: project.telegram_no ?? null,
  }
}

export interface ActivityTypeDto {
  id: string
  name: string
  is_active?: boolean
  telegram_no?: number | null
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
}

export function mapReferenceDto(
  projects: Project[],
  activityTypes: ActivityType[]
): MobileReferenceDto {
  return {
    projects: projects.map(mapProjectDto),
    activityTypes: activityTypes.map(mapActivityTypeDto),
  }
}

export interface MobileDashboardDto {
  actor: MobileActorDto
  today: { date: string; hours: number }
  week: { from: string; to: string; hours: number }
  recentEntries: TimesheetEntryDto[]
  quickActions: string[]
}

export interface ReportBucketDto {
  label: string
  hours: number
  entries: number
}

export interface ReportTotalsDto {
  totalHours: number
  totalEntries: number
  byGroup: ReportBucketDto[]
}

export interface LeaveRowDto {
  id: string
  user_id: string
  leave_date: string
  reason: string
  created_at?: string
}

export interface ReminderItemDto {
  id: string
  user_id: string
  message: string
  remind_at: string
  done: boolean
  created_at?: string
}

export interface PersonProfileDto {
  id: string
  email: string
  name: string
  role: string
  permissionRole: string
  hierarchyRole: string
  department?: string | null
  title?: string | null
  managerId?: string | null
  isActive: boolean
}

export interface MobileLoginData {
  accessToken: string
  refreshToken: string
  accessTokenExpiresAt: string
  sessionId: string
  actor: MobileActorDto
}

export type MobileApiResult<T> =
  | { data: T; error: null }
  | { data: null; error: { code: string; message: string; fieldErrors?: Record<string, string[]> } }
