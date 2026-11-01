// app/components/toast.tsx
// Global toast notifications: `toast()` to push, `<Toaster />` to render.
'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { cn } from './cn'
import { IconCheckCircle, IconInfo, IconX, IconXCircle } from './icons'
import { IconButton } from './ui'

type ToastType = 'success' | 'error' | 'info'
type ToastItem = { id: number; type: ToastType; message: string }

let emitToast: ((t: ToastItem) => void) | null = null

export function toast(message: string, type: ToastType = 'info') {
  emitToast?.({ id: Date.now() + Math.random(), type, message })
}

const TOAST_STYLE: Record<ToastType, { icon: ReactNode; cls: string }> = {
  success: { icon: <IconCheckCircle className="h-5 w-5" />, cls: 'border-success-ring bg-card' },
  error: { icon: <IconXCircle className="h-5 w-5" />, cls: 'border-danger-ring bg-card' },
  info: { icon: <IconInfo className="h-5 w-5" />, cls: 'border-line bg-card' },
}

const TOAST_ICON_CLS: Record<ToastType, string> = {
  success: 'text-success-text',
  error: 'text-danger-text',
  info: 'text-primary-text',
}

// Success and info fade on their own; errors stay until dismissed (WCAG 2.2.1).
const AUTO_DISMISS_MS = 4200

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([])
  const [paused, setPaused] = useState(false)
  const dismiss = useCallback((id: number) => setItems((prev) => prev.filter((x) => x.id !== id)), [])

  useEffect(() => {
    emitToast = (t) => setItems((prev) => [...prev, t])
    return () => {
      emitToast = null
    }
  }, [])

  // Hovering or focusing the stack holds every timer.
  // ponytail: any change restarts all timers, so a new toast extends older ones; track per-toast deadlines if that matters.
  useEffect(() => {
    if (paused) return
    const timers = items
      .filter((t) => t.type !== 'error')
      .map((t) => window.setTimeout(() => dismiss(t.id), AUTO_DISMISS_MS))
    return () => timers.forEach(clearTimeout)
  }, [items, paused, dismiss])

  const render = (t: ToastItem) => (
    <div
      key={t.id}
      className={cn(
        'pointer-events-auto flex items-start gap-2.5 rounded-sheet border py-3 pl-4 pr-2 animate-[fadeIn_0.15s_ease-out]',
        TOAST_STYLE[t.type].cls
      )}
    >
      <span className={cn('mt-0.5 shrink-0', TOAST_ICON_CLS[t.type])} aria-hidden="true">{TOAST_STYLE[t.type].icon}</span>
      <p className="min-w-0 flex-1 pt-0.5 text-sm text-fg">{t.message}</p>
      <IconButton size="sm" label="Dismiss notification" className="-my-1 shrink-0" onClick={() => {
          dismiss(t.id)
          // The stack unmounts under the pointer/focus, so leave/blur never fire.
          if (items.length === 1) setPaused(false)
        }}>
        <IconX className="h-4 w-4" />
      </IconButton>
    </div>
  )

  // Both live regions stay mounted so screen readers register them before content
  // arrives; errors go to the assertive one, everything else to the polite one.
  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[calc(100%-2rem)] max-w-sm flex-col gap-2"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setPaused(false)
      }}
    >
      <div role="alert" className="flex flex-col gap-2 empty:hidden">
        {items.filter((t) => t.type === 'error').map(render)}
      </div>
      <div role="status" className="flex flex-col gap-2 empty:hidden">
        {items.filter((t) => t.type !== 'error').map(render)}
      </div>
    </div>
  )
}
