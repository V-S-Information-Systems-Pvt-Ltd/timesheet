import { requireMobileActor, json, serverError } from '@/app/api/v1/_http'
import { repo } from '@/lib/db'

import { withRequestLogging } from '../_observability'
export const runtime = 'nodejs'

export const GET = withRequestLogging('GET /api/v1/reference', async (request: Request) => {
  try {
    const auth = await requireMobileActor(request)
    if (!auth.ok) return auth.response
    const [projects, activityTypes] = await Promise.all([
      repo.listProjects(auth.actor),
      repo.listActivityTypes(auth.actor),
    ])
    return json({ data: { projects, activityTypes }, error: null })
  } catch (err) {
    return serverError(err)
  }
})
