// app/dashboard/activity-types-panel.tsx
'use client'

import { useState } from 'react'
import { addActivityType, renameActivityType, setActivityTypeActive, setActivityTypeTelegramNo } from '../actions'
import { ActivityType } from '../types'
import { useAsyncData } from '../hooks'
import { dataClient } from '@/lib/data/client'
import { AsyncSection, Badge, Button, Card, DataTable, EmptyState, Field, IconButton, Input } from '@/app/components/ui'
import { PromptDialog } from '@/app/components/confirm'
import { toast } from '@/app/components/toast'
import { IconBotNumber, IconPencil, IconTag } from '@/app/components/icons'

export default function ActivityTypesPanel() {
  const [name, setName] = useState('')
  const [editTarget, setEditTarget] = useState<{ kind: 'rename' | 'telegram'; type: ActivityType } | null>(null)

  const { data: types, error: loadError, loading, reload } = useAsyncData<ActivityType[]>(
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

  const handleEditSubmit = async (kind: 'rename' | 'telegram', t: ActivityType, value: string) => {
    if (kind === 'rename') {
      if (value === t.name) return
      const { error } = await renameActivityType(t.id, value)
      if (error) toast(error, 'error')
      else {
        reload()
        toast('Activity type renamed.', 'success')
      }
      return
    }
    const numeric = value === '' ? null : Number(value)
    if (numeric !== null && (!Number.isInteger(numeric) || numeric <= 0)) {
      toast('Bot number must be a positive whole number.', 'error')
      return
    }
    const { error } = await setActivityTypeTelegramNo(t.id, numeric)
    if (error) toast(error, 'error')
    else {
      reload()
      toast(numeric ? `Bot number ${numeric} saved.` : 'Bot number cleared.', 'success')
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

      <div className="mt-4">
        <AsyncSection loading={loading} error={loadError} reload={reload}>
        <DataTable<ActivityType>
          className="rounded-lg border border-border"
          columns={[
            { key: 'name', header: 'Name', tdClassName: 'font-medium text-fg', cell: (t) => t.name },
            {
              key: 'status',
              header: 'Status',
              align: 'center',
              cell: (t) => <Badge tone={t.is_active ? 'green' : 'slate'}>{t.is_active ? 'Active' : 'Inactive'}</Badge>,
            },
            {
              key: 'bot',
              header: 'Bot No',
              align: 'center',
              cell: (t) =>
                t.telegram_no != null ? (
                  <Badge tone="green">#{t.telegram_no}</Badge>
                ) : (
                  <span className="text-xs text-fg-muted">—</span>
                ),
            },
            {
              key: 'actions',
              header: 'Actions',
              align: 'right',
              cell: (t) => (
                <div className="inline-flex items-center gap-1">
                  <IconButton label="Rename" size="sm" tone="primary" className="min-h-11 min-w-11 md:min-h-9 md:min-w-9" onClick={() => setEditTarget({ kind: 'rename', type: t })}>
                    <IconPencil className="h-3.5 w-3.5" />
                  </IconButton>
                  <IconButton label="Set Telegram bot number" size="sm" className="min-h-11 min-w-11 md:min-h-9 md:min-w-9" onClick={() => setEditTarget({ kind: 'telegram', type: t })}>
                    <IconBotNumber className="h-3.5 w-3.5" />
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
        title={editTarget?.kind === 'rename' ? 'Rename Activity Type' : 'Telegram Bot Number'}
        label={editTarget?.kind === 'rename' ? 'Activity type name' : 'Bot number (empty to clear)'}
        initialValue={
          editTarget
            ? editTarget.kind === 'rename'
              ? editTarget.type.name
              : editTarget.type.telegram_no != null
                ? String(editTarget.type.telegram_no)
                : ''
            : ''
        }
        inputMode={editTarget?.kind === 'telegram' ? 'numeric' : undefined}
        required={editTarget?.kind !== 'telegram'}
        submitLabel={editTarget?.kind === 'rename' ? 'Rename' : 'Save'}
        onSubmit={(value) => {
          if (!editTarget) return
          void handleEditSubmit(editTarget.kind, editTarget.type, value)
        }}
        onClose={() => setEditTarget(null)}
      />
    </Card>
  )
}
