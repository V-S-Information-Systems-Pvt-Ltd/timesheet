import { withMobileActor, serverError, serviceResultResponse } from '@/app/api/v1/_http'
import { deleteLeaveService } from '@/lib/api/v1/services/leaves'
import { withIdempotency } from '@/lib/idempotency'

export const runtime = 'nodejs'

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return withMobileActor(request, async (auth) => {
    try {
      const { id } = await params

      return await withIdempotency(request, auth.actor.id, 'delete_leave', { id }, async () => {
        const result = await deleteLeaveService(auth.actor, id)
        return serviceResultResponse(result)
      })
    } catch (err) {
      return serverError(err)
    }
  })
}
