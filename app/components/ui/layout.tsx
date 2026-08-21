// app/components/ui/layout.tsx
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { UserRole } from '@/app/types'
import { cn } from '../cn'
import { isFormField, focusBySelector, SHORTCUTS } from '@/lib/shortcuts'
import { IconChart, IconClock, IconDashboard, IconKey, IconLogout, IconMenu, IconX } from '../icons'
import { RoleBadge } from './badge'

export function PageHeader({
  title,
  subtitle,
  actions,
  className,
}: {
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('mb-6 flex flex-wrap items-start justify-between gap-3', className)}>
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function SegmentedTabs<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: { key: T; label: ReactNode; icon?: ReactNode }[]
  value: T
  onChange: (key: T) => void
  className?: string
}) {
  return (
    <div className={cn('inline-flex items-center gap-0.5 rounded-xl bg-slate-100 dark:bg-slate-800 p-1', className)}>
      {options.map((o) => {
        const active = o.key === value
        return (
          <button
            key={o.key}
            type="button"
            onClick={() => onChange(o.key)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
              active
                ? 'bg-white dark:bg-slate-900 text-primary-700 dark:text-primary-400 shadow-sm ring-1 ring-slate-200 dark:ring-slate-700'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
            )}
          >
            {o.icon}
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary-500 to-primary-700 text-white shadow-sm shadow-primary-600/30',
        className
      )}
    >
      <IconClock className="h-5 w-5" />
    </span>
  )
}

export function initialsOf(name?: string, email?: string): string {
  const source = (name || email || '?').trim()
  const parts = source.split(/[\s@._-]+/).filter(Boolean)
  if (parts.length === 0) return '?'
  const first = parts[0][0] ?? ''
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? '' : ''
  return (first + last).toUpperCase()
}

const NAV_LINKS = [
  { href: '/dashboard', key: 'dashboard', label: 'Dashboard', icon: <IconDashboard className="h-4 w-4" /> },
  { href: '/reports', key: 'reports', label: 'Reports', icon: <IconChart className="h-4 w-4" /> },
]

export function AppShell({
  name,
  email,
  department,
  role,
  active,
  onLogout,
  centered = false,
  children,
}: {
  name?: string
  email?: string
  department?: string
  role: UserRole
  active: 'dashboard' | 'reports' | 'password' | 'none'
  onLogout: () => void
  centered?: boolean
  children: ReactNode
}) {
  const displayName = name || email || 'User'
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const pathname = usePathname()
  const hamburgerRef = useRef<HTMLButtonElement>(null)
  const drawerNavRef = useRef<HTMLElement>(null)
  const touchStartRef = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    // Close the drawer on route change. This is a deliberate sync from URL state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDrawerOpen(false)
  }, [pathname])

  useEffect(() => {
    if (!drawerOpen) return
    const nav = drawerNavRef.current
    if (!nav) return
    const focusable = nav.querySelectorAll<HTMLElement>(
      'a[href], button, textarea, input, select, [tabindex]:not([tabindex="-1"])'
    )
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    first?.focus()
    const trap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      if (focusable.length === 0) return
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last?.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first?.focus()
      }
    }
    document.addEventListener('keydown', trap)
    return () => document.removeEventListener('keydown', trap)
  }, [drawerOpen])

  useEffect(() => {
    if (drawerOpen) {
      // Prevent body scroll when drawer is open
      document.body.style.overflow = 'hidden'
      return () => {
        document.body.style.overflow = ''
      }
    }
  }, [drawerOpen])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isFormField(document.activeElement)) return
      if (e.metaKey || e.altKey || e.ctrlKey) return

      const key = e.key?.toLowerCase() ?? ''
      if (key === 'escape' && drawerOpen) {
        setDrawerOpen(false)
        hamburgerRef.current?.focus()
        return
      }
      if (key === 'escape' && shortcutsOpen) {
        setShortcutsOpen(false)
        return
      }

      if (shortcutsOpen) return
      let handled = false
      switch (key) {
        case 'n':
          handled = focusBySelector('[data-shortcut="time-entry-form"]')
          break
        case 'e':
          handled = focusBySelector('[data-shortcut="edit-last"]')
          break
        case 'u':
          handled = focusBySelector('[data-shortcut="undo-last"]')
          break
        case '/':
          handled = focusBySelector('#project-input')
          break
        case '?':
          if (!shortcutsOpen) {
            setShortcutsOpen(true)
            handled = true
          }
          break
      }
      if (handled) e.preventDefault()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [drawerOpen, shortcutsOpen])

  const navLinks = (
    <>
      {NAV_LINKS.map((l) => (
        <Link
          key={l.key}
          href={l.href}
          onClick={() => setDrawerOpen(false)}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
            active === l.key
              ? 'bg-primary-50 dark:bg-primary-950 text-primary-700 dark:text-primary-400'
              : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-800 dark:hover:text-slate-200'
          )}
        >
          {l.icon}
          {l.label}
        </Link>
      ))}
    </>
  )

  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <header className="sticky top-0 z-40 border-b border-slate-200 dark:border-slate-800 bg-white/85 dark:bg-slate-900/85 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center gap-3 px-4 md:px-8">
          <button
            ref={hamburgerRef}
            type="button"
            aria-label="Toggle navigation menu"
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen(!drawerOpen)}
            className="md:hidden inline-flex items-center justify-center rounded-lg p-3 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-800 dark:hover:text-slate-200 transition-colors"
          >
            <IconMenu className="h-5 w-5" />
          </button>

          <Link href="/dashboard" className="flex items-center gap-2.5" onClick={() => setDrawerOpen(false)}>
            <BrandMark />
            <span className="hidden text-[15px] font-semibold tracking-tight text-slate-900 dark:text-slate-100 sm:block">
              VSIS <span className="font-normal text-slate-400">Timesheet</span>
            </span>
          </Link>

          <nav className="ml-2 hidden items-center gap-1 md:flex">
            {navLinks}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <Link
              href="/change-password"
              title="Change password"
              aria-label="Change password"
              onClick={() => setDrawerOpen(false)}
              className={cn(
                'inline-flex items-center justify-center rounded-lg p-2 transition-colors',
                active === 'password'
                  ? 'bg-primary-50 dark:bg-primary-950 text-primary-700 dark:text-primary-400'
                  : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-600 dark:hover:text-slate-300'
              )}
            >
              <IconKey className="h-4.5 w-4.5" />
            </Link>
            <div className="flex items-center gap-2.5 rounded-lg py-1 pl-1.5 pr-2">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary-400 to-primary-600 text-xs font-semibold text-white">
                {initialsOf(name, email)}
              </span>
              <div className="hidden leading-tight sm:block">
                <div className="max-w-[140px] truncate text-sm font-medium text-slate-800 dark:text-slate-200">
                  {displayName}
                </div>
                <div className="flex items-center gap-1.5">
                  {department && <span className="max-w-[110px] truncate text-[11px] text-slate-400">{department}</span>}
                  <RoleBadge role={role} />
                </div>
              </div>
            </div>
            <button
              onClick={onLogout}
              title="Logout"
              aria-label="Logout"
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm font-medium text-slate-500 transition-colors hover:bg-rose-50 dark:hover:bg-rose-950/40 hover:text-rose-600 dark:hover:text-rose-400"
            >
              <IconLogout className="h-4.5 w-4.5" />
              <span className="hidden lg:inline">Logout</span>
            </button>
          </div>
        </div>
      </header>

      <div
        className={cn(
          'fixed inset-0 z-50 md:hidden transition-all duration-200',
          drawerOpen
            ? 'pointer-events-auto opacity-100'
            : 'pointer-events-none opacity-0 invisible'
        )}
        aria-hidden={!drawerOpen}
        onClick={() => setDrawerOpen(false)}
        onTouchStart={(e) => { touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY } }}
        onTouchEnd={(e) => {
          const start = touchStartRef.current
          if (!start) return
          const dx = e.changedTouches[0].clientX - start.x
          const dy = e.changedTouches[0].clientY - start.y
          if (dx > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
            setDrawerOpen(false)
          }
          touchStartRef.current = null
        }}
      >
        <div className="absolute inset-0 bg-black/40" />
        <nav
          ref={drawerNavRef}
          role="dialog"
          aria-label="Navigation menu"
          aria-modal="true"
          className={cn(
            'absolute left-0 top-0 h-full w-64 max-w-[280px] transform bg-white dark:bg-slate-900 shadow-xl transition-transform duration-200',
            drawerOpen ? 'translate-x-0' : '-translate-x-full'
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex flex-col gap-1 p-4 pt-14">
            {navLinks}
          </div>
        </nav>
      </div>

      <main
        className={cn(
          'flex-1',
          centered
            ? 'flex items-center justify-center px-4 py-10'
            : 'mx-auto w-full max-w-7xl px-4 py-6 md:px-8 md:py-8'
        )}
        aria-hidden={drawerOpen}
        inert={drawerOpen}
      >
        {children}
      </main>

      {shortcutsOpen && (
        <div
          data-shortcuts-modal
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setShortcutsOpen(false) }}
        >
          <div className="w-full max-w-md rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 px-5 py-4">
              <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Keyboard Shortcuts</h3>
              <button
                type="button"
                onClick={() => setShortcutsOpen(false)}
                className="inline-flex items-center justify-center rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
              >
                <IconX className="h-4 w-4" />
              </button>
            </div>
            <div className="max-h-80 overflow-y-auto p-5">
              {Object.entries(
                SHORTCUTS.reduce<Record<string, typeof SHORTCUTS[number][]>>((acc, s) => {
                  (acc[s.section] ??= []).push(s)
                  return acc
                }, {})
              ).map(([section, items]) => (
                <div key={section} className="mb-4 last:mb-0">
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{section}</h4>
                  <div className="space-y-1.5">
                    {items.map((s, i) => (
                      <div key={i} className="flex items-center justify-between text-sm">
                        <span className="text-slate-600 dark:text-slate-300">{s.description}</span>
                        <kbd className="rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-1.5 py-0.5 text-xs font-medium text-slate-500 dark:text-slate-400">{s.keys}</kbd>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="border-t border-slate-100 dark:border-slate-800 px-5 py-3 text-right">
              <button type="button" onClick={() => setShortcutsOpen(false)} className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
