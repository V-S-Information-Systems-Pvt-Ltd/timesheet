import { requireMobileActor, json, serverError, apiError, badRequest } from '@/app/api/v1/_http'
import { repo } from '@/lib/db'
import { isNonEmpty } from '@/lib/validation'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  try {
    const auth = await requireMobileActor(request)
    if (!auth.ok) return auth.response

    if (auth.actor.permission_role !== 'admin' && auth.actor.permission_role !== 'pm') {
      return apiError('FORBIDDEN', 'Only admins and project managers can view project administration.', 403)
    }

    const data = await repo.listProjects(auth.actor)
    return json({ data, error: null })
  } catch (err) {
    return serverError(err)
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireMobileActor(request)
    if (!auth.ok) return auth.response

    if (auth.actor.permission_role !== 'admin' && auth.actor.permission_role !== 'pm') {
      return apiError('FORBIDDEN', 'Only admins and project managers can create projects.', 403)
    }

    const body = await request.json().catch(() => ({}))
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    const soNumber = typeof body.soNumber === 'string' ? body.soNumber.trim() : null
    const telegramNo = typeof body.telegramNo === 'number' ? body.telegramNo : null

    if (!isNonEmpty(name)) {
      return badRequest('Project name is required.')
    }

    if (telegramNo !== null && (!Number.isInteger(telegramNo) || telegramNo <= 0)) {
      return badRequest('Bot number must be a positive whole number.')
    }

    const createRes = await repo.createProject(auth.actor, name)
    if (createRes.error) {
      return apiError('CONFLICT', createRes.error, 409)
    }

    // Find the newly created project
    const allProjects = await repo.listProjects(auth.actor)
    const project = allProjects.find((p) => p.name === name)

    if (project) {
      if (soNumber) {
        await repo.setProjectSO(auth.actor, project.id, soNumber)
      }
      if (telegramNo) {
        await repo.setProjectTelegramNo(auth.actor, project.id, telegramNo)
      }
    }

    const refreshed = await repo.listProjects(auth.actor)
    const finalProject = refreshed.find((p) => p.name === name) ?? project

    return json({ data: finalProject, error: null }, { status: 201 })
  } catch (err) {
    return serverError(err)
  }
}
