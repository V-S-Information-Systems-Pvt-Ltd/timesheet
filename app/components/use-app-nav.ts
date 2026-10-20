// app/components/use-app-nav.ts
// Sidebar groups for pages outside the dashboard (reports, change password).
// The dashboard already holds these inputs and builds its groups directly.
'use client'

import { useEffect, useMemo, useState } from 'react'
import { dataClient } from '@/lib/data/client'
import { buildNavGroups, resolveNavTiles, type NavGroup } from '@/lib/navigation'
import type { AdminDashboardLayout, DashboardLayout, User } from '@/app/types'
import type { MenuCustomizerConfig } from './menu-customizer'

export function useAppNav(profile: User | null): { nav: NavGroup[]; customizer?: MenuCustomizerConfig } {
  const [defaults, setDefaults] = useState<{ dashboard: DashboardLayout; admin: AdminDashboardLayout } | null>(null)
  const [superAdmin, setSuperAdmin] = useState(false)
  const [customizing, setCustomizing] = useState(false)
  // Menu saved on this page, until the profile is next loaded.
  const [saved, setSaved] = useState<{ dashboard: DashboardLayout; admin?: AdminDashboardLayout } | null>(null)
  const active = profile?.is_active === true
  const isAdmin = profile?.permission_role === 'admin'

  useEffect(() => {
    if (!active) return
    let live = true
    void dataClient.getDefaultLayouts().then(({ data }) => { if (live && data) setDefaults(data) })
    if (isAdmin) void dataClient.getCapabilities().then(({ data }) => { if (live && data) setSuperAdmin(data.isSuperAdmin) })
    return () => { live = false }
  }, [active, isAdmin])

  return useMemo(() => {
    if (!profile) return { nav: [] }
    const access = { permission: profile.permission_role, hierarchy: profile.hierarchy_role, isActive: profile.is_active, superAdmin, scoped: !!profile.scope_departments?.length }
    const tiles = resolveNavTiles({
      saved: { dashboard: saved?.dashboard ?? profile.dashboard_layout, admin: saved?.admin ?? profile.admin_layout },
      defaults,
      access,
    })
    return {
      nav: buildNavGroups(access, tiles),
      customizer: { open: customizing, onOpenChange: setCustomizing, access, tiles, onSaved: next => setSaved(prev => ({ ...prev, ...next })) },
    }
  }, [profile, defaults, superAdmin, customizing, saved])
}
