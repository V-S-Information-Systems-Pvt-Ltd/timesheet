import { requireMobileActor, json, serverError, apiError } from '@/app/api/v1/_http'
import { listPeopleService } from '@/lib/api/v1/services/people'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  try {
    const auth = await requireMobileActor(request)
    if (!auth.ok) return auth.response

    const result = await listPeopleService(auth.actor)
    if (!result.success) {
      return apiError(result.code, result.message, result.status)
    }

    return json({
      data: result.data,
      error: null,
    })
  } catch (err) {
    return serverError(err)
  }
}
