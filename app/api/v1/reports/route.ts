import { requireMobileActor, json, serverError, apiError } from '@/app/api/v1/_http'
import { getReportsService } from '@/lib/api/v1/services/reports'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  try {
    const auth = await requireMobileActor(request)
    if (!auth.ok) return auth.response

    const url = new URL(request.url)
    const result = await getReportsService(auth.actor, url.searchParams)
    if (!result.success) {
      return apiError(result.code, result.message, result.status)
    }

    return json({ data: result.data, error: null })
  } catch (err) {
    return serverError(err)
  }
}
