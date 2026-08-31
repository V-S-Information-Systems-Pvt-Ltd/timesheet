import { requireMobileActor, json, serverError, apiError, badRequest } from '@/app/api/v1/_http'
import { repo } from '@/lib/db'

export const runtime = 'nodejs'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function DELETE(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireMobileActor(request)
    if (!auth.ok) return auth.response

    if (auth.actor.permission_role !== 'admin') {
      return apiError('FORBIDDEN', 'Only administrators can delete global reminders.', 403)
    }

    const { id } = await params
    if (!id) return badRequest('Reminder ID is required.')

    const result = await repo.deleteGlobalReminder(auth.actor, id)
    if (result.error) {
      return apiError('BAD_REQUEST', result.error, 400)
    }

    return json({ data: { success: true, id }, error: null })
  } catch (err) {
    return serverError(err)
  }
}
