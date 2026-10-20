// app/components/workspace.tsx
// List + editor layout shared by the management panels (Users, Projects,
// Activity Types, Departments): pick an item on the left, edit it on the right,
// nothing is saved until "Save changes".
'use client'

import type { FormEvent, ReactNode } from 'react'
import { Button, Input, initialsOf } from './ui'
import { cn } from './cn'

/** Two columns from lg up; stacked (list, then editor) below. */
export function SplitPane({ list, detail, className }: { list: ReactNode; detail: ReactNode; className?: string }) {
  return (
    <div className={cn('grid lg:grid-cols-[minmax(0,1fr)_minmax(340px,420px)]', className)}>
      <div className="min-w-0 lg:border-r lg:border-border">{list}</div>
      <div className="border-t border-border lg:border-t-0">{detail}</div>
    </div>
  )
}

/** Search box, optional filters and a live count above a pick list. */
export function ListToolbar({ search, onSearch, placeholder, filters, shown, total, noun }: {
  search: string
  onSearch: (value: string) => void
  placeholder: string
  filters?: ReactNode
  shown: number
  total: number
  /** Plural noun for the count, e.g. "projects". */
  noun: string
}) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <Input
          type="search"
          placeholder={placeholder}
          value={search}
          onChange={e => onSearch(e.target.value)}
          className="min-w-48 flex-1"
          aria-label={placeholder}
        />
        {filters}
      </div>
      <p className="px-4 pt-2 text-xs text-fg-muted" aria-live="polite">
        {shown === total ? `${total} ${noun}` : `Showing ${shown} of ${total} ${noun}`}
      </p>
    </>
  )
}

/** Monogram used as a list row's leading mark. */
export function Monogram({ name, email, tone = 'neutral', dot, size = 'md' }: {
  name?: string
  email?: string
  tone?: 'neutral' | 'warning' | 'primary'
  /** Small status dot in the corner: true = on, false = off. */
  dot?: boolean
  size?: 'md' | 'lg'
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'relative grid shrink-0 place-items-center rounded-full font-semibold',
        size === 'lg' ? 'h-11 w-11 text-sm' : 'h-9 w-9 text-xs',
        tone === 'primary' && 'bg-primary-600 text-white',
        tone === 'warning' && 'bg-warning-surface text-warning-text',
        tone === 'neutral' && 'bg-muted text-fg',
      )}
    >
      {initialsOf(name, email)}
      {dot !== undefined && (
        <span className={cn('absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-card', dot ? 'bg-success-text' : 'bg-fg-subtle')} />
      )}
    </span>
  )
}

export function PickList({ label, children }: { label: string; children: ReactNode }) {
  return <ul className="max-h-[38rem] space-y-0.5 overflow-y-auto p-2" aria-label={label}>{children}</ul>
}

/** One selectable row: leading mark, title, secondary line, trailing badge. */
export function PickRow({ selected, onSelect, leading, title, subtitle, trailing, label }: {
  selected: boolean
  onSelect: () => void
  leading?: ReactNode
  title: ReactNode
  subtitle?: ReactNode
  trailing?: ReactNode
  /** Accessible name; defaults to the visible text. */
  label?: string
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        aria-label={label}
        className={cn(
          'flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors',
          selected ? 'bg-primary-600/10 ring-1 ring-inset ring-primary-600/40' : 'hover:bg-muted',
        )}
      >
        {leading}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-fg">{title}</span>
          {subtitle && <span className={cn('block truncate text-xs', selected ? 'text-fg' : 'text-fg-muted')}>{subtitle}</span>}
        </span>
        {trailing}
      </button>
    </li>
  )
}

/** Right-hand editor: header, sections, and a sticky Discard / Save footer. */
export function EditorForm({ label, leading, title, subtitle, status, children, dirty, saving, onSubmit, onDiscard, saveLabel = 'Save changes', extraActions }: {
  label: string
  leading?: ReactNode
  title: ReactNode
  subtitle?: ReactNode
  status?: ReactNode
  children: ReactNode
  dirty: boolean
  saving: boolean
  onSubmit: () => void
  onDiscard: () => void
  saveLabel?: string
  /** Left-aligned footer actions (e.g. Delete). */
  extraActions?: ReactNode
}) {
  return (
    <form className="flex h-full flex-col" onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit() }} aria-label={label}>
      <header className="flex items-start gap-3 border-b border-border px-5 py-4">
        {leading}
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold text-fg">{title}</h3>
          {subtitle && <p className="truncate text-sm text-fg-muted">{subtitle}</p>}
        </div>
        {status}
      </header>
      <div className="flex-1 space-y-6 px-5 py-4">{children}</div>
      <footer className="sticky bottom-0 flex flex-wrap items-center justify-end gap-2 border-t border-border bg-card px-5 py-3">
        {extraActions && <div className="mr-auto flex items-center gap-2">{extraActions}</div>}
        {dirty && !extraActions && <span className="mr-auto text-xs text-fg-muted">Unsaved changes</span>}
        <Button type="button" variant="ghost" disabled={!dirty || saving} onClick={onDiscard}>Discard</Button>
        <Button type="submit" disabled={!dirty || saving}>{saving ? 'Saving…' : saveLabel}</Button>
      </footer>
    </form>
  )
}

/** Titled group of fields inside an editor. */
export function EditorSection({ title, note, children, disabled }: { title: string; note?: ReactNode; children: ReactNode; disabled?: boolean }) {
  return (
    <fieldset className="space-y-3" disabled={disabled}>
      <legend className="mb-1 text-sm font-semibold text-fg">{title}</legend>
      {note && <p className="text-xs text-fg-muted">{note}</p>}
      {children}
    </fieldset>
  )
}

/** Placeholder for the editor column when nothing is selected. */
export function EditorEmpty({ children }: { children: ReactNode }) {
  return <p className="p-6 text-sm text-fg-muted">{children}</p>
}
