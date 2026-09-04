import { requireMobileActor, json, serverError, apiError } from '@/app/api/v1/_http'
import { listRemindersService, createReminderService } from '@/lib/api/v1/services/reminders'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  try {
    const auth = await requireMobileActor(request)
    if (!auth.ok) return auth.response

    const result = await listRemindersService(auth.actor)
    if (!result.success) {
      return apiError(result.code, result.message, result.status)
    }

    return json({ data: result.data, error: null })
  } catch (err) {
    return serverError(err)
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireMobileActor(request)
    if (!auth.ok) return auth.response

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return apiError('VALIDATION_ERROR', 'A JSON request body is required.', 400)
    }

    const result = await createReminderService(auth.actor, body)
    if (!result.success) {
      return apiError(result.code, result.message, result.status)
    }

    return json({ data: result.data, error: null }, result.status ?? 201)
  } catch (err) {
    return serverError(err)
  }
}
