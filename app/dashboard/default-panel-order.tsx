// app/dashboard/default-panel-order.tsx
// Super-admin editing of the GLOBAL default panel order (what new users / users
// with no saved layout fall back to). Uses PanelCustomizer for both the user
// dashboard tiles and the admin-panel tiles.
'use client'

import { useState } from 'react'
import { setDefaultLayouts } from '../actions'
import {
  ADMIN_TILE_LABELS,
  DEFAULT_ADMIN_LAYOUT,
  DEFAULT_DASHBOARD_LAYOUT,
  TILE_LABELS,
} from '../constants'
import { AdminDashboardLayout, DashboardLayout } from '../types'
import PanelCustomizer from './panel-customizer'
import { Button } from '@/app/components/ui'

export default function DefaultPanelOrder({
  defaultLayouts,
  onSaved,
}: {
  defaultLayouts: { dashboard: DashboardLayout; admin: AdminDashboardLayout } | null
  onSaved: (l: { dashboard: DashboardLayout; admin: AdminDashboardLayout }) => void
}) {
  const [editing, setEditing] = useState<'dashboard' | 'admin' | null>(null)

  const current = defaultLayouts ?? {
    dashboard: DEFAULT_DASHBOARD_LAYOUT,
    admin: DEFAULT_ADMIN_LAYOUT,
  }

  const compose = (kind: 'dashboard' | 'admin', layout: DashboardLayout | AdminDashboardLayout) =>
    kind === 'dashboard'
      ? { dashboard: layout as DashboardLayout, admin: current.admin }
      : { dashboard: current.dashboard, admin: layout as AdminDashboardLayout }

  const persist = async (kind: 'dashboard' | 'admin', layout: DashboardLayout | AdminDashboardLayout) => {
    const next = compose(kind, layout)
    const { error } = await setDefaultLayouts(next.dashboard, next.admin)
    if (error) return { error }
    return {}
  }

  const handleSave = (kind: 'dashboard' | 'admin', saved: DashboardLayout | AdminDashboardLayout) => {
    onSaved(compose(kind, saved))
    setEditing(null)
  }

  if (editing === 'dashboard') {
    return (
      <PanelCustomizer
        layout={current.dashboard}
        labels={TILE_LABELS}
        defaultLayout={DEFAULT_DASHBOARD_LAYOUT}
        persist={(l) => persist('dashboard', l)}
        onSave={(s) => handleSave('dashboard', s)}
        onCancel={() => setEditing(null)}
      />
    )
  }

  if (editing === 'admin') {
    return (
      <PanelCustomizer
        layout={current.admin}
        labels={ADMIN_TILE_LABELS}
        defaultLayout={DEFAULT_ADMIN_LAYOUT}
        persist={(l) => persist('admin', l)}
        onSave={(s) => handleSave('admin', s)}
        onCancel={() => setEditing(null)}
      />
    )
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" size="sm" onClick={() => setEditing('dashboard')}>
        Edit dashboard defaults
      </Button>
      <Button variant="secondary" size="sm" onClick={() => setEditing('admin')}>
        Edit admin-panel defaults
      </Button>
    </div>
  )
}
