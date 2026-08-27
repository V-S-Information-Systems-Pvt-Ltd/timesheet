import { requireMobileActor, json, serverError, apiError } from '@/app/api/v1/_http'
import { deleteLeaveService } from '@/lib/api/v1/services/leaves'

export const runtime = 'nodejs'

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireMobileActor(request)
    if (!auth.ok) return auth.response
    const { id } = await params

    const result = await deleteLeaveService(auth.actor, id)
    if (!result.success) {
      return apiError(result.code, result.message, result.status)
    }

    return json({ data: result.data, error: null })
  } catch (err) {
    return serverError(err)
  }
}
