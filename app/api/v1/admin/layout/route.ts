import { requireMobileActor, json, serverError, apiError } from '../../_http'
import { repo } from '@/lib/db'
import { isSuperAdmin } from '@/lib/auth/super-admin'
import { DEFAULT_MOBILE_LAYOUT, sanitizeMobileLayout } from '@/lib/layout'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  const auth = await requireMobileActor(request)
  if (!auth.ok) return auth.response

  const { requestId } = auth
  try {
    const defRes = await repo.getDefaultLayouts(auth.actor)
    if (defRes.error) {
      return serverError(defRes.error, { requestId })
    }
    const defaultLayout = defRes.data?.mobile ?? DEFAULT_MOBILE_LAYOUT
    return json({ data: { layout: defaultLayout }, error: null }, 200, { 'x-request-id': requestId })
  } catch (err) {
    return serverError(err, { requestId })
  }
}

export async function PUT(request: Request) {
  const auth = await requireMobileActor(request)
  if (!auth.ok) return auth.response

  const { actor, requestId } = auth
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

    const defRes = await repo.getDefaultLayouts(actor)
    if (defRes.error) {
      return serverError(defRes.error, { requestId })
    }
    const currentDefaults = defRes.data

    if (body.reset === true) {
      const writeRes = await repo.setDefaultLayouts(actor, {
        dashboard: currentDefaults?.dashboard ?? { tiles: [] },
        admin: currentDefaults?.admin ?? { tiles: [] },
        mobile: null,
      })
      if (writeRes.error) {
        return serverError(writeRes.error, { requestId })
      }
      return json({ data: { layout: DEFAULT_MOBILE_LAYOUT }, error: null }, 200, { 'x-request-id': requestId })
    }

    if (!body.layout || !Array.isArray(body.layout.modules)) {
      return apiError('INVALID_PAYLOAD', 'A valid layout with modules array is required.', 400, {
        'x-request-id': requestId,
      })
    }

    const sanitizedLayout = sanitizeMobileLayout(body.layout, DEFAULT_MOBILE_LAYOUT)
    if (!sanitizedLayout) {
      return apiError('INVALID_PAYLOAD', 'Failed to sanitize layout.', 400, {
        'x-request-id': requestId,
      })
    }

    const writeRes = await repo.setDefaultLayouts(actor, {
      dashboard: currentDefaults?.dashboard ?? { tiles: [] },
      admin: currentDefaults?.admin ?? { tiles: [] },
      mobile: sanitizedLayout,
    })
    if (writeRes.error) {
      return serverError(writeRes.error, { requestId })
    }

    return json({ data: { layout: sanitizedLayout }, error: null }, 200, { 'x-request-id': requestId })
  } catch (err) {
    return serverError(err, { requestId })
  }
}
