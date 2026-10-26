// app/components/toast.tsx
// Global toast notifications: `toast()` to push, `<Toaster />` to render.
'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { cn } from './cn'
import { IconCheckCircle, IconInfo, IconXCircle } from './icons'

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

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([])

  useEffect(() => {
    emitToast = (t) => {
      setItems((prev) => [...prev, t])
      window.setTimeout(() => setItems((prev) => prev.filter((x) => x.id !== t.id)), 4200)
    }
    return () => {
      emitToast = null
    }
  }, [])

  if (items.length === 0) return null

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="false"
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[calc(100%-2rem)] max-w-sm flex-col gap-2"
    >
      {items.map((t) => (
        <button
          key={t.id}
          type="button"
          role={t.type === 'error' ? 'alert' : 'status'}
          onClick={() => setItems((prev) => prev.filter((x) => x.id !== t.id))}
          className={cn(
            'pointer-events-auto flex items-start gap-2.5 rounded-sheet border px-4 py-3 text-left animate-[fadeIn_0.15s_ease-out]',
            TOAST_STYLE[t.type].cls
          )}
        >
          <span className={cn('mt-0.5 shrink-0', TOAST_ICON_CLS[t.type])}>{TOAST_STYLE[t.type].icon}</span>
          <span className="text-sm text-fg">{t.message}</span>
        </button>
      ))}
    </div>
  )
}
