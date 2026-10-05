import { apiError, apiSuccess, serverError, withMobileActor } from '@/app/api/v1/_http'
import { isAdminActor } from '@/lib/roles'
import { importTimesheetsForActor } from '@/lib/import-timesheets'
import { browserTimesheetImportSchema } from '@vsis/contracts'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  return withMobileActor(request, async (auth) => {
    try {
      if (!isAdminActor(auth.actor)) {
        return apiError('FORBIDDEN', 'You do not have permission to perform this action.', 403)
      }
      const parsed = browserTimesheetImportSchema.safeParse(await request.json().catch(() => null))
      if (!parsed.success) {
        return apiError('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Import rows are required.', 400)
      }
      const result = await importTimesheetsForActor(auth.actor, parsed.data.rows)
      return result.error
        ? apiError('BAD_REQUEST', result.error, 400)
        : apiSuccess(result)
    } catch (err) {
      return serverError(err)
    }
  }, { allowCookie: true })
}
