// app/dashboard/global-reminders-panel.tsx
'use client'

import { useState } from 'react'
import { GlobalReminder } from '../types'
import { useAsyncData } from '../hooks'
import { dataClient } from '@/lib/data/client'
import { Alert, AsyncSection, Button, Card, EmptyState, Field, IconButton, Input, TableFrame, Td, Th } from '@/app/components/ui'
import { toast } from '@/app/components/toast'
import { IconBell, IconCheck, IconTrash } from '@/app/components/icons'

export default function GlobalRemindersPanel({ variant }: { variant: 'own' | 'admin' }) {
  if (variant === 'admin') return <AdminView />
  return <OwnView />
}

function OwnView() {
  const { data, error: loadError, loading, reload } = useAsyncData<GlobalReminder[]>(
    async () => {
      const { data, error } = await dataClient.getDueGlobalReminders()
      return { data, error: error ? { message: error } : null }
    },
    []
  )
  const rows = data ?? []

  const handleDismiss = async (id: string) => {
    const { error } = await dataClient.dismissGlobalReminder(id)
    if (error) toast(error, 'error')
    else {
      reload()
      toast('Reminder dismissed.', 'success')
    }
  }

  return (
    <Card
      title="Global Reminders"
      subtitle={rows.length > 0 ? `${rows.length} active` : 'No active reminders'}
      icon={<IconBell className="h-4.5 w-4.5" />}
    >
      <AsyncSection loading={loading} error={loadError} reload={reload} skeletonLines={2}>
      {rows.length === 0 ? (
        <EmptyState
          className="py-6"
          icon={<IconBell className="h-5 w-5" />}
          title="Nothing due"
          description="Global reminders from administrators will appear here."
        />
      ) : (
        <div className="space-y-2">
          {rows.map(r => (
            <Alert key={r.id} tone="warning" className="flex items-start justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <div className="text-sm">{r.message}</div>
                <div className="text-xs tabular-nums opacity-80">
                  {new Date(r.remind_at).toLocaleString()}
                </div>
              </div>
              <Button variant="secondary" size="sm" onClick={() => handleDismiss(r.id)}>
                <IconCheck className="h-3.5 w-3.5" /> Dismiss
              </Button>
            </Alert>
          ))}
        </div>
      )}
      </AsyncSection>
    </Card>
  )
}

function AdminView() {
  const [message, setMessage] = useState('')
  const [remindAt, setRemindAt] = useState('')

  const { data, error: loadError, loading, reload } = useAsyncData<GlobalReminder[]>(
    async () => {
      const { data, error } = await dataClient.getGlobalReminders()
      return { data, error: error ? { message: error } : null }
    },
    []
  )
  const rows = data ?? []

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    const { error } = await dataClient.addGlobalReminder({ message, remindAt })
    if (error) toast(error, 'error')
    else {
      setMessage('')
      setRemindAt('')
      reload()
      toast('Global reminder set.', 'success')
    }
  }

  const handleDelete = async (id: string) => {
    const { error } = await dataClient.deleteGlobalReminder(id)
    if (error) toast(error, 'error')
    else {
      reload()
      toast('Global reminder removed.', 'success')
    }
  }

  return (
    <Card
      title="Global Reminders"
      subtitle="Announcements shown to every user"
      icon={<IconBell className="h-4.5 w-4.5" />}
    >
      <form onSubmit={handleAdd} className="space-y-3">
        <Field label="Message">
          <Input placeholder="e.g. Submit timesheets by Friday" value={message} onChange={(e) => setMessage(e.target.value)} required />
        </Field>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Show from" className="min-w-52 flex-1">
            <Input type="datetime-local" value={remindAt} onChange={(e) => setRemindAt(e.target.value)} required />
          </Field>
          <Button type="submit">Set Reminder</Button>
        </div>
      </form>

      <AsyncSection loading={loading} error={loadError} reload={reload}>
      <TableFrame className="mt-4 rounded-lg border border-border" tableClassName="text-sm">
        <caption className="sr-only">Global reminders</caption>
        <thead className="bg-muted/60">
          <tr>
            <Th>Message</Th>
            <Th>Show from</Th>
            <Th className="text-right">Action</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={3} className="p-4">
                <EmptyState title="No global reminders yet" description="Set one above; every active user sees it." className="py-6" />
              </td>
            </tr>
          ) : (
            rows.map(r => (
              <tr key={r.id} className="transition-colors hover:bg-muted/70">
                <Td className="font-medium text-fg">{r.message}</Td>
                <Td className="tabular-nums text-fg-muted">{new Date(r.remind_at).toLocaleString()}</Td>
                <Td className="text-right">
                  <IconButton label="Delete" size="sm" tone="danger" onClick={() => handleDelete(r.id)} className="min-h-11 min-w-11 md:min-h-9 md:min-w-9">
                    <IconTrash className="h-3.5 w-3.5" />
                  </IconButton>
                </Td>
              </tr>
            ))
          )}
        </tbody>
      </TableFrame>
      </AsyncSection>
    </Card>
  )
}
