// app/components/ui/badge.tsx
'use client'

import type { ReactNode } from 'react'
import type { UserRole } from '@/app/types'
import { ROLE_LABELS } from '@/app/constants'
import { cn } from '../cn'

const ROLE_BADGES: Record<UserRole, string> = {
  admin: 'bg-violet-100 dark:bg-violet-950/60 text-violet-700 dark:text-violet-300 ring-violet-200 dark:ring-violet-800',
  pm: 'bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 ring-blue-200 dark:ring-blue-800',
  co: 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 ring-emerald-200 dark:ring-emerald-800',
  manager: 'bg-indigo-100 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 ring-indigo-200 dark:ring-indigo-800',
  team_lead: 'bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 ring-amber-200 dark:ring-amber-800',
  user: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 ring-slate-200 dark:ring-slate-700',
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
    slate: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 ring-slate-200 dark:ring-slate-700',
    green: 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 ring-emerald-200 dark:ring-emerald-800',
    amber: 'bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 ring-amber-200 dark:ring-amber-800',
    red: 'bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 ring-rose-200 dark:ring-rose-800',
    blue: 'bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 ring-blue-200 dark:ring-blue-800',
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
