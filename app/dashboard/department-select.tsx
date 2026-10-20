// app/dashboard/department-select.tsx
'use client'

import { dataClient } from '@/lib/data/client'
import { Select } from '@/app/components/ui'
import { useAsyncData } from '../hooks'
import type { Department } from '../types'

/** The editable department list; `reload` refetches after a change. */
export function useDepartments() {
  const { data, error, reload } = useAsyncData<Department[]>(async () => {
    const { data, error } = await dataClient.getDepartments({ deduplicate: false })
    return { data, error: error ? { message: error } : null }
  }, [])
  return { departments: data ?? [], error, reload }
}

/** Department picker over the managed list (a stale current value stays selectable). */
export function DepartmentSelect({ value, onChange, names, id }: {
  value: string
  onChange: (next: string) => void
  /** Restrict the choices (e.g. to a scoped admin's departments). */
  names?: string[]
  id?: string
}) {
  const { departments } = useDepartments()
  const options = names ?? departments.map(d => d.name)
  return (
    <Select id={id} value={value} onChange={e => onChange(e.target.value)}>
      <option value="">No department</option>
      {value && !options.includes(value) && <option value={value}>{value}</option>}
      {options.map(n => <option key={n} value={n}>{n}</option>)}
    </Select>
  )
}
