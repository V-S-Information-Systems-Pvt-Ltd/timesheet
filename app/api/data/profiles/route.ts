// app/api/data/profiles/route.ts
import { json, requireActive, serverError } from '@/app/api/_http'
import { repo } from '@/lib/db'
import { canSeeAllActor, isLeaderActor } from '@/lib/roles'

export async function GET() {
  try {
    const auth = await requireActive()
    if (!auth.ok) return auth.response
    if (!canSeeAllActor(auth.actor) && !isLeaderActor(auth.actor)) {
      return json({ error: 'You do not have permission to perform this action.' }, 403)
    }
    const data = await repo.listProfiles(auth.actor)
    return json({ data })
  } catch (err) {
    return serverError(err)
  }
}
