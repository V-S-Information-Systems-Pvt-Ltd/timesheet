import { requireMobileActor, json, serverError } from '@/app/api/v1/_http'
import { repo } from '@/lib/db'

export const runtime = 'nodejs'

export async function GET(request: Request) {
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
}
