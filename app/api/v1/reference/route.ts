import { requireMobileActor, json, serverError } from '@/app/api/v1/_http'
import { getReferenceService } from '@/lib/api/v1/services/reference'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  try {
    const auth = await requireMobileActor(request)
    if (!auth.ok) return auth.response
    const data = await getReferenceService(auth.actor)
    return json({ data, error: null })
  } catch (err) {
    return serverError(err)
  }
}
