// app/components/use-app-nav.ts
// Sidebar groups for pages outside the dashboard (reports, change password).
// The dashboard already holds these inputs and builds its groups directly.
'use client'

import { useEffect, useMemo, useState } from 'react'
import { dataClient } from '@/lib/data/client'
import { buildNavGroups, resolveNavTiles, type NavGroup } from '@/lib/navigation'
import type { AdminDashboardLayout, DashboardLayout, User } from '@/app/types'

export function useAppNav(profile: User | null): NavGroup[] {
  const [defaults, setDefaults] = useState<{ dashboard: DashboardLayout; admin: AdminDashboardLayout } | null>(null)
  const [superAdmin, setSuperAdmin] = useState(false)
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
    if (!profile) return []
    const access = { permission: profile.permission_role, hierarchy: profile.hierarchy_role, isActive: profile.is_active, superAdmin }
    const tiles = resolveNavTiles({ saved: { dashboard: profile.dashboard_layout, admin: profile.admin_layout }, defaults, access })
    return buildNavGroups(access, tiles)
  }, [profile, defaults, superAdmin])
}
