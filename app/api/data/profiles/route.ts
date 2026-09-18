// app/api/data/profiles/route.ts
import { json, requireActive, serverError } from '@/app/api/_http'
import { peopleDeps } from '@/lib/db/people'
import { listPeopleDomain } from '@/lib/domain/people'

export async function GET() {
  try {
    const auth = await requireActive()
    if (!auth.ok) return auth.response
    const result = await listPeopleDomain(auth.actor, peopleDeps())
    if (!result.ok) {
      return json({ error: result.error.message }, 403)
    }
    return json({ data: result.data })
  } catch (err) {
    return serverError(err)
  }
}
