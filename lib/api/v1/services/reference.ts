import 'server-only'

import { repo } from '@/lib/db'
import type { Actor } from '@/lib/db/repository'
import {
  mapReferenceDto,
  type MobileReferenceDto,
} from '@/lib/api/v1/contracts'

export type { MobileReferenceDto }

export async function getReferenceService(actor: Actor): Promise<MobileReferenceDto> {
  const [projects, activityTypes] = await Promise.all([
    repo.listProjects(actor),
    repo.listActivityTypes(actor),
  ])

  return mapReferenceDto(projects, activityTypes)
}
