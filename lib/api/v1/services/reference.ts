import 'server-only'

import type { Actor } from '@/lib/db/repository'
import { referenceDeps } from '@/lib/db/reference'
import { listActivityTypes, listProjects, listTitleRecords } from '@/lib/domain/reference'
import { mapReferenceDto, type MobileReferenceDto } from '@/lib/api/v1/contracts'

/**
 * Mobile reference payload: the shared project/activity/title reads routed
 * through the reference-data application module so the mobile wire shape and
 * the web/admin transports share one orchestration and policy owner.
 */
export async function getReferenceService(actor: Actor): Promise<MobileReferenceDto> {
  const deps = referenceDeps()
  const [projectsResult, activityTypesResult, titleRecordsResult] = await Promise.all([
    listProjects(actor, deps),
    listActivityTypes(actor, deps),
    listTitleRecords(actor, deps),
  ])

  if (!projectsResult.ok) throw new Error(projectsResult.error.message)
  if (!activityTypesResult.ok) throw new Error(activityTypesResult.error.message)
  if (!titleRecordsResult.ok) throw new Error(titleRecordsResult.error.message)

  const titleRecords = titleRecordsResult.data
  const titles = titleRecords.map((t) => t.name)
  return mapReferenceDto(projectsResult.data, activityTypesResult.data, titles, titleRecords)
}
