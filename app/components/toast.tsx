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
  success: { icon: <IconCheckCircle className="h-5 w-5" />, cls: 'border-emerald-200 bg-white' },
  error: { icon: <IconXCircle className="h-5 w-5" />, cls: 'border-rose-200 bg-white' },
  info: { icon: <IconInfo className="h-5 w-5" />, cls: 'border-slate-200 bg-white' },
}

const TOAST_ICON_CLS: Record<ToastType, string> = {
  success: 'text-emerald-500',
  error: 'text-rose-500',
  info: 'text-primary-500',
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
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-full max-w-sm flex-col gap-2">
      {items.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => setItems((prev) => prev.filter((x) => x.id !== t.id))}
          className={cn(
            'pointer-events-auto flex items-start gap-2.5 rounded-xl border px-4 py-3 text-left shadow-card-hover animate-[fadeIn_0.15s_ease-out]',
            TOAST_STYLE[t.type].cls
          )}
        >
          <span className={cn('mt-0.5 shrink-0', TOAST_ICON_CLS[t.type])}>{TOAST_STYLE[t.type].icon}</span>
          <span className="text-sm text-slate-700">{t.message}</span>
        </button>
      ))}
    </div>
  )
}
