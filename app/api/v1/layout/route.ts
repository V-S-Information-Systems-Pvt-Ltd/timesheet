import { requireMobileActor, json, serverError, apiError } from '../_http'
import { repo } from '@/lib/db'
import { getActorCapabilities } from '@/lib/roles'
import { DEFAULT_MOBILE_LAYOUT, resolveMobileLayout, sanitizeMobileLayout } from '@/lib/layout'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  const auth = await requireMobileActor(request)
  if (!auth.ok) return auth.response

  const { actor, requestId } = auth
  try {
    const [savedRes, defRes] = await Promise.all([
      repo.getMobileLayout(actor),
      repo.getDefaultLayouts(actor),
    ])

    if (savedRes.error || defRes.error) {
      return serverError(savedRes.error ?? defRes.error, { requestId })
    }

    const capabilities = getActorCapabilities(actor)
    const defaultLayout = defRes.data?.mobile ?? DEFAULT_MOBILE_LAYOUT
    const effectiveLayout = resolveMobileLayout(savedRes.data, defaultLayout, capabilities)

    return json(
      {
        data: {
          layout: effectiveLayout,
          savedLayout: savedRes.data,
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
}

export async function PUT(request: Request) {
  const auth = await requireMobileActor(request)
  if (!auth.ok) return auth.response

  const { actor, requestId } = auth
  try {
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return apiError('INVALID_PAYLOAD', 'Request body must be a JSON object.', 400, {
        'x-request-id': requestId,
      })
    }

    const defRes = await repo.getDefaultLayouts(actor)
    if (defRes.error) {
      return serverError(defRes.error, { requestId })
    }
    const defaultLayout = defRes.data?.mobile ?? DEFAULT_MOBILE_LAYOUT
    const capabilities = getActorCapabilities(actor)

    if (body.reset === true) {
      const writeRes = await repo.setMobileLayout(actor, null)
      if (writeRes.error) {
        return serverError(writeRes.error, { requestId })
      }
      const effectiveLayout = resolveMobileLayout(null, defaultLayout, capabilities)
      return json(
        {
          data: {
            layout: effectiveLayout,
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

    const sanitizedLayout = sanitizeMobileLayout(body.layout, defaultLayout)
    if (!sanitizedLayout) {
      return apiError('INVALID_PAYLOAD', 'Failed to sanitize layout.', 400, {
        'x-request-id': requestId,
      })
    }

    const writeRes = await repo.setMobileLayout(actor, sanitizedLayout)
    if (writeRes.error) {
      return serverError(writeRes.error, { requestId })
    }

    const effectiveLayout = resolveMobileLayout(sanitizedLayout, defaultLayout, capabilities)
    return json(
      {
        data: {
          layout: effectiveLayout,
          savedLayout: sanitizedLayout,
        },
        error: null,
      },
      200,
      { 'x-request-id': requestId }
    )
  } catch (err) {
    return serverError(err, { requestId })
  }
}
