import { apiError, apiSuccess, serverError, withMobileActor } from '@/app/api/v1/_http'
import type { AdminDashboardLayout, DashboardLayout } from '@/app/types'
import { workspaceDeps } from '@/lib/db/workspace'
import { getDefaultLayouts, saveAdminLayout, saveDashboardLayout, saveDefaultLayouts } from '@/lib/domain/workspace'
import { browserDefaultLayoutsSchema, browserLayoutMutationSchema } from '@vsis/contracts'

export const runtime = 'nodejs'

function workspaceError(error: { code: string; message: string }) {
  return apiError(
    error.code === 'STORAGE_ERROR' ? 'BAD_REQUEST' : error.code,
    error.message,
    error.code === 'FORBIDDEN' ? 403 : 400
  )
}

export async function GET(request: Request) {
  return withMobileActor(request, async (auth) => {
    try {
      const result = await getDefaultLayouts(auth.actor, workspaceDeps())
      return result.ok ? apiSuccess(result.data) : workspaceError(result.error)
    } catch (err) {
      return serverError(err)
    }
  }, { allowCookie: true })
}

export async function PATCH(request: Request) {
  return withMobileActor(request, async (auth) => {
    try {
      const parsed = browserLayoutMutationSchema.safeParse(await request.json().catch(() => null))
      if (!parsed.success) {
        return apiError('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'A layout mutation is required.', 400)
      }
      const result = parsed.data.target === 'dashboard'
        ? await saveDashboardLayout(auth.actor, parsed.data.layout as DashboardLayout, workspaceDeps())
        : await saveAdminLayout(auth.actor, parsed.data.layout as AdminDashboardLayout, workspaceDeps())
      return result.ok ? apiSuccess({ success: true }) : workspaceError(result.error)
    } catch (err) {
      return serverError(err)
    }
  }, { allowCookie: true })
}

export async function PUT(request: Request) {
  return withMobileActor(request, async (auth) => {
    try {
      const parsed = browserDefaultLayoutsSchema.safeParse(await request.json().catch(() => null))
      if (!parsed.success) {
        return apiError('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Default layouts are required.', 400)
      }
      const result = await saveDefaultLayouts(auth.actor, {
        dashboard: parsed.data.dashboard as DashboardLayout,
        admin: parsed.data.admin as AdminDashboardLayout,
      }, workspaceDeps())
      return result.ok ? apiSuccess({ success: true }) : workspaceError(result.error)
    } catch (err) {
      return serverError(err)
    }
  }, { allowCookie: true })
}
