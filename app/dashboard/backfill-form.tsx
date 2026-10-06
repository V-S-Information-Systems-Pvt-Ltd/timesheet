// app/dashboard/backfill-form.tsx
'use client'

import { useState } from 'react'
import { dataClient } from '@/lib/data/client'
import { ActivityType, Project, User } from '../types'
import { Button, Card, Field, Input, Select} from '@/app/components/ui'
import { toast } from '@/app/components/toast'
import { IconCalendar } from '@/app/components/icons'
import { addDaysISO, todayISO } from '@/lib/dates'
import ClassificationFields, { classificationInput, emptyClassification, validateWebEntry } from './classification-fields'

export default function BackfillForm({
  allUsers,
  projects,
  onChanged,
}: {
  allUsers: User[]
  projects: Project[]
  activityTypes: ActivityType[]
  onChanged: () => void
}) {
  const [userId, setUserId] = useState('')
  const [classification, setClassification] = useState({ ...emptyClassification })
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({})
  const [hours, setHours] = useState('')
  const [workDone, setWorkDone] = useState('')
  const [busy, setBusy] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    const validated = validateWebEntry({ ...classificationInput(classification), hoursWorked: parseFloat(hours), workDone, logDate: addDaysISO(todayISO(), -1) })
    setFieldErrors(validated.fieldErrors)
    if (!validated.input) return
    setBusy(true)
    try {
      const { logDate: _logDate, ...input } = validated.input
      const { error, fieldErrors: errors } = await dataClient.logYesterday({ ...input, userId })
      setFieldErrors(errors ?? {})
      if (error) toast(error, 'error')
      else {
        setUserId(''); setClassification({ ...emptyClassification }); setHours(''); setWorkDone('')
        onChanged()
        toast('Backfill saved!', 'success')
      }
    } catch {
      toast('Could not confirm the backfill. Refresh entries before retrying.', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card
      title="Backfill Yesterday"
      subtitle="Log yesterday's entry for another user"
      icon={<IconCalendar className="h-4.5 w-4.5" />}
    >
      <form onSubmit={handleSubmit} className="space-y-3.5">
        <Field label="User" error={fieldErrors.userId?.[0]}>
          <Select value={userId} onChange={(e) => setUserId(e.target.value)} required>
            <option value="">Select User…</option>
            {allUsers.map(u => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
          </Select>
        </Field>
        <ClassificationFields projects={projects} value={classification} fieldErrors={fieldErrors} idPrefix="backfill" onChange={value => { setClassification(value); setFieldErrors({}) }} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Hours" error={fieldErrors.hoursWorked?.[0]}>
            <Input type="number" step="0.25" min="0" max="24" placeholder="8.0" value={hours} onChange={(e) => setHours(e.target.value)} required />
          </Field>
          <Field label="Work Done" error={fieldErrors.workDone?.[0]}>
            <Input type="text" placeholder="Summary" value={workDone} onChange={(e) => setWorkDone(e.target.value)} required />
          </Field>
        </div>
        <Button type="submit" variant="secondary" className="w-full" disabled={busy}>
          {busy ? 'Saving…' : 'Save for User (1/day)'}
        </Button>
      </form>
    </Card>
  )
}
