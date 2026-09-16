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
import { getMobileSupabaseClient } from '@/lib/supabase/bearer'
import { createClient } from '@/lib/supabase/server'
import type { Json } from '@/lib/supabase/database.types'
import type { Actor, DbResult, DbWrite, DefaultLayouts } from '../repository'
import type { BackfillSettings } from '@/lib/validation'
import type { WorkspacePersistence } from '@/lib/domain/workspace-port'

async function server() {
  const mobileClient = getMobileSupabaseClient()
  if (mobileClient) return mobileClient
  return createClient()
}

function writeError(err: { message?: string; code?: string; details?: string } | null): DbWrite {
  if (!err) return { error: null }
  if (err.code === '23505') {
    return { error: 'A record with that value already exists.' }
  }
  if (err.code === '23503') {
    return { error: 'This record is referenced by other data and cannot be changed.' }
  }
  return { error: err.message || 'Database write failed.' }
}

export const supabaseWorkspacePersistence: WorkspacePersistence = {
  async getBackfillWindow(_actor: Actor): Promise<BackfillSettings> {
    const supabase = await server()
    const { data } = await supabase
      .from('app_settings')
      .select('backfill_window_days, backfill_mode, backfill_extra_days')
      .eq('id', 1)
      .limit(1)
      .maybeSingle()
    return {
      mode: data?.backfill_mode === 'month_start' ? 'month_start' : 'days',
      windowDays:
        data && typeof data.backfill_window_days === 'number' && data.backfill_window_days >= 0
          ? data.backfill_window_days
          : 1,
      extraDays:
        data && typeof data.backfill_extra_days === 'number' && data.backfill_extra_days >= 0
          ? data.backfill_extra_days
          : 0,
    }
  },

  async setBackfillWindow(actor: Actor, settings: BackfillSettings): Promise<DbWrite> {
    if (!isAdminActor(actor)) return { error: 'You do not have permission to perform this action.' }
    const supabase = await server()
    const { error } = await supabase
      .from('app_settings')
      .update({
        backfill_window_days: settings.windowDays,
        backfill_mode: settings.mode,
        backfill_extra_days: settings.extraDays,
        updated_at: new Date().toISOString(),
      })
      .eq('id', 1)
    return writeError(error)
  },

  async getDefaultLayouts(_actor: Actor): Promise<DbResult<DefaultLayouts>> {
    const supabase = await server()
    const { data, error } = await supabase
      .from('app_settings')
      .select('default_dashboard_layout, default_admin_layout, default_mobile_layout')
      .maybeSingle()
    if (error) {
      return { data: null, error: error.message }
    }
    return {
      data: {
        dashboard: (data?.default_dashboard_layout as DashboardLayout | null) ?? DEFAULT_DASHBOARD_LAYOUT,
        admin: (data?.default_admin_layout as AdminDashboardLayout | null) ?? DEFAULT_ADMIN_LAYOUT,
        mobile: (data?.default_mobile_layout as MobileLayout | null) ?? DEFAULT_MOBILE_LAYOUT,
      },
      error: null,
    }
  },

  async setDefaultLayouts(actor: Actor, layouts: DefaultLayouts): Promise<DbWrite> {
    if (!isSuperAdmin(actor)) return { error: 'You do not have permission to perform this action.' }
    const supabase = await server()
    const payload: {
      default_dashboard_layout: Json
      default_admin_layout: Json
      default_mobile_layout?: Json | null
      updated_at: string
    } = {
      default_dashboard_layout: layouts.dashboard as unknown as Json,
      default_admin_layout: layouts.admin as unknown as Json,
      updated_at: new Date().toISOString(),
    }
    if (layouts.mobile !== undefined) {
      payload.default_mobile_layout = (layouts.mobile as unknown as Json) ?? null
    }
    const { error } = await supabase
      .from('app_settings')
      .update(payload)
      .eq('id', 1)
    return writeError(error)
  },

  async getBranding(_actor?: Actor): Promise<DbResult<WorkspaceBranding>> {
    const supabase = await server()
    const { data, error } = await supabase
      .from('app_settings')
      .select('app_name, primary_color, logo_url')
      .eq('id', 1)
      .maybeSingle()

    if (error) return { data: null, error: error.message }
    return { data: normalizeBranding(data), error: null }
  },

  async setBranding(actor: Actor, branding: WorkspaceBranding): Promise<DbWrite> {
    if (!isSuperAdmin(actor)) return { error: 'You do not have permission to perform this action.' }
    const supabase = await server()
    const { error } = await supabase
      .from('app_settings')
      .update({
        app_name: branding.appName,
        primary_color: branding.primaryColor,
        logo_url: branding.logoUrl,
        updated_at: new Date().toISOString(),
      })
      .eq('id', 1)
    return writeError(error)
  },

  async setDashboardLayout(actor: Actor, layout: DashboardLayout): Promise<DbWrite> {
    const supabase = await server()
    const { error } = await supabase
      .from('profiles')
      .update({ dashboard_layout: layout as unknown as Json })
      .eq('id', actor.id)
    return writeError(error)
  },

  async setAdminLayout(actor: Actor, layout: AdminDashboardLayout): Promise<DbWrite> {
    const supabase = await server()
    const { error } = await supabase
      .from('profiles')
      .update({ admin_layout: layout as unknown as Json })
      .eq('id', actor.id)
    return writeError(error)
  },

  async setMobileLayout(actor: Actor, layout: MobileLayout | null): Promise<DbWrite> {
    const supabase = await server()
    const { error } = await supabase
      .from('profiles')
      .update({ mobile_layout: (layout as unknown as Json) ?? null })
      .eq('id', actor.id)
    return writeError(error)
  },

  async getMobileLayout(actor: Actor): Promise<DbResult<MobileLayout | null>> {
    const supabase = await server()
    const { data, error } = await supabase
      .from('profiles')
      .select('mobile_layout')
      .eq('id', actor.id)
      .maybeSingle()
    if (error) return { data: null, error: error.message }
    return { data: (data?.mobile_layout as MobileLayout | null) ?? null, error: null }
  },
}
