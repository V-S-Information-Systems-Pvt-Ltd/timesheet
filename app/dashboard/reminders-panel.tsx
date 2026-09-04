// app/dashboard/reminders-panel.tsx
'use client'

import { useState } from 'react'
import { dataClient } from '@/lib/data/client'
import { Reminder } from '../types'
import { useAsyncData } from '../hooks'
import { Button, Card, EmptyState, Field, Input } from '@/app/components/ui'
import { toast } from '@/app/components/toast'
import { IconAlert, IconBell, IconCheck, IconClock, IconPlus, IconTrash } from '@/app/components/icons'

export default function RemindersPanel({ userId }: { userId: string }) {
  const [message, setMessage] = useState('')
  const [remindAt, setRemindAt] = useState('')
  const [error, setError] = useState('')

  // Reminders load on mount and refresh after mutations.
  const { data: reminders, reload: reloadReminders } = useAsyncData<Reminder[]>(
    async () => {
      const { data, error } = await dataClient.getReminders(userId)
      return { data, error: error ? { message: error } : null }
    },
    [userId]
  )
  const reminderRows = reminders ?? []

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!message.trim() || !remindAt) {
      setError('Message and time are required.')
      return
    }
    const { error } = await dataClient.insertReminder({
      userId,
      message: message.trim(),
      remindAt: new Date(remindAt).toISOString(),
    })
    if (error) {
      setError(error)
      toast(error, 'error')
    } else {
      setMessage('')
      setRemindAt('')
      reloadReminders()
      toast('Reminder set.', 'success')
    }
  }

  const handleDone = async (id: string) => {
    const { error } = await dataClient.updateReminder(id, true)
    if (error) {
      toast(error, 'error')
      return
    }
    reloadReminders()
    toast('Reminder dismissed.', 'success')
  }

  const handleRemove = async (id: string) => {
    const { error } = await dataClient.deleteReminder(id)
    if (error) {
      toast(error, 'error')
      return
    }
    reloadReminders()
    toast('Reminder removed.', 'success')
  }

  const now = new Date().toISOString()
  const due = reminderRows.filter(r => !r.done && r.remind_at <= now)
  const upcoming = reminderRows.filter(r => !r.done && r.remind_at > now)

  return (
    <Card
      title="Reminders"
      subtitle={upcoming.length > 0 ? `${upcoming.length} upcoming` : 'No upcoming reminders'}
      icon={<IconBell className="h-4.5 w-4.5" />}
    >
      {due.length > 0 && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3.5">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-amber-700">
            <IconAlert className="h-4 w-4" /> Due now ({due.length})
          </p>
          <div className="space-y-1.5">
            {due.map(r => (
              <div key={r.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="flex items-center gap-1.5 text-amber-900">
                  <IconClock className="h-4 w-4 shrink-0 text-amber-700" />
                  {r.message}
                </span>
                <Button variant="secondary" size="sm" onClick={() => handleDone(r.id)}>
                  <IconCheck className="h-3.5 w-3.5" /> Dismiss
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      <form onSubmit={handleAdd} className="space-y-3">
        <Field label="Remind me to…">
          <Input
            type="text"
            placeholder="e.g. Submit weekly report"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            required
          />
        </Field>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="When" className="min-w-52 flex-1">
            <Input
              type="datetime-local"
              value={remindAt}
              onChange={(e) => setRemindAt(e.target.value)}
              required
            />
          </Field>
          <Button type="submit">
            <IconPlus className="h-4 w-4" /> Set Reminder
          </Button>
        </div>
      </form>

      {error && <p role="alert" className="mt-3 text-sm text-rose-600">{error}</p>}

      <div className="mt-5 border-t border-slate-100 pt-4">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600">Upcoming</h3>
        {upcoming.length === 0 ? (
          <EmptyState
            className="py-6"
            icon={<IconBell className="h-5 w-5" />}
            title="No upcoming reminders"
            description="Set one above and it will appear here."
          />
        ) : (
          <div className="space-y-1.5">
            {upcoming.map(r => (
              <div
                key={r.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 px-3 py-2.5 transition hover:border-slate-200"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm text-slate-700">{r.message}</div>
                  <div className="text-xs tabular-nums text-slate-600">
                    {new Date(r.remind_at).toLocaleString()}
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => handleRemove(r.id)} className="shrink-0 px-2 text-rose-600 hover:bg-rose-50">
                  <IconTrash className="h-3.5 w-3.5" />
                  <span className="sr-only">Remove</span>
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  )
}
