// app/components/ui/form.tsx
'use client'

import { useId, useMemo, useRef, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { cn } from '../cn'

export const inputCls =
  'w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 shadow-sm placeholder:text-slate-400 dark:placeholder:text-slate-500 transition-colors focus:border-primary-600 focus:outline-none focus:ring-2 focus:ring-primary-600/25'

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
        <span className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-300">{label}</span>
      )}
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-400 dark:text-slate-500">{hint}</span>}
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
          className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 py-1 shadow-card"
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
                  'block w-full px-3 py-2 text-left text-sm transition-colors hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200',
                  i === activeIndex && 'bg-primary-50 dark:bg-primary-950 font-medium text-primary-700 dark:text-primary-400'
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
