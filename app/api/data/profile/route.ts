// app/api/data/profile/route.ts
import { json, requireSignedIn, serverError } from '@/app/api/_http'
import { peopleDeps } from '@/lib/db/people'
import { getSelfProfileDomain } from '@/lib/domain/people'

export async function GET() {
  try {
    const auth = await requireSignedIn()
    if (!auth.ok) return auth.response
    const result = await getSelfProfileDomain(auth.actor, peopleDeps())
    if (!result.ok) {
      return json({ error: result.error.message }, 403)
    }
    return json({ data: result.data })
  } catch (err) {
    return serverError(err)
  }
}
