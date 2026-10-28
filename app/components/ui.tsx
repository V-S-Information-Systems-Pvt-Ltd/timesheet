// app/components/ui.tsx
// Shared UI primitives: design-system building blocks for the app.
// Icons live in ./icons.tsx and toasts in ./toast.tsx.
'use client'

import { createContext, useContext, useId, useMemo, useRef, useState, type AriaAttributes, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type Ref, type SelectHTMLAttributes } from 'react'
import type { UserRole } from '@/app/types'
import { ROLE_LABELS } from '@/app/constants'
import { cn } from './cn'
import { useBranding } from './branding-provider'
import { useTheme } from './theme-provider'
import { IconMonitor, IconMoon, IconSun, IconUpload } from './icons'
import { IconChevronDown } from './icons'
export { Menu, type MenuItem } from './menu'

// 16px text on phones stops iOS Safari zooming into a focused control.
export const inputCls =
  'min-h-11 w-full rounded-control border border-border bg-card px-3 py-2.5 text-base text-fg placeholder:text-fg-subtle transition-colors hover:border-fg-muted focus:border-primary-text focus:outline-none focus:ring-2 focus:ring-primary-text/25 aria-invalid:border-danger-text md:min-h-0 md:text-sm'

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
  'inline-flex items-center justify-center gap-1.5 rounded-control font-semibold transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 select-none'

const BTN_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-primary-600 text-white hover:bg-primary-700 active:bg-primary-800',
  secondary:
    'border border-border bg-card text-fg hover:bg-muted active:bg-muted',
  danger: 'bg-brand-red-600 text-white hover:bg-brand-red-700 active:bg-brand-red-700',
  success: 'bg-logged-700 text-white hover:bg-logged-800 active:bg-logged-800',
  ghost: 'text-fg-muted hover:bg-muted hover:text-fg',
}

const BTN_SIZES: Record<ButtonSize, string> = {
  sm: 'min-h-11 px-3 py-1.5 text-xs md:min-h-0 md:px-2.5',
  md: 'min-h-11 px-3.5 py-2 text-sm md:min-h-0',
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
  primary: 'text-primary-text hover:bg-primary-50 dark:hover:bg-primary-900/30',
  danger: 'text-fg-muted hover:bg-danger-surface hover:text-danger-text',
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Accessible name — rendered as both aria-label and title. */
  label: string
  size?: ButtonSize
  tone?: IconButtonTone
}

/** Square, icon-only button with a required accessible name. Collapses the
 *  hand-rolled `inline-flex … rounded-control p-N hover:bg-muted` buttons. */
export function IconButton({ label, size = 'md', tone = 'default', className, type = 'button', ...props }: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex items-center justify-center rounded-control transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        'min-h-11 min-w-11 md:min-h-0 md:min-w-0',
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
      className={cn('inline-flex items-center gap-0.5 rounded-full bg-muted p-1', className)}
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
              'rounded-full',
              active
                ? 'bg-ink text-surface hover:text-surface'
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

const FieldDescriptionContext = createContext<{ 'aria-describedby'?: string; 'aria-invalid'?: true }>({})

/** aria-describedby / aria-invalid linking a control to its Field's error and
 *  hint, merged with any the control sets itself (an explicit undefined must
 *  not drop the Field's error link). */
export function useFieldDescription(own?: { 'aria-describedby'?: string; 'aria-invalid'?: AriaAttributes['aria-invalid'] }) {
  const field = useContext(FieldDescriptionContext)
  return {
    'aria-describedby': [field['aria-describedby'], own?.['aria-describedby']].filter(Boolean).join(' ') || undefined,
    'aria-invalid': own?.['aria-invalid'] ?? field['aria-invalid'],
  }
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
  const errorId = `${fieldId}-error`
  const hintId = `${fieldId}-hint`
  const describedBy = [error && errorId, hint && hintId].filter(Boolean).join(' ') || undefined
  const description = useMemo(
    () => ({ 'aria-describedby': describedBy, 'aria-invalid': error ? (true as const) : undefined }),
    [describedBy, error]
  )
  return (
    <FieldIdContext.Provider value={fieldId}>
      <FieldDescriptionContext.Provider value={description}>
        {/* field-label gets a required asterisk from globals.css when the field holds a :required control. */}
        <div className={cn('field block', className)}>
          {label && (labelAsText ? (
            <span className="field-label mb-1.5 block text-xs font-semibold text-fg-muted">{label}</span>
          ) : (
            <label htmlFor={fieldId} className="field-label mb-1.5 block text-xs font-semibold text-fg-muted">
              {label}
            </label>
          ))}
          {children}
          {error && <p id={errorId} role="alert" className="mt-1 text-xs text-danger-text">{error}</p>}
          {hint && <span id={hintId} className="mt-1 block text-xs text-fg-muted">{hint}</span>}
        </div>
      </FieldDescriptionContext.Provider>
    </FieldIdContext.Provider>
  )
}

export function Input({ className, id, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  const fieldId = useFieldId()
  return <input id={id ?? fieldId} className={controlClass(className)} {...props} {...useFieldDescription(props)} />
}

export function Select({ className, id, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  const fieldId = useFieldId()
  return <select id={id ?? fieldId} className={cn(controlClass(className), 'cursor-pointer')} {...props} {...useFieldDescription(props)} />
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
  const description = useFieldDescription()

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
        {...description}
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
          className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-control border border-border bg-card py-1"
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
                  'block min-h-11 w-full px-3 py-2 text-left md:min-h-0 text-sm transition-colors hover:bg-muted',
                  i === activeIndex && 'bg-primary-50 dark:bg-primary-900/30 font-medium text-primary-text'
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
  // A bare box keeps its 16px look; the wrapping label pads the hit area to 44px on phones.
  if (label === undefined) return <label className="-m-3.5 inline-flex cursor-pointer p-3.5 md:m-0 md:p-0">{box}</label>
  return (
    <label className="flex min-h-11 cursor-pointer md:min-h-9 items-center gap-2.5 text-sm text-fg-muted">
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
  admin: 'bg-leave-surface text-leave-text ring-leave-ring',
  pm: 'bg-info-surface text-info-text ring-info-ring',
  co: 'bg-success-surface text-success-text ring-success-ring',
  manager: 'bg-primary-50 text-primary-text ring-primary-100 dark:bg-primary-900/30 dark:ring-primary-900',
  team_lead: 'bg-warning-surface text-warning-text ring-warning-ring',
  user: 'bg-muted text-fg-muted ring-line',
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
    slate: 'bg-muted text-fg-muted ring-line',
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
    <div role={t.role} className={cn('rounded-control px-3 py-2 text-sm ring-1 ring-inset', t.cls, className)}>
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
    <section className={cn('card-in rounded-sheet border border-line bg-card', className)}>
      {(title || actions || collapsible) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-4">
          <div className="flex min-w-0 max-w-full items-center gap-2.5">
            {icon && (
              <span className="flex h-8 w-8 items-center justify-center rounded-control bg-muted text-fg-muted">
                {icon}
              </span>
            )}
            <div className="min-w-0">
              <h2 className="font-display text-sm font-semibold text-fg">{title}</h2>
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
    <div className={cn('rounded-sheet border border-line bg-card p-5', className)}>
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
    primary: 'bg-primary-50 dark:bg-primary-900/30 text-primary-text',
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
    <div className="flex items-center gap-3.5 rounded-sheet border border-line bg-card p-5">
      {icon && (
        <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-control', accents[accent])}>
          {icon}
        </span>
      )}
      <div className="min-w-0">
        <div className="text-xs font-semibold text-fg-muted">{label}</div>
        <div className="truncate font-numeral text-3xl font-medium tabular-nums leading-tight text-fg">{value}</div>
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
        <h1 className="font-display text-2xl font-semibold text-fg">{title}</h1>
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
    <div className={cn('flex max-w-full items-center gap-2 overflow-x-auto py-0.5', className)}>
      {options.map((o) => {
        const active = o.key === value
        return (
          <button
            key={o.key}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.key)}
            className={cn(
              'inline-flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-4 py-1.5 text-sm font-semibold transition-colors md:min-h-9',
              active
                ? 'border-ink bg-ink text-surface'
                : 'border-border bg-card text-fg hover:bg-muted'
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
        'flex flex-col items-center justify-center rounded-sheet border border-dashed border-line bg-muted/60 px-6 py-10 text-center',
        className
      )}
    >
      {icon && <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-card text-fg-muted ring-1 ring-line">{icon}</div>}
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
        'bg-muted px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-fg-muted',
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
  return <td data-label={label} className={cn('border-b border-line px-4 py-2.5 text-sm', !hasForeground && 'text-fg', className)}>{children}</td>
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
    <div className={cn('table-scroll overflow-x-auto rounded-control', className)}>
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
      <thead className="border-b border-line bg-muted/60">
        <tr>
          {columns.map((c) => (
            <Th key={c.key} className={cn(alignCls(c.align), c.thClassName)}>
              {c.header}
            </Th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
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

  // The bundled logo is a white-backed JPEG: in dark mode give it a deliberate rounded plate rather than a hard white box.
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      width={720}
      height={343}
      loading="eager"
      onError={() => setFailedUrl(effectiveUrl || '')}
      className={cn('h-9 w-auto shrink-0 object-contain dark:rounded-md dark:bg-white dark:px-1.5 dark:py-1', className)}
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

export { AppShell } from './app-shell'
