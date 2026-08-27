import { requireMobileActor, json, serverError, apiError } from '@/app/api/v1/_http'
import { duplicateTimesheetService } from '@/lib/api/v1/services/timesheets'

export const runtime = 'nodejs'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireMobileActor(request)
    if (!auth.ok) return auth.response
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

    const result = await duplicateTimesheetService(auth.actor, id, targetDate)
    if (!result.ok) {
      return apiError(result.error.code, result.error.message, result.error.status)
    }

    return json({ data: result.data, error: null }, 201)
  } catch (err) {
    return serverError(err)
  }
}
