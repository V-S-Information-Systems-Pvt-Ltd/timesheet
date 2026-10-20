// app/dashboard/activity-types-panel.tsx
'use client'

import { useState } from 'react'
import { ENTRY_TYPE_LABELS } from '@vsis/contracts'
import { ActivityType } from '../types'
import { useAsyncData } from '../hooks'
import { dataClient } from '@/lib/data/client'
import { AsyncSection, Badge, Button, Card, DataTable, EmptyState, Field, IconButton, Input, Select } from '@/app/components/ui'
import { PromptDialog } from '@/app/components/confirm'
import { toast } from '@/app/components/toast'
import { IconPencil, IconTag } from '@/app/components/icons'

const ORDER = ['project', 'internal', 'support', 'legacy']

export default function ActivityTypesPanel() {
  const [name, setName] = useState('')
  // Project/Internal activities appear under Activity in Log Time; legacy
  // types only back historical entries. Support activities are fixed.
  const [scope, setScope] = useState<'project' | 'internal' | 'legacy'>('project')
  const [editTarget, setEditTarget] = useState<ActivityType | null>(null)

  const { data: types, error: loadError, loading, reload } = useAsyncData<ActivityType[]>(
    async () => {
      const { data, error } = await dataClient.getAllActivityTypes()
      return { data, error: error ? { message: error } : null }
    },
    []
  )
  const scopeOf = (t: ActivityType) => t.entry_type ?? 'legacy'
  const rows = [...(types ?? [])].sort((a, b) => ORDER.indexOf(scopeOf(a)) - ORDER.indexOf(scopeOf(b)) || a.name.localeCompare(b.name))

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    const { error } = await dataClient.addActivityType(name, scope === 'legacy' ? undefined : scope)
    if (error) toast(error, 'error')
    else {
      setName('')
      reload()
      toast('Activity type added.', 'success')
    }
  }

  const handleRename = async (t: ActivityType, value: string) => {
    if (value === t.name) return
    const { error } = await dataClient.renameActivityType(t.id, value)
    if (error) toast(error, 'error')
    else {
      reload()
      toast('Activity type renamed.', 'success')
    }
  }

  const handleToggle = async (id: string, isActive: boolean) => {
    const { error } = await dataClient.setActivityTypeActive(id, !isActive)
    if (error) toast(error, 'error')
    else {
      reload()
      toast(isActive ? 'Activity type deactivated.' : 'Activity type activated.', 'success')
    }
  }

  return (
    <Card
      title="Activity Types"
      subtitle="Activities offered per Type in Log Time (Support activities are fixed)"
      icon={<IconTag className="h-4.5 w-4.5" />}
    >
      <form onSubmit={handleAdd} className="flex flex-wrap items-end gap-2">
        <Field label="Type" className="w-40">
          <Select value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}>
            <option value="project">Project</option>
            <option value="internal">Internal</option>
            <option value="legacy">Legacy (historical)</option>
          </Select>
        </Field>
        <Field label="Add activity" className="min-w-52 flex-1">
          <Input placeholder="e.g. Support" value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Button type="submit">Add</Button>
      </form>

      <div className="mt-4">
        <AsyncSection loading={loading} error={loadError} reload={reload}>
        <DataTable<ActivityType>
          className="rounded-lg border border-border"
          columns={[
            { key: 'type', header: 'Type', cell: (t) => t.entry_type ? ENTRY_TYPE_LABELS[t.entry_type] : 'Legacy' },
            { key: 'name', header: 'Activity', tdClassName: 'font-medium text-fg', cell: (t) => t.name },
            {
              key: 'status',
              header: 'Status',
              align: 'center',
              cell: (t) => <Badge tone={t.is_active ? 'green' : 'slate'}>{t.is_active ? 'Active' : 'Inactive'}</Badge>,
            },
            {
              key: 'actions',
              header: 'Actions',
              align: 'right',
              cell: (t) => t.entry_type === 'support' ? <span className="text-xs text-fg-subtle">Fixed</span> : (
                <div className="inline-flex items-center gap-1">
                  <IconButton label="Rename" size="sm" tone="primary" className="min-h-11 min-w-11 md:min-h-9 md:min-w-9" onClick={() => setEditTarget(t)}>
                    <IconPencil className="h-3.5 w-3.5" />
                  </IconButton>
                  <Button variant="ghost" size="sm" onClick={() => handleToggle(t.id, t.is_active)} className="px-2">
                    {t.is_active ? 'Deactivate' : 'Activate'}
                  </Button>
                </div>
              ),
            },
          ]}
          rows={rows}
          rowKey={(t) => t.id}
          empty={<EmptyState className="py-6" icon={<IconTag className="h-5 w-5" />} title="No activity types yet" />}
        />
        </AsyncSection>
      </div>

      <PromptDialog
        open={editTarget !== null}
        title="Rename Activity Type"
        label="Activity type name"
        initialValue={editTarget?.name ?? ''}
        required
        submitLabel="Rename"
        onSubmit={(value) => {
          if (!editTarget) return
          void handleRename(editTarget, value)
        }}
        onClose={() => setEditTarget(null)}
      />
    </Card>
  )
}
