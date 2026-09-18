// Canonical domain wire contracts shared by the server transports and every
// platform-neutral client. These describe released /api/data and /api/v1
// response shapes; row-to-DTO mapping stays on the server.

/** Actor capability flags returned to clients. */
export interface ActorCapabilities {
  canViewTeam: boolean
  canManageProjects: boolean
  canManageActivities: boolean
  canManageUsers: boolean
  canManageSettings: boolean
  /** Missing means false so newer mobile clients remain safe with older servers. */
  canManageWorkspaceCustomization?: boolean
}

/** Authenticated actor as every client sees it. */
export interface MobileActorDto {
  id: string
  email: string
  role: string
  permissionRole: string
  hierarchyRole: string
  name?: string | null
  department?: string | null
  title?: string | null
  managerId?: string | null
  isActive: boolean
  capabilities?: ActorCapabilities
}

/** Project reference row. */
export interface ProjectDto {
  id: string
  name: string
  so_number?: string | null
  telegram_no?: number | null
}

/** Activity-type reference row. */
export interface ActivityTypeDto {
  id: string
  name: string
  is_active?: boolean
  telegram_no?: number | null
}

/** Title definition row. */
export interface TitleItemDto {
  name: string
  hierarchyRole: string
}

/** Global reminder row. */
export interface GlobalReminderDto {
  id: string
  message: string
  remind_at: string
  created_at?: string
}

/** One grouped report bucket (project | user | activity). */
export interface ReportBucketDto {
  label: string
  hours: number
  entries: number
}

/** Report totals shared by web and mobile transports. */
export interface ReportTotalsDto {
  totalHours: number
  totalEntries: number
  byGroup: ReportBucketDto[]
}

/** Profile row returned by people/profile endpoints. */
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
