// app/components/ui.tsx
// Shared UI primitives: design-system building blocks for the app.
// Icons live in ./icons.tsx and toasts in ./toast.tsx.
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { createContext, useContext, useEffect, useId, useMemo, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type Ref, type SelectHTMLAttributes } from 'react'
import type { UserRole } from '@/app/types'
import { ROLE_LABELS } from '@/app/constants'
import { cn } from './cn'
import { isFormField, focusBySelector, SHORTCUTS } from '@/lib/shortcuts'
import { visibleAppNavKeys, type AppNavKey } from '@/lib/navigation'
import { useBranding } from './branding-provider'
import { useTheme } from './theme-provider'
import { IconChart, IconDashboard, IconKey, IconLogout, IconMenu, IconMonitor, IconMoon, IconSun, IconUpload, IconX } from './icons'
import { IconChevronDown } from './icons'
import { Dialog } from './dialog'
export { Menu, type MenuItem } from './menu'

export const inputCls =
  'w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-fg shadow-sm placeholder:text-fg-subtle transition-colors focus:border-primary-600 focus:outline-none focus:ring-2 focus:ring-primary-600/25'

// cn joins classes without resolving Tailwind conflicts. Omit the default
// width when a caller requests one, rather than relying on CSS emission order.
function controlClass(extra?: string) {
  const defaults = /(?:^|\s)w-/.test(extra ?? '') ? inputCls.replace('w-full ', '') : inputCls
  return cn(defaults, extra)
}

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
    'border border-border bg-card text-fg-muted shadow-sm hover:bg-muted hover:text-fg active:bg-muted',
  danger: 'bg-rose-600 text-white shadow-sm hover:bg-rose-700 active:bg-rose-800',
  success: 'bg-emerald-700 text-white shadow-sm hover:bg-emerald-800 active:bg-emerald-900',
  ghost: 'text-fg-muted hover:bg-muted hover:text-fg',
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

export type IconButtonTone = 'default' | 'primary' | 'danger'

const ICON_BTN_TONES: Record<IconButtonTone, string> = {
  default: 'text-fg-muted hover:bg-muted hover:text-fg',
  primary: 'text-primary-700 dark:text-primary-200 hover:bg-primary-50 dark:hover:bg-primary-900/30',
  danger: 'text-fg-muted hover:bg-rose-50 dark:hover:bg-rose-950/40 hover:text-rose-600 dark:hover:text-rose-300',
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Accessible name — rendered as both aria-label and title. */
  label: string
  size?: ButtonSize
  tone?: IconButtonTone
}

/** Square, icon-only button with a required accessible name. Collapses the
 *  hand-rolled `inline-flex … rounded-lg p-N hover:bg-muted` buttons. */
export function IconButton({ label, size = 'md', tone = 'default', className, type = 'button', ...props }: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex items-center justify-center rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'p-1' : 'p-2',
        ICON_BTN_TONES[tone],
        className
      )}
      {...props}
    />
  )
}

/** Compact theme picker with an explicit way to follow the system preference. */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme()
  const options = [
    { value: 'system' as const, label: 'Use system theme', icon: IconMonitor },
    { value: 'light' as const, label: 'Use light theme', icon: IconSun },
    { value: 'dark' as const, label: 'Use dark theme', icon: IconMoon },
  ]

  return (
    <div
      role="group"
      aria-label="Theme"
      className={cn('inline-flex items-center gap-0.5 rounded-xl bg-muted p-1', className)}
    >
      {options.map(({ value, label, icon: Icon }) => {
        const active = theme === value
        return (
          <IconButton
            key={value}
            label={label}
            size="sm"
            aria-pressed={active}
            onClick={() => setTheme(value)}
            className={cn(
              'rounded-lg',
              active
                ? 'bg-card text-fg shadow-sm ring-1 ring-border'
                : 'text-fg-muted hover:text-fg'
            )}
          >
            <Icon className="h-4.5 w-4.5" />
          </IconButton>
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Form controls                                                       */
/* ------------------------------------------------------------------ */

// Field assigns a stable id (via context) to its first nested control so the
// rendered <label> can be programmatically associated via htmlFor. Controls
// opt in by reading the context with useFieldId(); an explicit `id` prop on
// the control always wins over the Field-provided id.
const FieldIdContext = createContext<string | undefined>(undefined)

/** Reads the id assigned by an ancestor <Field> (undefined when not in one). */
export function useFieldId(): string | undefined {
  return useContext(FieldIdContext)
}

export function Field({
  label,
  hint,
  error,
  id,
  labelAsText = false,
  children,
  className,
}: {
  label?: string
  hint?: string
  /** Inline validation error; announced via role="alert". */
  error?: string
  /** Optional explicit id for the labelled control (defaults to an auto id). */
  id?: string
  /** Render a non-label caption when children contain their own labels or buttons. */
  labelAsText?: boolean
  children: ReactNode
  className?: string
}) {
  const generatedId = useId()
  const fieldId = id ?? generatedId
  return (
    <FieldIdContext.Provider value={fieldId}>
      <div className={cn('block', className)}>
        {label && (labelAsText ? (
          <span className="mb-1.5 block text-xs font-medium text-fg-muted">{label}</span>
        ) : (
          <label htmlFor={fieldId} className="mb-1.5 block text-xs font-medium text-fg-muted">
            {label}
          </label>
        ))}
        {children}
        {error && <p role="alert" className="mt-1 text-xs text-rose-600 dark:text-rose-300">{error}</p>}
        {hint && <span className="mt-1 block text-xs text-fg-muted">{hint}</span>}
      </div>
    </FieldIdContext.Provider>
  )
}

export function Input({ className, id, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  const fieldId = useFieldId()
  return <input id={id ?? fieldId} className={controlClass(className)} {...props} />
}

export function Select({ className, id, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  const fieldId = useFieldId()
  return <select id={id ?? fieldId} className={cn(controlClass(className), 'cursor-pointer')} {...props} />
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
  id,
}: {
  options: string[]
  value: string
  onChange: (v: string) => void
  placeholder?: string
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void
  required?: boolean
  className?: string
  inputClassName?: string
  id?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(-1)
  const containerRef = useRef<HTMLDivElement>(null)
  const listId = useId()
  const fieldId = useFieldId()

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
        id={id ?? fieldId}
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
        className={controlClass(inputClassName)}
      />
      {open && matches.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-border bg-card py-1 shadow-card"
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
                  'block w-full px-3 py-2 text-left text-sm transition-colors hover:bg-muted',
                  i === activeIndex && 'bg-primary-50 dark:bg-primary-900/30 font-medium text-primary-700 dark:text-primary-200'
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

/** Checkbox with the house accent and an optional inline label. Inside a
 *  <Field> it adopts the field id; a provided `label` wraps it in a tap-target
 *  row so the text toggles the box too. Centralizes the hand-rolled
 *  `<input type="checkbox" className="h-4 w-4 accent-primary-600">`. */
export function Checkbox({
  label,
  className,
  id,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label?: ReactNode; ref?: Ref<HTMLInputElement> }) {
  const fieldId = useFieldId()
  const box = (
    <input
      {...props}
      type="checkbox"
      id={id ?? fieldId}
      className={cn('h-4 w-4 shrink-0 accent-primary-600', className)}
    />
  )
  if (label === undefined) return box
  return (
    <label className="flex min-h-9 cursor-pointer items-center gap-2.5 text-sm text-fg-muted">
      {box}
      <span>{label}</span>
    </label>
  )
}

/** Labelled file input: a button-styled label opens the native picker (the
 *  input stays visually hidden but focusable, with a focus-within ring) and the
 *  chosen file name is shown beside it. Replaces the unlabelled raw file inputs
 *  (import/backup) with one accessible control. */
export function FileField({
  label,
  buttonLabel = 'Choose file…',
  accept,
  disabled,
  onFiles,
  className,
  id,
}: {
  label: string
  buttonLabel?: string
  accept?: string
  disabled?: boolean
  onFiles: (files: File[]) => void
  className?: string
  id?: string
}) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const [fileName, setFileName] = useState<string | null>(null)
  return (
    <div className={cn('block', className)}>
      <span className="mb-1.5 block text-xs font-medium text-fg-muted">{label}</span>
      <div className="flex flex-wrap items-center gap-2">
        <label
          htmlFor={inputId}
          className={cn(
            btnClass('secondary', 'md'),
            'focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary-600',
            disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
          )}
        >
          <IconUpload className="h-4 w-4" />
          {buttonLabel}
          <input
            id={inputId}
            type="file"
            accept={accept}
            disabled={disabled}
            aria-label={label}
            className="sr-only"
            onChange={(e) => {
              const files = Array.from(e.currentTarget.files ?? [])
              setFileName(
                files.length > 0
                  ? files.length === 1
                    ? files[0].name
                    : `${files.length} files selected`
                  : null
              )
              // Snapshot files before resetting the native value so callbacks
              // can await reads and users can choose the same file after retry.
              e.currentTarget.value = ''
              onFiles(files)
            }}
          />
        </label>
        {fileName && <span className="min-w-0 truncate text-xs text-fg-muted">{fileName}</span>}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Badges                                                              */
/* ------------------------------------------------------------------ */

const ROLE_BADGES: Record<UserRole, string> = {
  admin: 'bg-violet-100 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300 ring-violet-200 dark:ring-violet-900',
  pm: 'bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 ring-blue-200 dark:ring-blue-900',
  co: 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 ring-emerald-200 dark:ring-emerald-900',
  manager: 'bg-indigo-100 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 ring-indigo-200 dark:ring-indigo-900',
  team_lead: 'bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 ring-amber-200 dark:ring-amber-900',
  user: 'bg-muted text-fg-muted ring-border',
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
    slate: 'bg-muted text-fg-muted ring-border',
    green: 'bg-success-surface text-success-text ring-success-ring',
    amber: 'bg-warning-surface text-warning-text ring-warning-ring',
    red: 'bg-danger-surface text-danger-text ring-danger-ring',
    blue: 'bg-info-surface text-info-text ring-info-ring',
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
/* Feedback: spinner, loading, alerts                                  */
/* ------------------------------------------------------------------ */

/** Indeterminate spinner. Size comes from className (defaults to h-4 w-4). */
export function Spinner({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-block shrink-0 animate-spin rounded-full border-2 border-border border-t-primary-600',
        className
      )}
      aria-hidden="true"
    />
  )
}

/** Centered spinner + label. `fullscreen` fills the viewport for route-level
 *  loading; otherwise it is a padded inline block for panels/cards. */
export function LoadingState({
  label = 'Loading…',
  fullscreen = false,
  className,
}: {
  label?: string
  fullscreen?: boolean
  className?: string
}) {
  const row = (
    <div
      role="status"
      className={cn(
        'flex items-center justify-center gap-2 text-sm text-fg-muted',
        !fullscreen && 'py-10',
        className
      )}
    >
      <Spinner />
      <span>{label}</span>
    </div>
  )
  if (!fullscreen) return row
  return <div className="flex min-h-screen items-center justify-center bg-surface">{row}</div>
}

export type AlertTone = 'error' | 'success' | 'warning' | 'info'

const ALERT_TONES: Record<AlertTone, { cls: string; role: 'alert' | 'status' }> = {
  error: { cls: 'bg-danger-surface text-danger-text ring-danger-ring', role: 'alert' },
  success: { cls: 'bg-success-surface text-success-text ring-success-ring', role: 'status' },
  warning: { cls: 'bg-warning-surface text-warning-text ring-warning-ring', role: 'alert' },
  info: { cls: 'bg-info-surface text-info-text ring-info-ring', role: 'status' },
}

/** Inline status banner. Uses role="alert" for error/warning, role="status"
 *  for success/info. `title` renders a bold lead line above children. */
export function Alert({
  tone = 'error',
  title,
  className,
  children,
}: {
  tone?: AlertTone
  title?: string
  className?: string
  children?: ReactNode
}) {
  const t = ALERT_TONES[tone]
  return (
    <div role={t.role} className={cn('rounded-lg px-3 py-2 text-sm ring-1 ring-inset', t.cls, className)}>
      {title && <p className="font-medium">{title}</p>}
      {children}
    </div>
  )
}

/** Renders a panel's data-dependent region through its load lifecycle:
 *  a skeleton on first load, an error banner with Retry on failure, and the
 *  children once the data is available. Wrap only the region that depends on
 *  the fetched data, so forms stay usable while a list fails to load. */
export function AsyncSection({
  loading,
  error,
  reload,
  skeletonLines = 3,
  children,
}: {
  loading: boolean
  error: string | null
  reload: () => void
  skeletonLines?: number
  children: ReactNode
}) {
  if (error) {
    return (
      <Alert tone="error" className="flex flex-wrap items-center justify-between gap-3">
        <span>Could not load: {error}</span>
        <Button variant="secondary" size="sm" onClick={reload}>
          Retry
        </Button>
      </Alert>
    )
  }
  if (loading) return <SkeletonCard lines={skeletonLines} />
  return <>{children}</>
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
    <section className={cn('card-in rounded-xl border border-border bg-card shadow-card transition-shadow hover:shadow-card-hover', className)}>
      {(title || actions || collapsible) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-4">
          <div className="flex min-w-0 max-w-full items-center gap-2.5">
            {icon && (
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-200">
                {icon}
              </span>
            )}
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-fg">{title}</h2>
              {subtitle && <p className="text-xs text-fg-muted">{subtitle}</p>}
            </div>
          </div>
          <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
            {actions}
             {collapsible && (
              <IconButton
                size="sm"
                onClick={() => setCollapsed(c => !c)}
                label={collapsed ? 'Expand' : 'Collapse'}
                aria-expanded={!collapsed}
              >
                <IconChevronDown className={cn('h-4 w-4 transition-transform', collapsed && 'rotate-180')} />
              </IconButton>
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
    <div className={cn('rounded-xl border border-border bg-card p-5 shadow-card', className)}>
      <div className="space-y-3">
        {Array.from({ length: lines }).map((_, i) => (
          <div
            key={i}
            className="h-3.5 w-full animate-pulse rounded bg-muted"
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
  delta,
  icon,
  accent = 'primary',
}: {
  label: string
  value: ReactNode
  sub?: string
  /** Signed change vs the previous period, e.g. "+3.5 vs last month"; colored
   *  by direction (positive green, negative rose, zero muted). */
  delta?: string
  icon?: ReactNode
  accent?: 'primary' | 'green' | 'amber' | 'blue'
}) {
  const accents: Record<string, string> = {
    primary: 'bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-200',
    green: 'bg-success-surface text-success-text',
    amber: 'bg-warning-surface text-warning-text',
    blue: 'bg-info-surface text-info-text',
  }
  const deltaTone = delta
    ? delta.trim().startsWith('+')
      ? 'text-success-text'
      : delta.trim().startsWith('-')
        ? 'text-danger-text'
        : 'text-fg-muted'
    : null
  return (
    <div className="flex items-center gap-3.5 rounded-xl border border-border bg-card p-4 shadow-card transition-shadow hover:shadow-card-hover">
      {icon && (
        <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-lg', accents[accent])}>
          {icon}
        </span>
      )}
      <div className="min-w-0">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-fg-muted">{label}</div>
        <div className="truncate text-xl font-semibold tabular-nums text-fg">{value}</div>
        {sub && <div className="text-xs text-fg-muted">{sub}</div>}
        {delta && <div className={cn('text-xs font-medium tabular-nums', deltaTone)}>{delta}</div>}
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
        <h1 className="text-2xl font-bold tracking-tight text-fg">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-fg-muted">{subtitle}</p>}
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
    <div
      className={cn(
        'inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-xl bg-muted p-1',
        className
      )}
    >
      {options.map((o) => {
        const active = o.key === value
        return (
          <button
            key={o.key}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.key)}
            className={cn(
              'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
              active
                ? 'bg-card text-primary-700 dark:text-primary-200 shadow-sm ring-1 ring-border'
                : 'text-fg-muted hover:text-fg'
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
        'flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/60 px-6 py-10 text-center',
        className
      )}
    >
      {icon && <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-card text-fg-muted shadow-sm ring-1 ring-border">{icon}</div>}
      <p className="text-sm font-medium text-fg-muted">{title}</p>
      {description && <p className="mt-1 max-w-sm text-xs text-fg-muted">{description}</p>}
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
      scope="col"
      className={cn(
        'px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-fg-muted',
        !/(?:^|\s)text-(?:left|right|center)(?=\s|$)/.test(className ?? '') && 'text-left',
        className
      )}
    >
      {children}
    </th>
  )
}

export function Td({ children, className, label }: { children?: ReactNode; className?: string; /** Column label shown beside the cell in stacked mobile tables (see .table-stack). */ label?: string }) {
  const hasForeground = /(?:^|\s)text-fg(?:-muted|-subtle)?(?:\/\S+)?(?=\s|$)/.test(className ?? '')
  return <td data-label={label} className={cn('px-4 py-3 text-sm', !hasForeground && 'text-fg-muted', className)}>{children}</td>
}

/** Horizontal-scroll container + table scaffold shared by the data tables.
 *  Centralizes only the genuinely-repeated `overflow-x-auto` + `<table>`
 *  wrapper; callers supply their own <thead>/<tbody> (built with Th/Td). */
export function TableFrame({
  children,
  className,
  tableClassName,
}: {
  children: ReactNode
  className?: string
  tableClassName?: string
}) {
  return (
    <div className={cn('table-scroll overflow-x-auto', className)}>
      <table className={cn('w-full border-collapse text-left', tableClassName)}>{children}</table>
    </div>
  )
}

export interface DataColumn<T> {
  key: string
  header: ReactNode
  cell: (row: T) => ReactNode
  align?: 'left' | 'right' | 'center'
  thClassName?: string
  tdClassName?: string
}

/** Declarative read/display table on TableFrame/Th/Td with the single canonical
 *  header style (bg-muted/60 + Th), so simple panels stop hand-rolling two
 *  divergent `<table>` dialects. Complex/stacked tables compose Th/Td directly. */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  empty,
  caption,
  className,
  tableClassName,
}: {
  columns: DataColumn<T>[]
  rows: T[]
  rowKey: (row: T, index: number) => string
  empty?: ReactNode
  caption?: string
  className?: string
  tableClassName?: string
}) {
  if (rows.length === 0 && empty !== undefined) return <>{empty}</>
  const alignCls = (a?: DataColumn<T>['align']) =>
    a === 'right' ? 'text-right' : a === 'center' ? 'text-center' : undefined
  return (
    <TableFrame className={className} tableClassName={tableClassName}>
      {caption && <caption className="sr-only">{caption}</caption>}
      <thead className="border-b border-border bg-muted/60">
        <tr>
          {columns.map((c) => (
            <Th key={c.key} className={cn(alignCls(c.align), c.thClassName)}>
              {c.header}
            </Th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {rows.map((row, i) => (
          <tr key={rowKey(row, i)} className="transition-colors hover:bg-muted/70">
            {columns.map((c) => (
              <Td key={c.key} className={cn(alignCls(c.align), c.tdClassName)}>
                {c.cell(row)}
              </Td>
            ))}
          </tr>
        ))}
      </tbody>
    </TableFrame>
  )
}

/* ------------------------------------------------------------------ */
/* App shell (authenticated pages)                                     */
/* ------------------------------------------------------------------ */

const NAV_LINKS: { href: string; key: AppNavKey; label: string; icon: ReactNode }[] = [
  { href: '/dashboard', key: 'dashboard', label: 'Dashboard', icon: <IconDashboard className="h-4 w-4" /> },
  { href: '/reports', key: 'reports', label: 'Reports', icon: <IconChart className="h-4 w-4" /> },
]

export function BrandMark({
  className,
  logoUrl,
  alt = '',
}: {
  className?: string
  logoUrl?: string | null
  alt?: string
}) {
  const branding = useBranding()
  const effectiveUrl =
    logoUrl !== undefined
      ? (logoUrl ? `/api/branding/logo?preview=${encodeURIComponent(logoUrl)}` : null)
      : (branding.logoUrl ? '/api/branding/logo' : null)
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const src = effectiveUrl && failedUrl !== effectiveUrl ? effectiveUrl : '/brand/vsis-logo-compact.jpg'

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      width={720}
      height={343}
      loading="eager"
      onError={() => setFailedUrl(effectiveUrl || '')}
      className={cn('h-9 w-auto shrink-0 object-contain', className)}
      aria-hidden="true"
    />
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
  isActive = true,
  onLogout,
  centered = false,
  children,
}: {
  name?: string
  email?: string
  department?: string
  role: UserRole
  active: 'dashboard' | 'reports' | 'password' | 'none'
  isActive?: boolean
  onLogout: () => void
  centered?: boolean
  children: ReactNode
}) {
  const displayName = name || email || 'User'
  const branding = useBranding()
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
      {NAV_LINKS.filter((l) => visibleAppNavKeys(isActive).includes(l.key)).map((l) => (
        <Link
          key={l.key}
          href={l.href}
          onClick={() => setDrawerOpen(false)}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
            active === l.key
              ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-200'
              : 'text-fg-muted hover:bg-muted hover:text-fg'
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
      <header className="sticky top-0 z-40 border-b border-border bg-card/85 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center gap-2 px-3 sm:gap-3 sm:px-4 md:px-8">
            <button
            ref={hamburgerRef}
            type="button"
            aria-label="Toggle navigation menu"
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen(!drawerOpen)}
            className="lg:hidden inline-flex shrink-0 items-center justify-center rounded-lg p-3 text-fg-muted transition-colors hover:bg-muted hover:text-fg"
          >
            <IconMenu className="h-5 w-5" />
          </button>

          <Link href="/dashboard" className="flex shrink-0 items-center gap-2.5" onClick={() => setDrawerOpen(false)}>
            <BrandMark className="h-8" />
            <span className="hidden text-[15px] font-semibold tracking-tight text-fg sm:block">
              {branding.appName || 'Timesheet'}
            </span>
          </Link>

          <nav className="ml-2 hidden items-center gap-1 lg:flex">
            {navLinks}
          </nav>

          <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
            <ThemeToggle />
            {isActive && <Link
              href="/change-password"
              title="Change password"
              aria-label="Change password"
              onClick={() => setDrawerOpen(false)}
              className={cn(
                'inline-flex items-center justify-center rounded-lg p-2 transition-colors',
                active === 'password'
                  ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-200'
                  : 'text-fg-muted hover:bg-muted hover:text-fg'
              )}
            >
              <IconKey className="h-4.5 w-4.5" />
            </Link>}
            <div className="hidden items-center gap-2.5 rounded-lg py-1 pl-1.5 pr-2 md:flex">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary-400 to-primary-600 text-xs font-semibold text-white">
                {initialsOf(name, email)}
              </span>
              <div className="hidden leading-tight sm:block">
                <div className="max-w-[140px] truncate text-sm font-medium text-fg">
                  {displayName}
                </div>
                <div className="flex items-center gap-1.5">
                  {department && <span className="max-w-[110px] truncate text-[11px] text-fg-muted">{department}</span>}
                  <RoleBadge role={role} />
                </div>
              </div>
            </div>
            <button
              onClick={onLogout}
              title="Logout"
              aria-label="Logout"
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm font-medium text-fg-muted transition-colors hover:bg-rose-50 dark:hover:bg-rose-950/40 hover:text-rose-600 dark:hover:text-rose-300"
            >
              <IconLogout className="h-4.5 w-4.5" />
              <span className="hidden lg:inline">Logout</span>
            </button>
          </div>
        </div>
      </header>

      <div
        className={cn(
          'fixed inset-0 z-50 lg:hidden overscroll-contain touch-manipulation transition-opacity duration-200',
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
            'absolute left-0 top-0 h-full w-64 max-w-[280px] touch-manipulation transform bg-card shadow-xl transition-transform duration-200 overscroll-contain',
            drawerOpen ? 'translate-x-0' : '-translate-x-full'
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex flex-col gap-1 p-4 pt-14">
            {navLinks}
            {isActive && (
              <Link
                href="/change-password"
                onClick={() => setDrawerOpen(false)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors lg:hidden',
                  active === 'password'
                    ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-200'
                    : 'text-fg-muted hover:bg-muted hover:text-fg'
                )}
              >
                <IconKey className="h-4 w-4" />
                Change password
              </Link>
            )}
            <button
              type="button"
              onClick={() => { setDrawerOpen(false); setShortcutsOpen(true) }}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-left text-sm font-medium text-fg-muted transition-colors hover:bg-muted hover:text-fg"
            >
              <kbd className="rounded border border-border bg-muted px-1.5 text-xs">?</kbd>
              Keyboard shortcuts
            </button>
          </div>
        </nav>
      </div>

      <main
        id="main-content"
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

      <Dialog
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
        labelledBy="shortcuts-title"
        className="w-full max-w-md rounded-xl bg-card shadow-xl"
      >
        <div data-shortcuts-modal>
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <h3 id="shortcuts-title" className="text-sm font-semibold text-fg">Keyboard Shortcuts</h3>
            <IconButton size="sm" label="Close shortcuts" onClick={() => setShortcutsOpen(false)}>
              <IconX className="h-4 w-4" />
            </IconButton>
          </div>
          <div className="max-h-80 overflow-y-auto p-5">
            {Object.entries(
              SHORTCUTS.reduce<Record<string, typeof SHORTCUTS[number][]>>((acc, s) => {
                (acc[s.section] ??= []).push(s)
                return acc
              }, {})
            ).map(([section, items]) => (
              <div key={section} className="mb-4 last:mb-0">
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">{section}</h4>
                <div className="space-y-1.5">
                  {items.map((s, i) => (
                    <div key={i} className="flex items-center justify-between text-sm">
                      <span className="text-fg-muted">{s.description}</span>
                      <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-xs font-medium text-fg-muted">{s.keys}</kbd>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="border-t border-border px-5 py-3 text-right">
            <button type="button" onClick={() => setShortcutsOpen(false)} className="text-xs text-fg-muted hover:text-fg">Close</button>
          </div>
        </div>
      </Dialog>
    </div>
  )
}
