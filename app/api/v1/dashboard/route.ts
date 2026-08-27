import { requireMobileActor, json, serverError } from '@/app/api/v1/_http'
import { getDashboardService } from '@/lib/api/v1/services/dashboard'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  try {
    const auth = await requireMobileActor(request)
    if (!auth.ok) return auth.response

    const data = await getDashboardService(auth.actor)
    return json({ data, error: null })
  } catch (err) {
    return serverError(err)
  }
}
