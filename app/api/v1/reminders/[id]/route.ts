import { requireMobileActor, json, serverError, apiError } from '@/app/api/v1/_http'
import { repo } from '@/lib/db'

export const runtime = 'nodejs'

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireMobileActor(request)
    if (!auth.ok) return auth.response
    const { id } = await params

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return apiError('VALIDATION_ERROR', 'A JSON request body is required.', 400)
    }

    const done = Boolean((body as { done?: unknown })?.done)
    const result = await repo.updateReminder(auth.actor, id, { done })
    if (result.error) return apiError('DB_ERROR', result.error, 400)
    return json({ data: { success: true }, error: null })
  } catch (err) {
    return serverError(err)
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireMobileActor(request)
    if (!auth.ok) return auth.response
    const { id } = await params

    const result = await repo.deleteReminder(auth.actor, id)
    if (result.error) return apiError('DB_ERROR', result.error, 400)
    return json({ data: { success: true }, error: null })
  } catch (err) {
    return serverError(err)
  }
}
