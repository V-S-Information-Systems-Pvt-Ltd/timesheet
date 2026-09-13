import { withMobileActor, apiSuccess, serverError, apiError, badRequest } from '@/app/api/v1/_http'
import { workspaceDeps } from '@/lib/db/workspace'
import { parseSchema, backfillSettingsSchema } from '@/lib/validation-schemas'
import { getAdminBackfillSettings, setBackfillSettings } from '@/lib/domain/workspace'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  return withMobileActor(request, async (auth) => {
    try {
      const result = await getAdminBackfillSettings(auth.actor, workspaceDeps())
      if (!result.ok) {
        if (result.error.code === 'FORBIDDEN') {
          return apiError('FORBIDDEN', result.error.message, 403)
        }
        return serverError(result.error.message)
      }
      return apiSuccess(result.data)
    } catch (err) {
      return serverError(err)
    }
  })
}

export async function PUT(request: Request) {
  return withMobileActor(request, async (auth) => {
    try {
      const body = await request.json().catch(() => ({}))
      const parsed = parseSchema(backfillSettingsSchema, body)
      if (!parsed.ok) {
        return badRequest(parsed.error.error)
      }

      const setResult = await setBackfillSettings(auth.actor, parsed.data, workspaceDeps())
      if (!setResult.ok) {
        if (setResult.error.code === 'FORBIDDEN') {
          return apiError('FORBIDDEN', setResult.error.message, 403)
        }
        return apiError('BAD_REQUEST', setResult.error.message, 400)
      }

      const updated = await getAdminBackfillSettings(auth.actor, workspaceDeps())
      if (!updated.ok) {
        if (updated.error.code === 'FORBIDDEN') {
          return apiError('FORBIDDEN', updated.error.message, 403)
        }
        return serverError(updated.error.message)
      }
      return apiSuccess(updated.data)
    } catch (err) {
      return serverError(err)
    }
  })
}

export async function POST(request: Request) {
  return PUT(request)
}
