// app/components/menu-customizer.tsx
// One place to choose what the sidebar shows: a view preset (Essentials,
// Everything) or a custom pick of items across every menu group.
'use client'

import { useState } from 'react'
import { ADMIN_TILE_LABELS, TILE_LABELS } from '@/app/constants'
import type { AdminDashboardLayout, DashboardLayout } from '@/app/types'
import { dataClient } from '@/lib/data/client'
import {
  REPORT_TABS, TEAM_VIEWS, adminTileAllowed, applyMenuView, menuViewOf, navAccess, navKey, reportNavKey,
  type MenuDraft, type MenuView, type NavAccess, type resolveNavTiles,
} from '@/lib/navigation'
import { Dialog } from './dialog'
import { Button, Checkbox, IconButton } from './ui'
import { toast } from './toast'
import { IconArrowDown, IconArrowUp } from './icons'
import { cn } from './cn'

export interface MenuCustomizerConfig {
  open: boolean
  onOpenChange: (open: boolean) => void
  access: NavAccess
  tiles: ReturnType<typeof resolveNavTiles>
  onSaved: (saved: { dashboard: DashboardLayout; admin?: AdminDashboardLayout }) => void
}

const VIEWS: { key: MenuView; title: string; note: string }[] = [
  { key: 'essentials', title: 'Essentials', note: 'Log Time, entries, leave and the reports most people use.' },
  { key: 'everything', title: 'Everything', note: 'Every page you can open.' },
  { key: 'custom', title: 'Custom', note: 'Your own pick of items below.' },
]

export function MenuCustomizer({ config }: { config: MenuCustomizerConfig }) {
  return (
    <Dialog
      open={config.open}
      onClose={() => config.onOpenChange(false)}
      labelledBy="menu-customizer-title"
      className="flex max-h-[calc(100dvh-2rem)] w-full max-w-2xl flex-col rounded-sheet border border-line bg-card"
    >
      {/* Mounted only while open, so the draft starts from the saved menu each time. */}
      {config.open && <MenuCustomizerBody config={config} />}
    </Dialog>
  )
}

function MenuCustomizerBody({ config }: { config: MenuCustomizerConfig }) {
  const { access, tiles } = config
  const canSaveAdmin = access.permission === 'admin'
  const [draft, setDraft] = useState<MenuDraft>(() => ({
    dashboard: { tiles: tiles.userLayout.tiles.map(t => ({ ...t })), hidden: [...tiles.hidden] },
    admin: { tiles: tiles.adminLayout.tiles.map(t => ({ ...t })) },
  }))
  const [busy, setBusy] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const view = menuViewOf(draft, canSaveAdmin)

  const hidden = draft.dashboard.hidden ?? []
  const toggleHidden = (key: string) => setDraft(d => {
    const list = d.dashboard.hidden ?? []
    return { ...d, dashboard: { ...d.dashboard, hidden: list.includes(key) ? list.filter(k => k !== key) : [...list, key] } }
  })
  const toggleTile = (group: 'dashboard' | 'admin', id: string) => setDraft(d => ({
    ...d,
    [group]: { ...d[group], tiles: d[group].tiles.map(t => (t.id === id ? { ...t, enabled: !t.enabled } : t)) },
  }))
  /** Moves `id` past its neighbour among the listed ids (unlisted tiles keep their slots). */
  const move = (group: 'dashboard' | 'admin', id: string, listed: string[], delta: -1 | 1, label: string) => {
    const at = listed.indexOf(id)
    const other = listed[at + delta]
    if (!other) return
    setDraft(d => {
      const next = [...d[group].tiles]
      const a = next.findIndex(t => t.id === id)
      const b = next.findIndex(t => t.id === other)
      ;[next[a], next[b]] = [next[b], next[a]]
      return { ...d, [group]: { ...d[group], tiles: next } }
    })
    setAnnouncement(`${label} moved to position ${at + delta + 1} of ${listed.length}.`)
  }

  const pickView = (next: MenuView) => {
    if (next !== 'custom') setDraft(d => applyMenuView(next, d))
  }

  const reset = () => setDraft({
    dashboard: { tiles: tiles.dashDefault.tiles.map(t => ({ ...t })) },
    admin: { tiles: tiles.adminDefault.tiles.map(t => ({ ...t })) },
  })

  const save = async () => {
    setBusy(true)
    try {
      const dashboard: DashboardLayout = { tiles: draft.dashboard.tiles, ...(hidden.length ? { hidden } : {}) }
      const dashResult = await dataClient.saveDashboardLayout(dashboard)
      if (dashResult.error) return toast(dashResult.error, 'error')
      let admin: AdminDashboardLayout | undefined
      if (canSaveAdmin) {
        const adminResult = await dataClient.saveAdminLayout(draft.admin)
        if (adminResult.error) return toast(adminResult.error, 'error')
        admin = draft.admin
      }
      config.onSaved({ dashboard, admin })
      config.onOpenChange(false)
      toast('Menu saved.', 'success')
    } finally {
      setBusy(false)
    }
  }

  const can = navAccess(access)
  const userIds = draft.dashboard.tiles.map(t => t.id)
  const adminIds = draft.admin.tiles.map(t => t.id).filter(id => id !== 'super-admin' && adminTileAllowed(id, access))
  const reportTabs = REPORT_TABS.filter(t => !('reportRole' in t) || can.canGenerateReports)

  return (
    <>
      <header className="border-b border-line px-5 py-4">
        <h2 id="menu-customizer-title" className="text-base font-semibold text-fg">Customize menu</h2>
        <p className="text-sm text-fg-muted">Pick a view, or choose exactly which items show in the sidebar. Hidden pages stay reachable by link.</p>
      </header>

      <div className="flex-1 space-y-6 overflow-y-auto px-5 py-4">
        <fieldset>
          <legend className="mb-2 text-sm font-semibold text-fg">View</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {VIEWS.map(v => (
              <label
                key={v.key}
                className={cn(
                  'flex cursor-pointer gap-2.5 rounded-control p-3 ring-1 ring-inset transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary-600',
                  view === v.key ? 'bg-primary-600/10 ring-primary-600/40' : 'ring-border hover:bg-muted',
                  v.key === 'custom' && view !== 'custom' && 'cursor-default',
                )}
              >
                <input
                  type="radio"
                  name="menu-view"
                  value={v.key}
                  checked={view === v.key}
                  onChange={() => pickView(v.key)}
                  className="mt-0.5 accent-primary-600"
                />
                <span>
                  <span className="block text-sm font-medium text-fg">{v.title}</span>
                  <span className={cn('block text-xs', view === v.key ? 'text-fg' : 'text-fg-muted')}>{v.note}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid gap-6 sm:grid-cols-2">
          <ItemGroup title="My timesheet">
            {userIds.map((id, i) => (
              <ItemRow
                key={id}
                label={TILE_LABELS[id]}
                checked={draft.dashboard.tiles[i].enabled}
                onToggle={() => toggleTile('dashboard', id)}
                onMove={delta => move('dashboard', id, userIds, delta, TILE_LABELS[id])}
                first={i === 0}
                last={i === userIds.length - 1}
              />
            ))}
          </ItemGroup>

          <div className="space-y-6">
            <ItemGroup title="Team">
              {TEAM_VIEWS.map(v => {
                const key = navKey('team', v.key)
                return <ItemRow key={key} label={v.label} checked={!hidden.includes(key)} onToggle={() => toggleHidden(key)} />
              })}
            </ItemGroup>
            <ItemGroup title="Reports">
              {reportTabs.map(t => {
                const key = reportNavKey(t.key)
                return <ItemRow key={key} label={t.label} checked={!hidden.includes(key)} onToggle={() => toggleHidden(key)} />
              })}
            </ItemGroup>
          </div>

          {canSaveAdmin && adminIds.length > 0 && (
            <ItemGroup title="Administration" className="sm:col-span-2" columns>
              {adminIds.map((id, i) => (
                <ItemRow
                  key={id}
                  label={ADMIN_TILE_LABELS[id]}
                  checked={draft.admin.tiles.find(t => t.id === id)?.enabled ?? false}
                  onToggle={() => toggleTile('admin', id)}
                  onMove={delta => move('admin', id, adminIds, delta, ADMIN_TILE_LABELS[id])}
                  first={i === 0}
                  last={i === adminIds.length - 1}
                />
              ))}
            </ItemGroup>
          )}
        </div>
        <div aria-live="polite" role="status" className="sr-only">{announcement}</div>
      </div>

      <footer className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-3">
        <Button type="button" variant="ghost" size="sm" onClick={reset} className="mr-auto">Reset to default</Button>
        <Button type="button" variant="ghost" onClick={() => config.onOpenChange(false)}>Cancel</Button>
        <Button type="button" onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Save menu'}</Button>
      </footer>
    </>
  )
}

function ItemGroup({ title, children, className, columns }: { title: string; children: React.ReactNode; className?: string; columns?: boolean }) {
  return (
    <fieldset className={className}>
      <legend className="mb-1.5 text-sm font-semibold text-fg">{title}</legend>
      <ul className={cn('space-y-0.5', columns && 'sm:grid sm:grid-cols-2 sm:gap-x-4 sm:space-y-0')}>{children}</ul>
    </fieldset>
  )
}

function ItemRow({ label, checked, onToggle, onMove, first, last }: {
  label: string
  checked: boolean
  onToggle: () => void
  /** Present for groups that can be reordered. */
  onMove?: (delta: -1 | 1) => void
  first?: boolean
  last?: boolean
}) {
  return (
    <li className="flex items-center gap-1 rounded-control px-1.5 py-0.5 hover:bg-muted">
      <div className="min-w-0 flex-1"><Checkbox label={label} checked={checked} onChange={onToggle} /></div>
      {onMove && (
        <>
          <IconButton size="sm" label={`Move ${label} up`} onClick={() => onMove(-1)} disabled={first}>
            <IconArrowUp className="h-4 w-4" />
          </IconButton>
          <IconButton size="sm" label={`Move ${label} down`} onClick={() => onMove(1)} disabled={last}>
            <IconArrowDown className="h-4 w-4" />
          </IconButton>
        </>
      )}
    </li>
  )
}
