import { requireMobileActor, json, serverError, apiError, badRequest } from '@/app/api/v1/_http'
import { repo } from '@/lib/db'
import { parseSchema, backfillSettingsSchema } from '@/lib/validation-schemas'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  try {
    const auth = await requireMobileActor(request)
    if (!auth.ok) return auth.response

    if (auth.actor.permission_role !== 'admin') {
      return apiError('FORBIDDEN', 'Only administrators can view backfill settings.', 403)
    }

    const settings = await repo.getBackfillWindow(auth.actor)
    return json({ data: settings, error: null })
  } catch (err) {
    return serverError(err)
  }
}

export async function PUT(request: Request) {
  try {
    const auth = await requireMobileActor(request)
    if (!auth.ok) return auth.response

    if (auth.actor.permission_role !== 'admin') {
      return apiError('FORBIDDEN', 'Only administrators can update backfill settings.', 403)
    }

    const body = await request.json().catch(() => ({}))
    const parsed = parseSchema(backfillSettingsSchema, body)
    if (!parsed.ok) {
      return badRequest(parsed.error.error)
    }

    const res = await repo.setBackfillWindow(auth.actor, parsed.data)
    if (res.error) {
      return apiError('BAD_REQUEST', res.error, 400)
    }

    const updated = await repo.getBackfillWindow(auth.actor)
    return json({ data: updated, error: null })
  } catch (err) {
    return serverError(err)
  }
}

export async function POST(request: Request) {
  return PUT(request)
}
