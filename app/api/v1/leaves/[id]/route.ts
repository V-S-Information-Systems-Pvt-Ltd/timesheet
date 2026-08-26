import { requireMobileActor, json, serverError, apiError } from '@/app/api/v1/_http'
import { repo } from '@/lib/db'

export const runtime = 'nodejs'

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireMobileActor(request)
    if (!auth.ok) return auth.response
    const { id } = await params

    const result = await repo.deleteLeave(auth.actor, id)
    if (result.error) return apiError('DB_ERROR', result.error, 400)
    return json({ data: { success: true }, error: null })
  } catch (err) {
    return serverError(err)
  }
}
