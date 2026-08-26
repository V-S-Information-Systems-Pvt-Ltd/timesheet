import { requireMobileActor, json, serverError } from '@/app/api/v1/_http'
import { repo } from '@/lib/db'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  try {
    const auth = await requireMobileActor(request)
    if (!auth.ok) return auth.response

    const profiles = await repo.listProfiles(auth.actor)
    return json({
      data: profiles.map((p) => ({
        id: p.id,
        email: p.email,
        name: p.name || p.email,
        role: p.role,
        permissionRole: p.permission_role,
        hierarchyRole: p.hierarchy_role,
        department: p.department,
        title: p.title,
        managerId: p.manager_id,
        isActive: p.is_active ?? true,
      })),
      error: null,
    })
  } catch (err) {
    return serverError(err)
  }
}
