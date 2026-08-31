import { requireMobileActor, json, serverError, apiError, badRequest } from '@/app/api/v1/_http'
import { repo } from '@/lib/db'
import { isNonEmpty } from '@/lib/validation'

export const runtime = 'nodejs'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireMobileActor(request)
    if (!auth.ok) return auth.response

    if (auth.actor.permission_role !== 'admin' && auth.actor.permission_role !== 'pm') {
      return apiError('FORBIDDEN', 'Only admins and project managers can modify projects.', 403)
    }

    const { id: projectId } = await params
    if (!projectId) return badRequest('Project ID is required.')

    const body = await request.json().catch(() => ({}))

    if ('name' in body) {
      const name = typeof body.name === 'string' ? body.name.trim() : ''
      if (!isNonEmpty(name)) return badRequest('Project name is required.')
      const res = await repo.renameProject(auth.actor, projectId, name)
      if (res.error) return apiError('CONFLICT', res.error, 409)
    }

    if ('soNumber' in body) {
      const soNumber = typeof body.soNumber === 'string' ? body.soNumber.trim() : null
      const res = await repo.setProjectSO(auth.actor, projectId, soNumber)
      if (res.error) return apiError('BAD_REQUEST', res.error, 400)
    }

    if ('telegramNo' in body) {
      const telegramNo = typeof body.telegramNo === 'number' ? body.telegramNo : null
      if (telegramNo !== null && (!Number.isInteger(telegramNo) || telegramNo <= 0)) {
        return badRequest('Bot number must be a positive whole number.')
      }
      const res = await repo.setProjectTelegramNo(auth.actor, projectId, telegramNo)
      if (res.error) return apiError('BAD_REQUEST', res.error, 400)
    }

    const all = await repo.listProjects(auth.actor)
    const updated = all.find((p) => p.id === projectId)
    return json({ data: updated, error: null })
  } catch (err) {
    return serverError(err)
  }
}

export async function DELETE(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireMobileActor(request)
    if (!auth.ok) return auth.response

    if (auth.actor.permission_role !== 'admin' && auth.actor.permission_role !== 'pm') {
      return apiError('FORBIDDEN', 'Only admins and project managers can delete projects.', 403)
    }

    const { id: projectId } = await params
    if (!projectId) return badRequest('Project ID is required.')

    const result = await repo.deleteProject(auth.actor, projectId)
    if (result.error) {
      return apiError('CONFLICT', result.error, 409)
    }

    return json({ data: { success: true, id: projectId }, error: null })
  } catch (err) {
    return serverError(err)
  }
}
