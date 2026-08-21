// app/components/ui/card.tsx
'use client'

import { useState, type ReactNode } from 'react'
import { cn } from '../cn'
import { IconChevronDown } from '../icons'

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
    <section className={cn('rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-card', className)}>
      {(title || actions || collapsible) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 px-5 py-4">
          <div className="flex items-center gap-2.5">
            {icon && (
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-50 dark:bg-primary-950 text-primary-600 dark:text-primary-400">
                {icon}
              </span>
            )}
            <div>
              <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</h2>
              {subtitle && <p className="text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {actions}
            {collapsible && (
              <button
                type="button"
                onClick={() => setCollapsed(c => !c)}
                className="inline-flex items-center justify-center rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-600 dark:hover:text-slate-300"
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

export function SkeletonCard({ className, lines = 3 }: { className?: string; lines?: number }) {
  return (
    <div className={cn('rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-card', className)}>
      <div className="space-y-3">
        {Array.from({ length: lines }).map((_, i) => (
          <div
            key={i}
            className="h-3.5 w-full animate-pulse rounded bg-slate-100 dark:bg-slate-800"
            style={{ width: i === lines - 1 ? '60%' : undefined }}
          />
        ))}
      </div>
    </div>
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
    primary: 'bg-primary-50 dark:bg-primary-950 text-primary-600 dark:text-primary-400',
    green: 'bg-emerald-50 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400',
    amber: 'bg-amber-50 dark:bg-amber-950 text-amber-600 dark:text-amber-400',
    blue: 'bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400',
  }
  return (
    <div className="flex items-center gap-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-card">
      {icon && (
        <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-lg', accents[accent])}>
          {icon}
        </span>
      )}
      <div className="min-w-0">
        <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</div>
        <div className="truncate text-xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">{value}</div>
        {sub && <div className="text-xs text-slate-500 dark:text-slate-400">{sub}</div>}
      </div>
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
        'flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/60 px-6 py-10 text-center',
        className
      )}
    >
      {icon && <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-white dark:bg-slate-800 text-slate-400 shadow-sm ring-1 ring-slate-200 dark:ring-slate-700">{icon}</div>}
      <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{title}</p>
      {description && <p className="mt-1 max-w-sm text-xs text-slate-400 dark:text-slate-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
