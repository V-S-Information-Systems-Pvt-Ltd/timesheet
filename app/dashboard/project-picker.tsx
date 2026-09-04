// app/dashboard/project-picker.tsx
// Searchable project select: type to filter the project list with
// case-insensitive wildcards (* and ? supported) and pick from the dropdown.
// Behavioural ARIA combobox: keyboard navigation (Arrow/Home/End/Enter/Escape),
// aria-expanded/aria-controls/aria-activedescendant, and active-option state.
'use client'

import { useId, useMemo, useRef, useState } from 'react'
import { Project } from '../types'
import { cn } from '@/app/components/cn'
import { inputCls, useFieldId } from '@/app/components/ui'

export default function ProjectPicker({
  projects,
  value,
  onChange,
  required,
  placeholder = 'Search projects…',
  inputId,
}: {
  projects: Project[]
  value: string
  onChange: (id: string) => void
  required?: boolean
  placeholder?: string
  /** Optional stable id attached to the underlying input (for keyboard shortcuts). */
  inputId?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(-1)
  const listBoxId = useId()
  const fieldId = useFieldId()
  const containerRef = useRef<HTMLDivElement>(null)

  const selected = projects.find(p => p.id === value) ?? null

  const matches = useMemo(() => {
    const q = query.trim()
    if (!q) return projects
    let matcher: (name: string) => boolean
    if (/[*?]/.test(q)) {
      // Wildcard search: * = any run of characters, ? = one character.
      const escaped = q
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.')
      const re = new RegExp(escaped, 'i')
      matcher = name => re.test(name)
    } else {
      const lower = q.toLowerCase()
      matcher = name => name.toLowerCase().includes(lower)
    }
    return projects.filter(p => matcher(p.name))
  }, [projects, query])

  const openList = () => {
    setOpen(true)
    setActiveIndex(-1)
  }

  const choose = (id: string) => {
    onChange(id)
    setOpen(false)
    setQuery('')
    setActiveIndex(-1)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      if (open) {
        e.preventDefault()
        setOpen(false)
        setActiveIndex(-1)
      }
      return
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
      if (!open) {
        e.preventDefault()
        openList()
        return
      }
      e.preventDefault()
      const count = matches.length
      if (count === 0) return
      let next = activeIndex
      if (e.key === 'ArrowDown') next = activeIndex + 1 >= count ? 0 : activeIndex + 1
      else if (e.key === 'ArrowUp') next = activeIndex - 1 < 0 ? count - 1 : activeIndex - 1
      else if (e.key === 'Home') next = 0
      else if (e.key === 'End') next = count - 1
      setActiveIndex(next)
      return
    }
    if (e.key === 'Enter') {
      if (open && activeIndex >= 0 && matches[activeIndex]) {
        e.preventDefault()
        choose(matches[activeIndex].id)
      }
      return
    }
    if (e.key === 'Tab') {
      // Let Tab leave naturally; close the list before focus moves away.
      setOpen(false)
      return
    }
  }

  return (
    <div className="relative" ref={containerRef}>
      <input
        type="text"
        id={inputId ?? fieldId}
        value={open ? query : (selected?.name ?? '')}
        placeholder={placeholder}
        required={required}
        role="combobox"
        aria-expanded={open}
        aria-controls={listBoxId}
        aria-autocomplete="list"
        aria-activedescendant={open && activeIndex >= 0 ? `${listBoxId}-opt-${activeIndex}` : undefined}
        aria-haspopup="listbox"
        autoComplete="off"
        onFocus={() => {
          openList()
          setQuery('')
        }}
        onChange={e => {
          openList()
          setQuery(e.target.value)
        }}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        className={inputCls}
      />
      {open && (
        <ul
          id={listBoxId}
          role="listbox"
          aria-label="Projects"
          className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto overscroll-contain rounded-lg border border-slate-200 bg-white py-1 shadow-card"
        >
          {matches.length === 0 ? (
            <li role="option" aria-selected="false" aria-disabled="true" className="px-3 py-2 text-sm text-slate-600">
              No matching projects
            </li>
          ) : (
            matches.map((p, i) => (
              <li
                key={p.id}
                id={`${listBoxId}-opt-${i}`}
                role="option"
                aria-selected={p.id === value}
                onMouseEnter={() => setActiveIndex(i)}
              >
                <button
                  type="button"
                  // Keep focus on the input so the picker stays open until a click.
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => choose(p.id)}
                  className={cn(
                    'block w-full px-3 py-2 text-left text-sm transition-colors hover:bg-slate-50',
                    i === activeIndex && 'bg-primary-50 text-primary-700',
                    p.id === value && 'font-medium'
                  )}
                >
                  {p.name}
                  {p.telegram_no != null && (
                    <span className="ml-2 text-xs text-slate-600">#{p.telegram_no}</span>
                  )}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}
