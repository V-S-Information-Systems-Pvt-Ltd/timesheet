// app/dashboard/reminders-panel.tsx
'use client'

import { useState } from 'react'
import { dataClient } from '@/lib/data/client'
import { Reminder } from '../types'
import { useAsyncData } from '../hooks'
import { Alert, AsyncSection, Button, Card, EmptyState, Field, IconButton, Input } from '@/app/components/ui'
import { toast } from '@/app/components/toast'
import { IconAlert, IconBell, IconCheck, IconClock, IconPlus, IconTrash } from '@/app/components/icons'

export default function RemindersPanel({ userId }: { userId: string }) {
  const [message, setMessage] = useState('')
  const [remindAt, setRemindAt] = useState('')
  const [error, setError] = useState('')

  // Reminders load on mount and refresh after mutations.
  const { data: reminders, error: loadError, loading, reload: reloadReminders } = useAsyncData<Reminder[]>(
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
        <Alert tone="warning" className="mb-4 rounded-xl p-3.5">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide">
            <IconAlert className="h-4 w-4" /> Due now ({due.length})
          </p>
          <div className="space-y-1.5">
            {due.map(r => (
              <div key={r.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="flex items-center gap-1.5">
                  <IconClock className="h-4 w-4 shrink-0" />
                  {r.message}
                </span>
                <Button variant="secondary" size="sm" onClick={() => handleDone(r.id)}>
                  <IconCheck className="h-3.5 w-3.5" /> Dismiss
                </Button>
              </div>
            ))}
          </div>
        </Alert>
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

      {error && <Alert tone="error" className="mt-3">{error}</Alert>}

      <div className="mt-5 border-t border-border pt-4">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">Upcoming</h3>
        <AsyncSection loading={loading} error={loadError} reload={reloadReminders} skeletonLines={2}>
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
                className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2.5 transition hover:border-border"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm text-fg-muted">{r.message}</div>
                  <div className="text-xs tabular-nums text-fg-muted">
                    {new Date(r.remind_at).toLocaleString()}
                  </div>
                </div>
                <IconButton label="Remove" size="sm" tone="danger" onClick={() => handleRemove(r.id)} className="min-h-11 min-w-11 shrink-0 md:min-h-9 md:min-w-9">
                  <IconTrash className="h-3.5 w-3.5" />
                </IconButton>
              </div>
            ))}
          </div>
        )}
        </AsyncSection>
      </div>
    </Card>
  )
}
