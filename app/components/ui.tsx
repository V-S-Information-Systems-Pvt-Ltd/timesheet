// app/components/ui.tsx
// Shared UI primitives: design-system building blocks for the app.
// Icons live in ./icons.tsx and toasts in ./toast.tsx.
'use client'

import Link from 'next/link'
import {
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import type { UserRole } from '@/app/types'
import { ROLE_LABELS } from '@/app/constants'
import { cn } from './cn'
import { IconChart, IconClock, IconDashboard, IconKey, IconLogout } from './icons'

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

/* ------------------------------------------------------------------ */
/* Badges                                                              */
/* ------------------------------------------------------------------ */

const ROLE_BADGES: Record<UserRole, string> = {
  admin: 'bg-violet-100 text-violet-700 ring-violet-200',
  pm: 'bg-blue-100 text-blue-700 ring-blue-200',
  co: 'bg-emerald-100 text-emerald-700 ring-emerald-200',
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
}: {
  title?: string
  subtitle?: string
  icon?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
}) {
  return (
    <section className={cn('rounded-xl border border-slate-200 bg-white shadow-card', className)}>
      {(title || actions) && (
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
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cn('p-5', bodyClassName)}>{children}</div>
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
  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/85 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center gap-3 px-4 md:px-8">
          <Link href="/dashboard" className="flex items-center gap-2.5">
            <BrandMark />
            <span className="hidden text-[15px] font-semibold tracking-tight text-slate-900 sm:block">
              VSIS <span className="font-normal text-slate-400">Timesheet</span>
            </span>
          </Link>

          <nav className="ml-2 hidden items-center gap-1 md:flex">
            {NAV_LINKS.map((l) => (
              <Link
                key={l.key}
                href={l.href}
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
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <Link
              href="/change-password"
              title="Change password"
              aria-label="Change password"
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

      <main className={cn('flex-1', centered ? 'flex items-center justify-center px-4 py-10' : 'mx-auto w-full max-w-7xl px-4 py-6 md:px-8 md:py-8')}>
        {children}
      </main>
    </div>
  )
}
