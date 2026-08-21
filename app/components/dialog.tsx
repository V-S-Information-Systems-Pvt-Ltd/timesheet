// app/components/dialog.tsx
// Reusable modal dialog primitive: modal backdrop, focus placement, a focus
// trap (Tab / Shift+Tab), Escape-to-close, backdrop-click-to-close, and focus
// restoration to the element that opened the dialog when it closes.
'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import { cn } from './cn'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

export function Dialog({
  open,
  onClose,
  ariaLabel,
  labelledBy,
  describedBy,
  className,
  children,
  initialFocusRef,
}: {
  open: boolean
  onClose: () => void
  /** Accessible name for the dialog (used when labelledBy is not provided). */
  ariaLabel?: string
  /** Optional id of the visible header element naming this dialog. */
  labelledBy?: string
  /** Optional id of an element that describes this dialog. */
  describedBy?: string
  className?: string
  children: ReactNode
  /** Element to focus on open (defaults to the first focusable in the panel). */
  initialFocusRef?: React.RefObject<HTMLElement | null>
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const restoreRef = useRef<HTMLElement | null>(null)

  // Remember and restore focus.
  useEffect(() => {
    if (!open) return
    restoreRef.current = document.activeElement as HTMLElement | null
    const initial =
      initialFocusRef?.current ??
      panelRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
    initial?.focus()
  }, [open, initialFocusRef])

  useEffect(() => {
    if (!open) return
    const restore = restoreRef.current
    return () => {
      if (restore && document.contains(restore)) restore.focus()
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }
      if (e.key !== 'Tab') return
      const panel = panelRef.current
      if (!panel) return
      const active = document.activeElement as HTMLElement | null
      if (active && !panel.contains(active)) {
        // Focus left the dialog somehow — pull it back to the first control.
        e.preventDefault()
        panel.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)?.focus()
        return
      }
      const focusables = Array.from(
        panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      ).filter((el) => el.offsetParent !== null || el === document.activeElement)
      if (focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (e.shiftKey && active === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto overscroll-contain bg-black/30 p-4"
      onClick={(e) => {
        // Only backdrop clicks dismiss. Events from controls inside the panel
        // (including ProjectPicker options) stop propagation and never reach here.
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={labelledBy ? undefined : ariaLabel}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        className={cn('overscroll-contain touch-manipulation', className)}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}
