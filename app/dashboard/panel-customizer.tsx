// app/dashboard/panel-customizer.tsx
// Panel (tile) customization: enable/disable and reorder dashboard or admin
// panels. The parent re-mounts this component (via key) each time it is opened
// so the draft always starts from the saved layout.
'use client'

import { useState } from 'react'
import type { LayoutLike } from '@/lib/layout'
import { Button, Card } from '@/app/components/ui'
import { toast } from '@/app/components/toast'
import { IconChevronDown } from '@/app/components/icons'

export default function PanelCustomizer<T extends LayoutLike>({
  layout,
  labels,
  defaultLayout,
  persist,
  onSave,
  onCancel,
}: {
  layout: T
  /** Display name per tile id. */
  labels: Record<string, string>
  defaultLayout: T
  /** Persists the draft to the server; returns an optional error message. */
  persist: (layout: T) => Promise<{ error?: string }>
  onSave: (saved: T) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState<T>(() => ({
    tiles: layout.tiles.map(t => ({ ...t })),
  }) as T)
  const [busy, setBusy] = useState(false)

  const move = (index: number, delta: number) => {
    setDraft(d => {
      const target = index + delta
      if (target < 0 || target >= d.tiles.length) return d
      const tiles = [...d.tiles]
      const [moved] = tiles.splice(index, 1)
      tiles.splice(target, 0, moved)
      return { ...d, tiles }
    })
  }

  const toggle = (id: string) => {
    setDraft(d => ({
      ...d,
      tiles: d.tiles.map(t => (t.id === id ? { ...t, enabled: !t.enabled } : t)),
    }))
  }

  const handleSave = async () => {
    if (busy) return
    setBusy(true)
    try {
      const { error } = await persist(draft)
      if (error) toast(error, 'error')
      else {
        onSave(draft)
        toast('Panel layout saved.', 'success')
      }
    } finally {
      setBusy(false)
    }
  }

  const reset = () => setDraft(defaultLayout)

  return (
    <Card
      title="Customize Panels"
      subtitle="Show, hide, or reorder the panels"
      className="mt-6"
      actions={
        <>
          <Button variant="secondary" size="sm" onClick={reset}>
            Reset
          </Button>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={busy}>
            {busy ? 'Saving…' : 'Save Layout'}
          </Button>
        </>
      }
    >
      <ul className="space-y-1.5">
        {draft.tiles.map((tile, index) => (
          <li
            key={tile.id}
            className={`flex items-center gap-3 rounded-lg border px-3 py-2 transition ${
              tile.enabled
                ? 'border-slate-200 bg-white'
                : 'border-slate-100 bg-slate-50 opacity-60'
            }`}
          >
            <input
              type="checkbox"
              checked={tile.enabled}
              onChange={() => toggle(tile.id)}
              className="h-4 w-4 shrink-0 accent-primary-600"
              aria-label={`Show ${labels[tile.id] ?? tile.id}`}
            />
            <span className="flex-1 text-sm font-medium text-slate-700">{labels[tile.id] ?? tile.id}</span>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => move(index, -1)}
                disabled={index === 0}
                title="Move up"
                className="px-1.5"
              >
                <IconChevronDown className="h-4 w-4 rotate-180" />
                <span className="sr-only">Move up</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => move(index, 1)}
                disabled={index === draft.tiles.length - 1}
                title="Move down"
                className="px-1.5"
              >
                <IconChevronDown className="h-4 w-4" />
                <span className="sr-only">Move down</span>
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  )
}