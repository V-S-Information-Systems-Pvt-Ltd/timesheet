// app/dashboard/activity-types-panel.tsx
'use client'

import { useState } from 'react'
import { addActivityType, renameActivityType, setActivityTypeActive } from '../actions'
import { ActivityType } from '../types'
import { useAsyncData } from '../hooks'
import { dataClient } from '@/lib/data/client'
import { Badge, Button, Card, EmptyState, Field, Input, Td, Th } from '@/app/components/ui'
import { toast } from '@/app/components/toast'
import { IconPencil, IconTag } from '@/app/components/icons'

export default function ActivityTypesPanel() {
  const [name, setName] = useState('')

  const { data: types, reload } = useAsyncData<ActivityType[]>(
    async () => {
      const { data, error } = await dataClient.getAllActivityTypes()
      return { data, error: error ? { message: error } : null }
    },
    []
  )
  const rows = types ?? []

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    const { error } = await addActivityType(name)
    if (error) toast(error, 'error')
    else {
      setName('')
      reload()
      toast('Activity type added.', 'success')
    }
  }

  const handleRename = async (id: string, current: string) => {
    const next = prompt('New name', current)
    if (next === null || !next.trim() || next.trim() === current) return
    const { error } = await renameActivityType(id, next)
    if (error) toast(error, 'error')
    else {
      reload()
      toast('Activity type renamed.', 'success')
    }
  }

  const handleToggle = async (id: string, isActive: boolean) => {
    const { error } = await setActivityTypeActive(id, !isActive)
    if (error) toast(error, 'error')
    else {
      reload()
      toast(isActive ? 'Activity type deactivated.' : 'Activity type activated.', 'success')
    }
  }

  return (
    <Card
      title="Activity Types"
      subtitle="Work categories available when logging time"
      icon={<IconTag className="h-4.5 w-4.5" />}
    >
      <form onSubmit={handleAdd} className="flex flex-wrap items-end gap-2">
        <Field label="Add activity type" className="min-w-52 flex-1">
          <Input placeholder="e.g. Support" value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Button type="submit">Add</Button>
      </form>

      <div className="mt-4 overflow-x-auto rounded-lg border border-slate-100">
        <table className="w-full text-sm">
          <thead className="bg-slate-50/60">
            <tr>
              <Th>Name</Th>
              <Th className="text-center">Status</Th>
              <Th className="text-right">Actions</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={3} className="p-4">
                  <EmptyState className="py-6" icon={<IconTag className="h-5 w-5" />} title="No activity types yet" />
                </td>
              </tr>
            ) : (
              rows.map(t => (
                <tr key={t.id} className="transition-colors hover:bg-slate-50/70">
                  <Td className="font-medium text-slate-800">{t.name}</Td>
                  <Td className="text-center">
                    <Badge tone={t.is_active ? 'green' : 'slate'}>{t.is_active ? 'Active' : 'Inactive'}</Badge>
                  </Td>
                  <Td className="text-right">
                    <div className="inline-flex items-center gap-1">
                      <Button variant="ghost" size="sm" onClick={() => handleRename(t.id, t.name)} className="px-2 text-primary-600 hover:bg-primary-50">
                        <IconPencil className="h-3.5 w-3.5" />
                        <span className="sr-only">Rename</span>
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => handleToggle(t.id, t.is_active)} className="px-2">
                        {t.is_active ? 'Deactivate' : 'Activate'}
                      </Button>
                    </div>
                  </Td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
