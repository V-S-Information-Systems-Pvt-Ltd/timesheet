// app/components/ui/table.tsx
'use client'

import type { ReactNode } from 'react'
import { cn } from '../cn'

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <th
      className={cn(
        'px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500',
        className
      )}
    >
      {children}
    </th>
  )
}

export function Td({ children, className }: { children?: ReactNode; className?: string }) {
  return <td className={cn('px-4 py-3 text-sm text-slate-700 dark:text-slate-300', className)}>{children}</td>
}
