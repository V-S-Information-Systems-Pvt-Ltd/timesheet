// app/dashboard/settings-panel.tsx
'use client'

import { useState } from 'react'
import { setBackfillWindow } from '../actions'
import { Button, Card, Field, IconScale, Input, toast } from '@/app/components/ui'

export default function SettingsPanel({
  value,
  onSaved,
}: {
  value: number
  onSaved: (days: number) => void
}) {
  const [days, setDays] = useState(String(value))
  const [saving, setSaving] = useState(false)

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    const parsed = Number(days)
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 365) {
      toast('Enter a whole number of days between 0 and 365.', 'error')
      return
    }
    setSaving(true)
    const { error } = await setBackfillWindow(parsed)
    setSaving(false)
    if (error) toast(error, 'error')
    else {
      onSaved(parsed)
      toast(`Backfill window set to ${parsed} day(s).`, 'success')
    }
  }

  return (
    <Card
      title="Settings"
      subtitle="How far back users can log or edit time"
      icon={<IconScale className="h-4.5 w-4.5" />}
    >
      <form onSubmit={handleSave} className="flex flex-wrap items-end gap-3">
        <Field
          label="Backfill window (days)"
          hint="0 = today only · 1 = today + yesterday"
          className="w-44"
        >
          <Input
            type="number"
            min={0}
            max={365}
            value={days}
            onChange={(e) => setDays(e.target.value)}
          />
        </Field>
        <Button type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </form>
      <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-500 ring-1 ring-inset ring-slate-200">
        Entries dated more than this many days in the past become read-only for
        regular users. Admins can always log and edit any entry.
      </p>
    </Card>
  )
}
