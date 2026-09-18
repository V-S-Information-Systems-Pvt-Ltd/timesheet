import 'server-only'

import type {
  AdminDashboardLayout,
  DashboardLayout,
  MobileLayout,
  WorkspaceBranding,
} from '@/app/types'
import { DEFAULT_ADMIN_LAYOUT, DEFAULT_DASHBOARD_LAYOUT } from '@/app/constants'
import { DEFAULT_MOBILE_LAYOUT } from '@/lib/layout'
import { normalizeBranding } from '@/lib/branding'
import { isAdminActor } from '@/lib/roles'
import { isSuperAdmin } from '@/lib/auth/super-admin'
import { query } from '../pool'
import type { Actor, DbResult, DbWrite, DefaultLayouts } from '../repository'
import type { BackfillSettings } from '@/lib/validation'
import type { WorkspacePersistence } from '@/lib/domain/workspace-port'

function friendlyWriteError(err: unknown): string {
  const e = err as { code?: string; constraint?: string } | null
  if (e?.code === '23505') {
    return 'A record with that value already exists.'
  }
  if (e?.code === '23503') {
    return 'This record is referenced by other data and cannot be changed.'
  }
  return 'Something went wrong. Please try again.'
}

async function write(sql: string, params?: unknown[]): Promise<DbWrite> {
  try {
    await query(sql, params)
    return { error: null }
  } catch (err) {
    return { error: friendlyWriteError(err) }
  }
}

export const nativeWorkspacePersistence: WorkspacePersistence = {
  async getBackfillWindow(_actor: Actor): Promise<BackfillSettings> {
    const rows = await query<{
      backfill_window_days: number
      backfill_mode: 'days' | 'month_start'
      backfill_extra_days: number
    }>(
      'select backfill_window_days, backfill_mode, backfill_extra_days from public.app_settings where id = 1 limit 1'
    )
    const row = rows[0]
    return {
      mode: row?.backfill_mode === 'month_start' ? 'month_start' : 'days',
      windowDays:
        typeof row?.backfill_window_days === 'number' && row.backfill_window_days >= 0
          ? row.backfill_window_days
          : 1,
      extraDays:
        typeof row?.backfill_extra_days === 'number' && row.backfill_extra_days >= 0
          ? row.backfill_extra_days
          : 0,
    }
  },

  async setBackfillWindow(actor: Actor, settings: BackfillSettings): Promise<DbWrite> {
    if (!isAdminActor(actor)) return { error: 'You do not have permission to perform this action.' }
    return write(
      'update public.app_settings set backfill_window_days = $1, backfill_mode = $2, backfill_extra_days = $3, updated_at = now() where id = 1',
      [settings.windowDays, settings.mode, settings.extraDays]
    )
  },

  async getDefaultLayouts(_actor: Actor): Promise<DbResult<DefaultLayouts>> {
    try {
      const rows = await query<{
        default_dashboard_layout: DashboardLayout | null
        default_admin_layout: AdminDashboardLayout | null
        default_mobile_layout: MobileLayout | null
      }>(
        'select default_dashboard_layout, default_admin_layout, default_mobile_layout from public.app_settings where id = 1 limit 1'
      )
      const row = rows[0]
      return {
        data: {
          dashboard: row?.default_dashboard_layout ?? DEFAULT_DASHBOARD_LAYOUT,
          admin: row?.default_admin_layout ?? DEFAULT_ADMIN_LAYOUT,
          mobile: row?.default_mobile_layout ?? DEFAULT_MOBILE_LAYOUT,
        },
        error: null,
      }
    } catch (err) {
      return {
        data: null,
        error: err instanceof Error ? err.message : 'Failed to load default layouts.',
      }
    }
  },

  async setDefaultLayouts(actor: Actor, layouts: DefaultLayouts): Promise<DbWrite> {
    if (!isSuperAdmin(actor)) return { error: 'You do not have permission to perform this action.' }
    if (layouts.mobile !== undefined) {
      const mobileJson = layouts.mobile ? JSON.stringify(layouts.mobile) : null
      return write(
        'update public.app_settings set default_dashboard_layout = $1, default_admin_layout = $2, default_mobile_layout = $3, updated_at = now() where id = 1',
        [JSON.stringify(layouts.dashboard), JSON.stringify(layouts.admin), mobileJson]
      )
    }
    return write(
      'update public.app_settings set default_dashboard_layout = $1, default_admin_layout = $2, updated_at = now() where id = 1',
      [JSON.stringify(layouts.dashboard), JSON.stringify(layouts.admin)]
    )
  },

  async getBranding(_actor?: Actor): Promise<DbResult<WorkspaceBranding>> {
    try {
      const rows = await query<{
        app_name: string | null
        primary_color: string | null
        logo_url: string | null
      }>('select app_name, primary_color, logo_url from public.app_settings where id = 1 limit 1')
      const row = rows[0]
      return {
        data: normalizeBranding(row),
        error: null,
      }
    } catch (err) {
      return {
        data: null,
        error: err instanceof Error ? err.message : 'Failed to load branding settings.',
      }
    }
  },

  async setBranding(actor: Actor, branding: WorkspaceBranding): Promise<DbWrite> {
    if (!isSuperAdmin(actor)) return { error: 'You do not have permission to perform this action.' }
    return write(
      'update public.app_settings set app_name = $1, primary_color = $2, logo_url = $3, updated_at = now() where id = 1',
      [branding.appName, branding.primaryColor, branding.logoUrl]
    )
  },

  async setDashboardLayout(actor: Actor, layout: DashboardLayout): Promise<DbWrite> {
    return write('update public.profiles set dashboard_layout = $1 where id = $2', [
      JSON.stringify(layout),
      actor.id,
    ])
  },

  async setAdminLayout(actor: Actor, layout: AdminDashboardLayout): Promise<DbWrite> {
    return write('update public.profiles set admin_layout = $1 where id = $2', [
      JSON.stringify(layout),
      actor.id,
    ])
  },

  async setMobileLayout(actor: Actor, layout: MobileLayout | null): Promise<DbWrite> {
    return write('update public.profiles set mobile_layout = $1 where id = $2', [
      layout ? JSON.stringify(layout) : null,
      actor.id,
    ])
  },

  async getMobileLayout(actor: Actor): Promise<DbResult<MobileLayout | null>> {
    try {
      const rows = await query<{ mobile_layout: MobileLayout | null }>(
        'select mobile_layout from public.profiles where id = $1 limit 1',
        [actor.id]
      )
      return { data: rows[0]?.mobile_layout ?? null, error: null }
    } catch (err) {
      return { data: null, error: err instanceof Error ? err.message : 'Failed to load mobile layout.' }
    }
  },
}
