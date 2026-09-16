// app/api/data/activity-types/route.ts
import { json, requireActive, serverError } from '@/app/api/_http'
import { referenceDeps } from '@/lib/db/reference'
import { listActivityTypes, listAllActivityTypes } from '@/lib/domain/reference'

export async function GET(request: Request) {
  try {
    const auth = await requireActive()
    if (!auth.ok) return auth.response

    const all = new URL(request.url).searchParams.get('all') === '1'
    const result = all
      ? await listAllActivityTypes(auth.actor, referenceDeps())
      : await listActivityTypes(auth.actor, referenceDeps())
    if (!result.ok) throw new Error(result.error.message)
    return json({ data: result.data })
  } catch (err) {
    return serverError(err)
  }
}
