'use client'

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from './cn'
import { menuPosition, nextMenuIndex } from './menu-nav'

export interface MenuItem {
  label: ReactNode
  onSelect: () => void
  destructive?: boolean
  disabled?: boolean
}

function focusMenuItem(menu: HTMLDivElement | null, item: HTMLButtonElement | null | undefined) {
  if (!menu || !item) return
  item.focus({ preventScroll: true })
  // Scroll only the menu, not the table/page, when zoom or a short viewport
  // hides the focused action. The menu is the item's positioned offset parent.
  if (item.offsetTop < menu.scrollTop) menu.scrollTop = item.offsetTop
  else if (item.offsetTop + item.offsetHeight > menu.scrollTop + menu.clientHeight) {
    menu.scrollTop = item.offsetTop + item.offsetHeight - menu.clientHeight
  }
}

/** A portalled row menu that escapes table overflow. Opening focuses an item;
 *  dismissal cleans up focus/listeners and never fires disabled actions. */
export function Menu({
  trigger,
  items,
  label,
  align = 'end',
  className,
}: {
  trigger: ReactNode
  items: MenuItem[]
  label: string
  align?: 'start' | 'end'
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const triggerId = useId()
  const menuId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])
  const initialIndex = useRef(0)

  useEffect(() => {
    if (!open) return
    const menu = menuRef.current
    const trigger = triggerRef.current
    if (!menu || !trigger) return
    const reposition = () => {
      const position = menuPosition(trigger.getBoundingClientRect(), menu.getBoundingClientRect(), window.innerWidth, window.innerHeight, align)
      menu.style.left = `${position.left}px`
      menu.style.top = `${position.top}px`
    }
    reposition()
    focusMenuItem(menu, itemRefs.current[initialIndex.current])

    const onOutside = (event: PointerEvent) => {
      if (!menu.contains(event.target as Node) && !trigger.contains(event.target as Node)) setOpen(false)
    }
    const onFocus = (event: FocusEvent) => {
      if (!menu.contains(event.target as Node) && !trigger.contains(event.target as Node)) setOpen(false)
    }
    const onMove = (event: Event) => {
      if (event.type === 'scroll') {
        // A pending scroll from bringing the trigger into view can arrive just
        // after opening. Follow the anchor instead of immediately dismissing.
        if (event.target instanceof Node && menu.contains(event.target)) return
        reposition()
        return
      }
      setOpen(false)
      if (menu.contains(document.activeElement)) trigger.focus({ preventScroll: true })
    }
    document.addEventListener('pointerdown', onOutside)
    document.addEventListener('focusin', onFocus)
    window.addEventListener('scroll', onMove, true)
    window.addEventListener('resize', onMove)
    return () => {
      document.removeEventListener('pointerdown', onOutside)
      document.removeEventListener('focusin', onFocus)
      window.removeEventListener('scroll', onMove, true)
      window.removeEventListener('resize', onMove)
    }
  }, [open, align])

  const close = () => {
    setOpen(false)
    triggerRef.current?.focus({ preventScroll: true })
  }

  return (
    <div className={cn('inline-block', className)}>
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-fg-muted hover:bg-muted disabled:opacity-50 md:min-h-9 md:min-w-9"
        disabled={items.length === 0}
        onClick={() => {
          initialIndex.current = 0
          setOpen(!open)
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            initialIndex.current = event.key === 'ArrowUp' ? items.length - 1 : 0
            setOpen(true)
          } else if (event.key === 'Escape' && open) {
            event.preventDefault()
            event.stopPropagation()
            close()
          }
        }}
      >
        {trigger}
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-labelledby={triggerId}
          className="fixed z-[60] flex w-44 max-w-[calc(100vw-1rem)] max-h-[calc(100dvh-1rem)] flex-col overflow-y-auto overscroll-contain rounded-lg border border-border bg-card py-1 shadow-card"
          onKeyDown={(event) => {
            const current = itemRefs.current.findIndex(item => item === document.activeElement)
            if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              close()
            } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              focusMenuItem(menuRef.current, itemRefs.current[nextMenuIndex(current, items.length, event.key === 'ArrowDown' ? 1 : -1)])
            } else if (event.key === 'Home' || event.key === 'End') {
              event.preventDefault()
              focusMenuItem(menuRef.current, itemRefs.current[event.key === 'Home' ? 0 : items.length - 1])
            } else if (event.key === 'Tab') {
              // Restore the trigger before native Tab navigation; a portal sits
              // at the end of body, not beside the next row's controls.
              close()
            }
          }}
        >
          {items.map((item, index) => (
            <button
              key={index}
              ref={(element) => { itemRefs.current[index] = element }}
              type="button"
              role="menuitem"
              tabIndex={-1}
              aria-disabled={item.disabled || undefined}
              onClick={() => {
                if (item.disabled) return
                // Return focus before dispatching a dialog-opening action so
                // the dialog captures the row trigger as its restore target.
                close()
                item.onSelect()
              }}
              className={cn('min-h-11 px-3 py-2 text-left text-sm transition-colors md:min-h-9 aria-disabled:cursor-not-allowed aria-disabled:opacity-50',
                item.destructive ? 'text-danger-text hover:bg-danger-surface' : 'text-fg hover:bg-muted')}
            >
              {item.label}
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  )
}
