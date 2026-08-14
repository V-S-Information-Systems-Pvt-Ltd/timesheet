// app/api/data/activity-types/route.ts
import { json, requireSignedIn, serverError } from '@/app/api/_http'
import { repo } from '@/lib/db'

export async function GET(request: Request) {
  try {
    const auth = await requireSignedIn()
    if (!auth.ok) return auth.response

    const all = new URL(request.url).searchParams.get('all') === '1'
    const data = all
      ? await repo.listAllActivityTypes(auth.actor)
      : await repo.listActivityTypes(auth.actor)
    return json({ data })
  } catch (err) {
    return serverError(err)
  }
}
