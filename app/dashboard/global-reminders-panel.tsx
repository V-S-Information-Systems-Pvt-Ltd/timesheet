// app/dashboard/global-reminders-panel.tsx
'use client'

import { useState } from 'react'
import { addGlobalReminder, deleteGlobalReminder, dismissGlobalReminder } from '../actions'
import { GlobalReminder } from '../types'
import { useAsyncData } from '../hooks'
import { dataClient } from '@/lib/data/client'
import { Button, Card, EmptyState, Field, Input, Td, Th } from '@/app/components/ui'
import { toast } from '@/app/components/toast'
import { IconBell, IconCheck, IconTrash } from '@/app/components/icons'

export default function GlobalRemindersPanel({ variant }: { variant: 'own' | 'admin' }) {
  if (variant === 'admin') return <AdminView />
  return <OwnView />
}

function OwnView() {
  const { data, reload } = useAsyncData<GlobalReminder[]>(
    async () => {
      const { data, error } = await dataClient.getDueGlobalReminders()
      return { data, error: error ? { message: error } : null }
    },
    []
  )
  const rows = data ?? []

  const handleDismiss = async (id: string) => {
    const { error } = await dismissGlobalReminder(id)
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
            <div key={r.id} className="flex items-start justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
              <div className="min-w-0">
                <div className="text-sm text-amber-900">{r.message}</div>
                <div className="text-xs tabular-nums text-amber-700/70">
                  {new Date(r.remind_at).toLocaleString()}
                </div>
              </div>
              <Button variant="secondary" size="sm" onClick={() => handleDismiss(r.id)}>
                <IconCheck className="h-3.5 w-3.5" /> Dismiss
              </Button>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

function AdminView() {
  const [message, setMessage] = useState('')
  const [remindAt, setRemindAt] = useState('')

  const { data, reload } = useAsyncData<GlobalReminder[]>(
    async () => {
      const { data, error } = await dataClient.getGlobalReminders()
      return { data, error: error ? { message: error } : null }
    },
    []
  )
  const rows = data ?? []

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    const { error } = await addGlobalReminder({ message, remindAt })
    if (error) toast(error, 'error')
    else {
      setMessage('')
      setRemindAt('')
      reload()
      toast('Global reminder set.', 'success')
    }
  }

  const handleDelete = async (id: string) => {
    const { error } = await deleteGlobalReminder(id)
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

      <div className="mt-4 overflow-x-auto rounded-lg border border-slate-100">
        <table className="w-full text-sm">
          <thead className="bg-slate-50/60">
            <tr>
              <Th>Message</Th>
              <Th>Show from</Th>
              <Th className="text-right">Action</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={3} className="p-4 text-sm text-slate-400">No global reminders yet.</td>
              </tr>
            ) : (
              rows.map(r => (
                <tr key={r.id} className="transition-colors hover:bg-slate-50/70">
                  <Td className="font-medium text-slate-800">{r.message}</Td>
                  <Td className="tabular-nums text-slate-500">{new Date(r.remind_at).toLocaleString()}</Td>
                  <Td className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => handleDelete(r.id)} className="px-2 text-rose-600 hover:bg-rose-50">
                      <IconTrash className="h-3.5 w-3.5" />
                      <span className="sr-only">Delete</span>
                    </Button>
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
