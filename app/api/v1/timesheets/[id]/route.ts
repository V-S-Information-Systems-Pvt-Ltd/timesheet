import { withMobileActor, json, serverError, apiError } from '@/app/api/v1/_http'
import { parseSchema, logEntrySchema } from '@/lib/validation-schemas'
import { updateTimesheetService, deleteTimesheetService } from '@/lib/api/v1/services/timesheets'
import { withIdempotency } from '@/lib/idempotency'

export const runtime = 'nodejs'

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return withMobileActor(request, async (auth) => {
    try {
      const { id } = await params

      let body: unknown
      try {
        body = await request.json()
      } catch {
        return apiError('VALIDATION_ERROR', 'A JSON request body is required.', 400)
      }

      const parsed = parseSchema(logEntrySchema, body)
      if (!parsed.ok) {
        return apiError('VALIDATION_ERROR', parsed.error.error, 400)
      }

      return await withIdempotency(request, auth.actor.id, 'update_timesheet', { id, ...parsed.data }, async () => {
        const result = await updateTimesheetService(auth.actor, id, parsed.data)
        if (!result.ok) {
          return apiError(result.error.code, result.error.message, result.error.status)
        }
        return json({ data: result.data, error: null })
      })
    } catch (err) {
      return serverError(err)
    }
  })
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return withMobileActor(request, async (auth) => {
    try {
      const { id } = await params

      return await withIdempotency(request, auth.actor.id, 'delete_timesheet', { id }, async () => {
        const result = await deleteTimesheetService(auth.actor, id)
        if (!result.ok) {
          return apiError(result.error.code, result.error.message, result.error.status)
        }
        return json({ data: result.data, error: null })
      })
    } catch (err) {
      return serverError(err)
    }
  })
}
