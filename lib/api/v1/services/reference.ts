import 'server-only'

import { repo } from '@/lib/db'
import type { Actor } from '@/lib/db/repository'
import type { ActivityType, Project } from '@/app/types'

export interface MobileReferenceDto {
  projects: Project[]
  activityTypes: ActivityType[]
}

export async function getReferenceService(actor: Actor): Promise<MobileReferenceDto> {
  const [projects, activityTypes] = await Promise.all([
    repo.listProjects(actor),
    repo.listActivityTypes(actor),
  ])

  return {
    projects,
    activityTypes,
  }
}
