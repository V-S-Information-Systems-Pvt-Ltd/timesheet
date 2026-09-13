import { withMobileActor, json, serverError, apiError } from '../../_http'
import { workspaceDeps } from '@/lib/db/workspace'
import { isSuperAdmin } from '@/lib/auth/super-admin'
import {
  getAdminWorkspaceBranding,
  resetWorkspaceBranding,
  saveWorkspaceBranding,
} from '@/lib/domain/workspace'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  return withMobileActor(request, async (auth) => {
    const { actor, requestId } = auth
    if (!isSuperAdmin(actor)) {
      return apiError('FORBIDDEN', 'Super-admin access required.', 403, {
        'x-request-id': requestId,
      })
    }

    const result = await getAdminWorkspaceBranding(actor, workspaceDeps())
    if (!result.ok) {
      if (result.error.code === 'FORBIDDEN') {
        return apiError('FORBIDDEN', result.error.message, 403, { 'x-request-id': requestId })
      }
      return serverError(result.error.message, { requestId })
    }

    return json(
      {
        data: result.data,
        error: null,
      },
      200,
      { 'x-request-id': requestId }
    )
  })
}

export async function PUT(request: Request) {
  return withMobileActor(request, async (auth) => {
    const { actor, requestId } = auth
    if (!isSuperAdmin(actor)) {
      return apiError('FORBIDDEN', 'Super-admin access required.', 403, {
        'x-request-id': requestId,
      })
    }

    let body: Record<string, unknown>
    try {
      body = (await request.json()) as Record<string, unknown>
    } catch {
      return apiError('INVALID_JSON', 'Request body must be valid JSON.', 400, {
        'x-request-id': requestId,
      })
    }

    if (body.reset === true) {
      const result = await resetWorkspaceBranding(actor, workspaceDeps())
      if (!result.ok) {
        return serverError(result.error.message, { requestId })
      }
      return json(
        {
          data: result.data,
          error: null,
        },
        200,
        { 'x-request-id': requestId }
      )
    }

    const payload = (body.branding ?? body) as Record<string, unknown>
    const result = await saveWorkspaceBranding(actor, payload, workspaceDeps())

    if (!result.ok) {
      if (result.error.code === 'VALIDATION_ERROR') {
        return json(
          {
            data: null,
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Invalid workspace branding settings.',
              fieldErrors: result.error.fieldErrors,
            },
          },
          400,
          { 'x-request-id': requestId }
        )
      }
      return serverError(result.error.message, { requestId })
    }

    return json(
      {
        data: result.data,
        error: null,
      },
      200,
      { 'x-request-id': requestId }
    )
  })
}
