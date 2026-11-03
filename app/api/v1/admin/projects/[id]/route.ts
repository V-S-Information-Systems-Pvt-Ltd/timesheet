import { apiError, withMobileActor, serverError, serviceResultResponse } from '@/app/api/v1/_http'
import { deleteProjectAdmin, updateProjectAdmin, updateProjectBrowser } from '@/lib/api/v1/services/reference-admin'
import type { UpdateProjectPatch } from '@/lib/domain/reference'

export const runtime = 'nodejs'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function PATCH(request: Request, { params }: RouteParams) {
  return withMobileActor(request, async (auth) => {
    try {
      const { id: projectId } = await params
      const body = await request.json().catch(() => ({}))
      if (auth.via === 'cookie' && (!body || typeof body !== 'object' || Array.isArray(body))) {
        return apiError('VALIDATION_ERROR', 'A project patch object is required.', 400)
      }
      if (auth.via === 'cookie') {
        if (!('name' in body || 'soNumber' in body || 'hidden' in body || 'departments' in body)) {
          return apiError('VALIDATION_ERROR', 'No project changes provided.', 400)
        }
        if ('soNumber' in body && body.soNumber !== null && typeof body.soNumber !== 'string') {
          return apiError('VALIDATION_ERROR', 'Invalid project field type.', 400)
        }
      }
      if ('hidden' in body && typeof body.hidden !== 'boolean') {
        return apiError('VALIDATION_ERROR', 'Invalid project field type.', 400)
      }
      if ('departments' in body && !(Array.isArray(body.departments) && body.departments.length <= 100 && body.departments.every((d: unknown) => typeof d === 'string'))) {
        return apiError('VALIDATION_ERROR', 'Invalid project field type.', 400)
      }

      const patch: UpdateProjectPatch = {}
      if ('name' in body) patch.name = typeof body.name === 'string' ? body.name : ''
      if ('soNumber' in body) patch.soNumber = typeof body.soNumber === 'string' ? body.soNumber : null
      if ('hidden' in body) patch.hidden = body.hidden
      if ('departments' in body) patch.departments = body.departments

      if (auth.via === 'cookie') {
        return serviceResultResponse(await updateProjectBrowser(auth.actor, projectId, patch))
      }
      return serviceResultResponse(await updateProjectAdmin(auth.actor, projectId, patch))
    } catch (err) {
      return serverError(err)
    }
  }, { allowCookie: true })
}

export async function DELETE(request: Request, { params }: RouteParams) {
  return withMobileActor(request, async (auth) => {
    try {
      const { id: projectId } = await params
      return serviceResultResponse(await deleteProjectAdmin(auth.actor, projectId))
    } catch (err) {
      return serverError(err)
    }
  }, { allowCookie: true })
}
