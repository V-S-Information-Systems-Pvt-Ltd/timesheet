import { requireMobileActor, json, serverError, apiError, badRequest } from '@/app/api/v1/_http'
import { repo } from '@/lib/db'
import { parseSchema, reminderSchema } from '@/lib/validation-schemas'

export const runtime = 'nodejs'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireMobileActor(request)
    if (!auth.ok) return auth.response

    if (auth.actor.permission_role !== 'admin') {
      return apiError('FORBIDDEN', 'Only administrators can edit global reminders.', 403)
    }

    const { id } = await params
    if (!id) return badRequest('Reminder ID is required.')

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return badRequest('A JSON request body is required.')
    }

    const parsed = parseSchema(reminderSchema.partial(), body)
    if (!parsed.ok) {
      return badRequest(parsed.error.error)
    }

    const remindAt = parsed.data.remindAt ? new Date(parsed.data.remindAt).toISOString() : undefined
    const result = await repo.updateGlobalReminder(auth.actor, id, {
      message: parsed.data.message?.trim(),
      remindAt,
    })

    if (result.error) {
      return apiError('BAD_REQUEST', result.error, 400)
    }

    return json({ data: { success: true, id }, error: null })
  } catch (err) {
    return serverError(err)
  }
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
