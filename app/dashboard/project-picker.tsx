// app/dashboard/project-picker.tsx
// Searchable project select: type to filter the project list with
// case-insensitive wildcards (* and ? supported) and pick from the dropdown.
'use client'

import { useMemo, useState } from 'react'
import { Project } from '../types'
import { cn } from '@/app/components/cn'
import { inputCls } from '@/app/components/ui'

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

  return (
    <div className="relative">
      <input
        type="text"
        id={inputId}
        value={open ? query : (selected?.name ?? '')}
        placeholder={placeholder}
        required={required}
        autoComplete="off"
        onFocus={() => {
          setOpen(true)
          setQuery('')
        }}
        onChange={e => {
          setOpen(true)
          setQuery(e.target.value)
        }}
        onBlur={() => setOpen(false)}
        className={inputCls}
      />
      {open && (
        <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-card">
          {matches.length === 0 ? (
            <li className="px-3 py-2 text-sm text-slate-400">No matching projects</li>
          ) : (
            matches.map(p => (
              <li key={p.id}>
                <button
                  type="button"
                  // Keep focus on the input so the picker stays open until a click.
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => {
                    onChange(p.id)
                    setOpen(false)
                    setQuery('')
                  }}
                  className={cn(
                    'block w-full px-3 py-2 text-left text-sm transition-colors hover:bg-slate-50',
                    p.id === value && 'bg-primary-50 font-medium text-primary-700'
                  )}
                >
                  {p.name}
                  {p.telegram_no != null && (
                    <span className="ml-2 text-xs text-slate-400">#{p.telegram_no}</span>
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