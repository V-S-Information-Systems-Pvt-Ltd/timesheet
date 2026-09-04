// app/dashboard/settings-panel.tsx
'use client'

import { useState } from 'react'
import { setBackfillWindow } from '../actions'
import type { BackfillMode, BackfillSettings } from '@/lib/validation'
import { Button, Card, Field, Input, Select } from '@/app/components/ui'
import { toast } from '@/app/components/toast'
import { IconScale } from '@/app/components/icons'

export default function SettingsPanel({
  value,
  onSaved,
}: {
  value: BackfillSettings
  onSaved: (settings: BackfillSettings) => void
}) {
  const [mode, setMode] = useState<BackfillMode>(value.mode)
  const [days, setDays] = useState(String(value.windowDays))
  const [extraDays, setExtraDays] = useState(String(value.extraDays))
  const [saving, setSaving] = useState(false)

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    const windowDays = Number(days)
    const extra = Number(extraDays)
    if (!Number.isInteger(windowDays) || windowDays < 0 || windowDays > 365) {
      toast('Days window must be a whole number between 0 and 365.', 'error')
      return
    }
    if (!Number.isInteger(extra) || extra < 0 || extra > 365) {
      toast('Extra days must be a whole number between 0 and 365.', 'error')
      return
    }
    const settings: BackfillSettings = { mode, windowDays, extraDays: extra }
    setSaving(true)
    const { error } = await setBackfillWindow(settings)
    setSaving(false)
    if (error) toast(error, 'error')
    else {
      onSaved(settings)
      toast('Backfill window updated.', 'success')
    }
  }

  return (
    <Card
      title="Settings"
      subtitle="How far back users can log or edit time"
      icon={<IconScale className="h-4.5 w-4.5" />}
    >
      <form onSubmit={handleSave} className="space-y-3">
        <Field label="Backfill mode" className="w-56">
          <Select value={mode} onChange={(e) => setMode(e.target.value as BackfillMode)}>
            <option value="days">Last N days</option>
            <option value="month_start">Current month + X days</option>
          </Select>
        </Field>

        {mode === 'days' ? (
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
        ) : (
          <Field
            label="Extra days before this month"
            hint="0 = from the 1st of this month"
            className="w-44"
          >
            <Input
              type="number"
              min={0}
              max={365}
              value={extraDays}
              onChange={(e) => setExtraDays(e.target.value)}
            />
          </Field>
        )}

        <Button type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </form>
      <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600 ring-1 ring-inset ring-slate-200">
        {mode === 'days'
          ? 'Entries dated more than this many days in the past become read-only for regular users. Admins can always log and edit any entry.'
          : 'Regular users can log and edit from the first day of the current month, minus the extra days, up to today. Admins can always log and edit any entry.'}
      </p>
    </Card>
  )
}
