// app/dashboard/activity-types-panel.tsx
'use client'

import { useState } from 'react'
import { addActivityType, renameActivityType, setActivityTypeActive, setActivityTypeTelegramNo } from '../actions'
import { ActivityType } from '../types'
import { useAsyncData } from '../hooks'
import { dataClient } from '@/lib/data/client'
import { Badge, Button, Card, EmptyState, Field, Input, Td, Th } from '@/app/components/ui'
import { PromptDialog } from '@/app/components/confirm'
import { toast } from '@/app/components/toast'
import { IconPencil, IconTag } from '@/app/components/icons'

export default function ActivityTypesPanel() {
  const [name, setName] = useState('')
  const [editTarget, setEditTarget] = useState<{ kind: 'rename' | 'telegram'; type: ActivityType } | null>(null)

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

      <div className="mt-4 overflow-x-auto rounded-lg border border-slate-100">
        <table className="w-full text-sm">
          <thead className="bg-slate-50/60">
            <tr>
              <Th>Name</Th>
              <Th className="text-center">Status</Th>
              <Th className="text-center">Bot No</Th>
              <Th className="text-right">Actions</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="p-4">
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
                  <Td className="text-center">
                    {t.telegram_no != null ? (
                      <Badge tone="green">#{t.telegram_no}</Badge>
                    ) : (
                      <span className="text-xs text-slate-600">—</span>
                    )}
                  </Td>
                  <Td className="text-right">
                    <div className="inline-flex items-center gap-1">
                      <Button variant="ghost" size="sm" onClick={() => setEditTarget({ kind: 'rename', type: t })} className="px-2 text-primary-600 hover:bg-primary-50">
                        <IconPencil className="h-3.5 w-3.5" />
                        <span className="sr-only">Rename</span>
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setEditTarget({ kind: 'telegram', type: t })} title="Telegram bot number" className="px-2 text-emerald-600 hover:bg-emerald-50">
                        <span className="text-[10px] font-bold">#</span>
                        <span className="sr-only">Set Telegram bot number</span>
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
