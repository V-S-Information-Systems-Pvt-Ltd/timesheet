// app/components/ui.tsx
// Shared UI primitives: design-system building blocks for the app.
// Icons live in ./icons.tsx and toasts in ./toast.tsx.
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useId, useMemo, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import type { UserRole } from '@/app/types'
import { ROLE_LABELS } from '@/app/constants'
import { cn } from './cn'
import { isFormField, focusBySelector, SHORTCUTS } from '@/lib/shortcuts'
import { IconChart, IconClock, IconDashboard, IconKey, IconLogout, IconMenu, IconX } from './icons'
import { IconChevronDown } from './icons'

export const inputCls =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 transition-colors focus:border-primary-600 focus:outline-none focus:ring-2 focus:ring-primary-600/25'

/* ------------------------------------------------------------------ */
/* Buttons                                                             */
/* ------------------------------------------------------------------ */

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'success'
export type ButtonSize = 'sm' | 'md'

const BTN_BASE =
  'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 select-none'

const BTN_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-primary-600 text-white shadow-sm hover:bg-primary-700 active:bg-primary-800',
  secondary:
    'border border-slate-300 bg-white text-slate-700 shadow-sm hover:bg-slate-50 hover:text-slate-900 active:bg-slate-100',
  danger: 'bg-rose-600 text-white shadow-sm hover:bg-rose-700 active:bg-rose-800',
  success: 'bg-emerald-600 text-white shadow-sm hover:bg-emerald-700 active:bg-emerald-800',
  ghost: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
}

const BTN_SIZES: Record<ButtonSize, string> = {
  sm: 'px-2.5 py-1.5 text-xs',
  md: 'px-3.5 py-2 text-sm',
}

export function btnClass(
  variant: ButtonVariant = 'primary',
  size: ButtonSize = 'md',
  extra?: string
) {
  return cn(BTN_BASE, BTN_VARIANTS[variant], BTN_SIZES[size], extra)
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
}

export function Button({ variant = 'primary', size = 'md', className, ...props }: ButtonProps) {
  return <button className={btnClass(variant, size, className)} {...props} />
}

/* ------------------------------------------------------------------ */
/* Form controls                                                       */
/* ------------------------------------------------------------------ */

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label?: string
  hint?: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('block', className)}>
      {label && (
        <span className="mb-1.5 block text-xs font-medium text-slate-600">{label}</span>
      )}
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
    </div>
  )
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(inputCls, className)} {...props} />
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(inputCls, 'cursor-pointer', className)} {...props} />
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(inputCls, className)} {...props} />
}

export function Autocomplete({
  options,
  value,
  onChange,
  placeholder,
  onKeyDown,
  required,
  className,
  inputClassName,
}: {
  options: string[]
  value: string
  onChange: (v: string) => void
  placeholder?: string
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void
  required?: boolean
  className?: string
  inputClassName?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(-1)
  const containerRef = useRef<HTMLDivElement>(null)
  const listId = useId()

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter(o => o.toLowerCase().includes(q))
  }, [options, query])

  const select = (opt: string) => {
    onChange(opt)
    setOpen(false)
    setQuery('')
    setActiveIndex(-1)
  }

  return (
    <div className={cn('relative', className)} ref={containerRef}>
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && activeIndex >= 0 ? `${listId}-opt-${activeIndex}` : undefined}
        aria-autocomplete="list"
        required={required}
        value={open ? query : value}
        placeholder={placeholder}
        autoComplete="off"
        onFocus={() => {
          setOpen(true)
          setQuery(value)
        }}
        onChange={(e) => {
          setOpen(true)
          setActiveIndex(-1)
          setQuery(e.target.value)
          onChange(e.target.value)
        }}
        onBlur={() => {
          setOpen(false)
          setActiveIndex(-1)
          const current = query.trim()
          if (current && !options.includes(current)) {
            onChange(current)
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setOpen(false)
            setActiveIndex(-1)
            return
          }
          if (open && matches.length > 0) {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setActiveIndex(i => (i + 1) % matches.length)
              return
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActiveIndex(i => (i <= 0 ? matches.length - 1 : i - 1))
              return
            }
            if (e.key === 'Enter' && activeIndex >= 0 && matches[activeIndex] !== undefined) {
              e.preventDefault()
              select(matches[activeIndex])
              return
            }
          }
          onKeyDown?.(e)
        }}
        className={cn(inputCls, inputClassName)}
      />
      {open && matches.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-card"
          onMouseDown={(e) => e.preventDefault()}
        >
          {matches.map((opt, i) => (
            <li
              key={opt}
              id={`${listId}-opt-${i}`}
              role="option"
              aria-selected={i === activeIndex}
              onMouseEnter={() => setActiveIndex(i)}
            >
              <button
                type="button"
                className={cn(
                  'block w-full px-3 py-2 text-left text-sm transition-colors hover:bg-slate-50',
                  i === activeIndex && 'bg-primary-50 font-medium text-primary-700'
                )}
                onMouseDown={(e) => {
                  e.preventDefault()
                  select(opt)
                }}
              >
                {opt}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Badges                                                              */
/* ------------------------------------------------------------------ */

const ROLE_BADGES: Record<UserRole, string> = {
  admin: 'bg-violet-100 text-violet-700 ring-violet-200',
  pm: 'bg-blue-100 text-blue-700 ring-blue-200',
  co: 'bg-emerald-100 text-emerald-700 ring-emerald-200',
  manager: 'bg-indigo-100 text-indigo-700 ring-indigo-200',
  team_lead: 'bg-amber-100 text-amber-700 ring-amber-200',
  user: 'bg-slate-100 text-slate-600 ring-slate-200',
}

export function RoleBadge({ role, className }: { role: UserRole; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset',
        ROLE_BADGES[role] ?? ROLE_BADGES.user,
        className
      )}
    >
      {ROLE_LABELS[role] ?? role}
    </span>
  )
}

export function Badge({
  tone = 'slate',
  className,
  children,
}: {
  tone?: 'slate' | 'green' | 'amber' | 'red' | 'blue'
  className?: string
  children: ReactNode
}) {
  const tones: Record<string, string> = {
    slate: 'bg-slate-100 text-slate-600 ring-slate-200',
    green: 'bg-emerald-100 text-emerald-700 ring-emerald-200',
    amber: 'bg-amber-100 text-amber-700 ring-amber-200',
    red: 'bg-rose-100 text-rose-700 ring-rose-200',
    blue: 'bg-blue-100 text-blue-700 ring-blue-200',
  }
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset',
        tones[tone],
        className
      )}
    >
      {children}
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* Cards / layout                                                      */
/* ------------------------------------------------------------------ */

export function Card({
  title,
  subtitle,
  icon,
  actions,
  children,
  className,
  bodyClassName,
  collapsible = false,
}: {
  title?: string
  subtitle?: string
  icon?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
  collapsible?: boolean
}) {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <section className={cn('rounded-xl border border-slate-200 bg-white shadow-card', className)}>
      {(title || actions || collapsible) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-2.5">
            {icon && (
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
                {icon}
              </span>
            )}
            <div>
              <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
              {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {actions}
             {collapsible && (
              <button
                type="button"
                onClick={() => setCollapsed(c => !c)}
                className="inline-flex items-center justify-center rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
                aria-label={collapsed ? 'Expand' : 'Collapse'}
                aria-expanded={!collapsed}
              >
                <IconChevronDown className={cn('h-4 w-4 transition-transform', collapsed && 'rotate-180')} />
              </button>
            )}
          </div>
        </header>
      )}
      {!collapsed && <div className={bodyClassName || 'p-5'}>{children}</div>}
    </section>
  )
}

export function StatCard({
  label,
  value,
  sub,
  icon,
  accent = 'primary',
}: {
  label: string
  value: ReactNode
  sub?: string
  icon?: ReactNode
  accent?: 'primary' | 'green' | 'amber' | 'blue'
}) {
  const accents: Record<string, string> = {
    primary: 'bg-primary-50 text-primary-600',
    green: 'bg-emerald-50 text-emerald-600',
    amber: 'bg-amber-50 text-amber-600',
    blue: 'bg-blue-50 text-blue-600',
  }
  return (
    <div className="flex items-center gap-3.5 rounded-xl border border-slate-200 bg-white p-4 shadow-card">
      {icon && (
        <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-lg', accents[accent])}>
          {icon}
        </span>
      )}
      <div className="min-w-0">
        <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</div>
        <div className="truncate text-xl font-semibold tabular-nums text-slate-900">{value}</div>
        {sub && <div className="text-xs text-slate-500">{sub}</div>}
      </div>
    </div>
  )
}

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
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
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
    <div className={cn('inline-flex items-center gap-0.5 rounded-xl bg-slate-100 p-1', className)}>
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
                ? 'bg-white text-primary-700 shadow-sm ring-1 ring-slate-200'
                : 'text-slate-500 hover:text-slate-800'
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

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-6 py-10 text-center',
        className
      )}
    >
      {icon && <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-white text-slate-400 shadow-sm ring-1 ring-slate-200">{icon}</div>}
      <p className="text-sm font-medium text-slate-700">{title}</p>
      {description && <p className="mt-1 max-w-sm text-xs text-slate-400">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Table helpers                                                       */
/* ------------------------------------------------------------------ */

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <th
      className={cn(
        'px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400',
        className
      )}
    >
      {children}
    </th>
  )
}

export function Td({ children, className }: { children?: ReactNode; className?: string }) {
  return <td className={cn('px-4 py-3 text-sm text-slate-700', className)}>{children}</td>
}

/* ------------------------------------------------------------------ */
/* App shell (authenticated pages)                                     */
/* ------------------------------------------------------------------ */

const NAV_LINKS = [
  { href: '/dashboard', key: 'dashboard', label: 'Dashboard', icon: <IconDashboard className="h-4 w-4" /> },
  { href: '/reports', key: 'reports', label: 'Reports', icon: <IconChart className="h-4 w-4" /> },
]

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
              ? 'bg-primary-50 text-primary-700'
              : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'
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
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/85 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center gap-3 px-4 md:px-8">
            <button
            ref={hamburgerRef}
            type="button"
            aria-label="Toggle navigation menu"
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen(!drawerOpen)}
            className="md:hidden inline-flex items-center justify-center rounded-lg p-3 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
          >
            <IconMenu className="h-5 w-5" />
          </button>

          <Link href="/dashboard" className="flex items-center gap-2.5" onClick={() => setDrawerOpen(false)}>
            <BrandMark />
            <span className="hidden text-[15px] font-semibold tracking-tight text-slate-900 sm:block">
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
                  ? 'bg-primary-50 text-primary-700'
                  : 'text-slate-400 hover:bg-slate-100 hover:text-slate-600'
              )}
            >
              <IconKey className="h-4.5 w-4.5" />
            </Link>
            <div className="flex items-center gap-2.5 rounded-lg py-1 pl-1.5 pr-2">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary-400 to-primary-600 text-xs font-semibold text-white">
                {initialsOf(name, email)}
              </span>
              <div className="hidden leading-tight sm:block">
                <div className="max-w-[140px] truncate text-sm font-medium text-slate-800">
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
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm font-medium text-slate-500 transition-colors hover:bg-rose-50 hover:text-rose-600"
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
        <div className="absolute inset-0 bg-black/20" />
        <nav
          ref={drawerNavRef}
          role="dialog"
          aria-label="Navigation menu"
          aria-modal="true"
          className={cn(
            'absolute left-0 top-0 h-full w-64 max-w-[280px] transform bg-white shadow-xl transition-transform duration-200',
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
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setShortcutsOpen(false) }}
        >
          <div className="w-full max-w-md rounded-xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <h3 className="text-sm font-semibold text-slate-800">Keyboard Shortcuts</h3>
              <button
                type="button"
                onClick={() => setShortcutsOpen(false)}
                className="inline-flex items-center justify-center rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
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
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{section}</h4>
                  <div className="space-y-1.5">
                    {items.map((s, i) => (
                      <div key={i} className="flex items-center justify-between text-sm">
                        <span className="text-slate-600">{s.description}</span>
                        <kbd className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-xs font-medium text-slate-500">{s.keys}</kbd>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="border-t border-slate-100 px-5 py-3 text-right">
              <button type="button" onClick={() => setShortcutsOpen(false)} className="text-xs text-slate-500 hover:text-slate-700">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
