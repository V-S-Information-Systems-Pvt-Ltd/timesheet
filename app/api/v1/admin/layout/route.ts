import { withMobileActor, apiSuccess, serverError, apiError } from '../../_http'
import { isSuperAdmin } from '@/lib/auth/super-admin'
import {
  getAdminLayoutService,
  resetAdminLayoutService,
  saveAdminLayoutService,
} from '@/lib/api/v1/services/workspace'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  return withMobileActor(request, async (auth) => {
    const { actor, requestId } = auth
    try {
      const result = await getAdminLayoutService(actor)
      if (!result.success) {
        return serverError(result.message, { requestId })
      }
      return apiSuccess({ layout: result.data.layout }, 200, { 'x-request-id': requestId })
    } catch (err) {
      return serverError(err, { requestId })
    }
  })
}

export async function PUT(request: Request) {
  return withMobileActor(request, async (auth) => {
    const { actor, requestId } = auth
    // Super-admin gate before request parsing, so unauthorized callers never
    // reach body handling. The workspace service re-checks as defense-in-depth.
    if (!isSuperAdmin(actor)) {
      return apiError('FORBIDDEN', 'Only super-administrators can update workspace default layouts.', 403, {
        'x-request-id': requestId,
      })
    }

    try {
      const body = await request.json().catch(() => null)
      if (!body || typeof body !== 'object') {
        return apiError('INVALID_PAYLOAD', 'Request body must be a JSON object.', 400, {
          'x-request-id': requestId,
        })
      }

      if (body.reset === true) {
        const result = await resetAdminLayoutService(actor)
        if (!result.success) {
          return serverError(result.message, { requestId })
        }
        return apiSuccess({ layout: result.data.layout }, 200, { 'x-request-id': requestId })
      }

      if (!body.layout || !Array.isArray(body.layout.modules)) {
        return apiError('INVALID_PAYLOAD', 'A valid layout with modules array is required.', 400, {
          'x-request-id': requestId,
        })
      }

      const result = await saveAdminLayoutService(actor, body.layout)
      if (!result.success) {
        return apiError(result.code, result.message, result.status, { 'x-request-id': requestId })
      }

      return apiSuccess({ layout: result.data.layout }, 200, { 'x-request-id': requestId })
    } catch (err) {
      return serverError(err, { requestId })
    }
  })
}
