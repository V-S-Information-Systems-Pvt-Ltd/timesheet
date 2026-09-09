import { withMobileActor, json, serverError, apiError } from '@/app/api/v1/_http'
import { duplicateTimesheetService } from '@/lib/api/v1/services/timesheets'
import { withIdempotency } from '@/lib/idempotency'
import { repo } from '@/lib/db'

export const runtime = 'nodejs'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return withMobileActor(request, async (auth) => {
    try {
      const { id } = await params

      let targetDate: string | undefined
      try {
        const text = await request.text()
        if (text.trim()) {
          const body = JSON.parse(text)
          if (body && typeof body.targetDate === 'string') {
            targetDate = body.targetDate
          }
        }
      } catch {
        // Body is optional
      }

      return await withIdempotency(
        request,
        auth.actor.id,
        'duplicate_timesheet',
        { id, targetDate: targetDate ?? null },
        async () => {
          const result = await duplicateTimesheetService(auth.actor, id, targetDate)
          if (!result.ok) {
            return apiError(result.error.code, result.error.message, result.error.status)
          }

          return json({ data: result.data, error: null }, 201)
        },
        {
          // T19.2: never return the stored entry DTO from a replay without
          // rechecking the caller's current access to the source entry.
          reauthorize: async () => {
            const existing = await repo.getTimesheet(auth.actor, id).catch(() => null)
            if (!existing) {
              return apiError('FORBIDDEN', 'You no longer have access to this timesheet entry.', 403)
            }
            return null
          },
        }
      )
    } catch (err) {
      return serverError(err)
    }
  })
}
