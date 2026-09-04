import { requireMobileActor, json, serverError, apiError } from '../../_http'
import { repo } from '@/lib/db'
import { isSuperAdmin } from '@/lib/auth/super-admin'
import { DEFAULT_BRANDING, validateBranding } from '@/lib/branding'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  const auth = await requireMobileActor(request)
  if (!auth.ok) return auth.response

  const { actor, requestId } = auth
  if (!isSuperAdmin(actor)) {
    return apiError('FORBIDDEN', 'Super-admin access required.', 403, {
      'x-request-id': requestId,
    })
  }

  const res = await repo.getBranding(actor)
  if (res.error) {
    return serverError(res.error, { requestId })
  }

  return json(
    {
      data: res.data ?? DEFAULT_BRANDING,
      error: null,
    },
    200,
    { 'x-request-id': requestId }
  )
}

export async function PUT(request: Request) {
  const auth = await requireMobileActor(request)
  if (!auth.ok) return auth.response

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
    const writeRes = await repo.setBranding(actor, DEFAULT_BRANDING)
    if (writeRes.error) {
      return serverError(writeRes.error, { requestId })
    }
    return json(
      {
        data: DEFAULT_BRANDING,
        error: null,
      },
      200,
      { 'x-request-id': requestId }
    )
  }

  const payload = (body.branding ?? body) as Record<string, unknown>
  const validation = validateBranding(payload)

  if (!validation.valid || !validation.data) {
    return json(
      {
        data: null,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid workspace branding settings.',
          fieldErrors: validation.errors,
        },
      },
      400,
      { 'x-request-id': requestId }
    )
  }

  const writeRes = await repo.setBranding(actor, validation.data)
  if (writeRes.error) {
    return serverError(writeRes.error, { requestId })
  }

  return json(
    {
      data: validation.data,
      error: null,
    },
    200,
    { 'x-request-id': requestId }
  )
}
