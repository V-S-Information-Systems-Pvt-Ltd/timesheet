import { requireMobileActor, json, apiError, serverError } from '@/app/api/v1/_http'
import { repo } from '@/lib/db'

export const runtime = 'nodejs'

export async function POST(
  request: Request,
  props: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireMobileActor(request)
    if (!auth.ok) return auth.response

    const { id } = await props.params
    if (!id) {
      return apiError('INVALID_ID', 'Reminder ID is required', 400)
    }

    const result = await repo.dismissGlobalReminder(auth.actor, id)
    if (result.error) {
      return apiError('DISMISS_FAILED', result.error, 400)
    }

    return json({
      data: { success: true },
      error: null,
    })
  } catch (err) {
    return serverError(err)
  }
}
