// app/dashboard/panel-customizer.tsx
// Panel (tile) customization: enable/disable and reorder dashboard or admin
// panels. The parent re-mounts this component (via key) each time it is opened
// so the draft always starts from the saved layout.
'use client'

import { useState } from 'react'
import type { LayoutLike } from '@/lib/layout'
import { Button, Card, Checkbox, IconButton } from '@/app/components/ui'
import { toast } from '@/app/components/toast'
import { IconArrowDown, IconArrowUp } from '@/app/components/icons'

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
  // Announced to assistive tech after a keyboard/mouse reorder (WCAG 4.1.3).
  const [announcement, setAnnouncement] = useState('')
  const labelOf = (id: string) => labels[id] ?? id

  const move = (index: number, delta: number) => {
    const target = index + delta
    if (target < 0 || target >= draft.tiles.length) return
    setDraft(d => {
      const tiles = [...d.tiles]
      const [moved] = tiles.splice(index, 1)
      tiles.splice(target, 0, moved)
      return { ...d, tiles }
    })
    setAnnouncement(`${labelOf(draft.tiles[index].id)} moved to position ${target + 1} of ${draft.tiles.length}.`)
  }

  const toggle = (id: string) => {
    const enabling = !draft.tiles.find(t => t.id === id)?.enabled
    setDraft(d => ({
      ...d,
      tiles: d.tiles.map(t => (t.id === id ? { ...t, enabled: !t.enabled } : t)),
    }))
    setAnnouncement(`${labelOf(id)} ${enabling ? 'shown' : 'hidden'}.`)
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
      subtitle="Show, hide, or reorder the panels. Focus a row and press ↑/↓ to move it."
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
            tabIndex={0}
            aria-keyshortcuts="ArrowUp ArrowDown"
            aria-label={`${labelOf(tile.id)}, position ${index + 1} of ${draft.tiles.length}, ${tile.enabled ? 'shown' : 'hidden'}`}
            onKeyDown={(e) => {
              if (e.key === 'ArrowUp' && index > 0) {
                e.preventDefault()
                move(index, -1)
              }
              if (e.key === 'ArrowDown' && index < draft.tiles.length - 1) {
                e.preventDefault()
                move(index, 1)
              }
            }}
            className={`flex items-center gap-3 rounded-lg border px-3 py-2 transition ${
              tile.enabled
                ? 'border-border bg-card'
                : 'border-border bg-muted opacity-60'
            }`}
          >
            <Checkbox
              checked={tile.enabled}
              onChange={() => toggle(tile.id)}
              className="shrink-0"
              aria-label={`Show ${labelOf(tile.id)}`}
            />
            <span className="flex-1 text-sm font-medium text-fg-muted">{labelOf(tile.id)}</span>
            <div className="flex shrink-0 items-center gap-1">
              <IconButton
                size="sm"
                label={`Move ${labelOf(tile.id)} up`}
                onClick={() => move(index, -1)}
                disabled={index === 0}
                className="min-h-11 min-w-11 md:min-h-9 md:min-w-9"
              >
                <IconArrowUp className="h-4 w-4" />
              </IconButton>
              <IconButton
                size="sm"
                label={`Move ${labelOf(tile.id)} down`}
                onClick={() => move(index, 1)}
                disabled={index === draft.tiles.length - 1}
                className="min-h-11 min-w-11 md:min-h-9 md:min-w-9"
              >
                <IconArrowDown className="h-4 w-4" />
              </IconButton>
            </div>
          </li>
        ))}
      </ul>
      <div aria-live="polite" role="status" className="sr-only">{announcement}</div>
    </Card>
  )
}
