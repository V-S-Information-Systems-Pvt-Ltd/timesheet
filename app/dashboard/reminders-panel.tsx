// app/dashboard/reminders-panel.tsx
'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Reminder } from '../types'

const supabase = createClient()

export default function RemindersPanel({ userId }: { userId: string }) {
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [message, setMessage] = useState('')
  const [remindAt, setRemindAt] = useState('')
  const [error, setError] = useState('')

  const fetchReminders = useCallback(async () => {
    const { data, error } = await supabase
      .from('reminders')
      .select('*')
      .eq('user_id', userId)
      .order('remind_at', { ascending: true })
      .limit(50)
    if (!error && data) setReminders(data)
  }, [userId])

  useEffect(() => {
    let active = true
    supabase
      .from('reminders')
      .select('*')
      .eq('user_id', userId)
      .order('remind_at', { ascending: true })
      .limit(50)
      .then(({ data, error }) => {
        if (active && !error && data) setReminders(data)
      })
    return () => { active = false }
  }, [userId])

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!message.trim() || !remindAt) {
      setError('Message and time are required.')
      return
    }
    const { error } = await supabase.from('reminders').insert({
      user_id: userId,
      message: message.trim(),
      remind_at: new Date(remindAt).toISOString(),
    })
    if (error) setError(error.message)
    else {
      setMessage('')
      setRemindAt('')
      fetchReminders()
    }
  }

  const handleDone = async (id: string) => {
    await supabase.from('reminders').update({ done: true }).eq('id', id)
    fetchReminders()
  }

  const handleRemove = async (id: string) => {
    await supabase.from('reminders').delete().eq('id', id)
    fetchReminders()
  }

  const now = new Date().toISOString()
  const due = reminders.filter(r => !r.done && r.remind_at <= now)
  const upcoming = reminders.filter(r => !r.done && r.remind_at > now)

  return (
    <div className="bg-white p-6 rounded-lg shadow-sm border">
      <h2 className="text-xl font-semibold mb-4 text-purple-700">Reminders</h2>

      {due.length > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded p-3 mb-4">
          {due.map(r => (
            <div key={r.id} className="flex items-center justify-between gap-2 text-sm mb-1 last:mb-0">
              <span>⏰ {r.message}</span>
              <button onClick={() => handleDone(r.id)} className="text-xs text-blue-600 hover:underline">Dismiss</button>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={handleAdd} className="flex flex-wrap gap-2 mb-4">
        <input
          type="text"
          placeholder="Remind me to..."
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          required
          className="flex-1 min-w-48 border p-2 rounded"
        />
        <input
          type="datetime-local"
          value={remindAt}
          onChange={(e) => setRemindAt(e.target.value)}
          required
          className="border p-2 rounded"
        />
        <button type="submit" className="bg-purple-600 text-white px-4 py-2 rounded hover:bg-purple-700">
          Set Reminder
        </button>
      </form>

      {error && <p className="text-red-600 text-sm mb-3">{error}</p>}

      <div className="space-y-1">
        {upcoming.map(r => (
          <div key={r.id} className="flex items-center justify-between gap-2 text-sm border-b py-1">
            <div>
              <div>{r.message}</div>
              <div className="text-xs text-gray-500">{new Date(r.remind_at).toLocaleString()}</div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => handleRemove(r.id)} className="text-red-600 text-xs hover:underline">Remove</button>
            </div>
          </div>
        ))}
        {upcoming.length === 0 && (
          <p className="text-gray-400 text-xs">No upcoming reminders.</p>
        )}
      </div>
    </div>
  )
}
