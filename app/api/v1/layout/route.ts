import { withMobileActor, json, serverError, apiError } from '../_http'
import {
  getPersonalLayoutService,
  resetPersonalLayoutService,
  savePersonalLayoutService,
} from '@/lib/api/v1/services/workspace'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  return withMobileActor(request, async (auth) => {
    const { actor, requestId } = auth
    try {
      const result = await getPersonalLayoutService(actor)
      if (!result.success) {
        return serverError(result.message, { requestId })
      }

      const { layout, savedLayout, defaultLayout, capabilities } = result.data
      return json(
        {
          data: {
            layout,
            savedLayout,
            defaultLayout,
            capabilities,
          },
          error: null,
        },
        200,
        { 'x-request-id': requestId }
      )
    } catch (err) {
      return serverError(err, { requestId })
    }
  })
}

export async function PUT(request: Request) {
  return withMobileActor(request, async (auth) => {
    const { actor, requestId } = auth
    try {
      const body = await request.json().catch(() => null)
      if (!body || typeof body !== 'object') {
        return apiError('INVALID_PAYLOAD', 'Request body must be a JSON object.', 400, {
          'x-request-id': requestId,
        })
      }

      if (body.reset === true) {
        const result = await resetPersonalLayoutService(actor)
        if (!result.success) {
          return serverError(result.message, { requestId })
        }
        return json(
          {
            data: {
              layout: result.data.layout,
              savedLayout: null,
            },
            error: null,
          },
          200,
          { 'x-request-id': requestId }
        )
      }

      if (!body.layout || !Array.isArray(body.layout.modules)) {
        return apiError('INVALID_PAYLOAD', 'A valid layout with modules array is required.', 400, {
          'x-request-id': requestId,
        })
      }

      const result = await savePersonalLayoutService(actor, body.layout)
      if (!result.success) {
        return apiError(result.code, result.message, result.status, { 'x-request-id': requestId })
      }

      return json(
        {
          data: {
            layout: result.data.layout,
            savedLayout: result.data.savedLayout,
          },
          error: null,
        },
        200,
        { 'x-request-id': requestId }
      )
    } catch (err) {
      return serverError(err, { requestId })
    }
  })
}
