// app/dashboard/time-entry-form.tsx
'use client'

import { useState } from 'react'
import { logEntry, logYesterday } from '../actions'
import { ActivityType, Project } from '../types'
import { Button, Card, Field, Input, Select, Textarea} from '@/app/components/ui'
import { toast } from '@/app/components/toast'
import { IconChevronDown, IconClock } from '@/app/components/icons'

export default function TimeEntryForm({
  projects,
  activityTypes,
  minLogDate,
  yesterdayWritable,
  onLogged,
}: {
  projects: Project[]
  activityTypes: ActivityType[]
  minLogDate: string
  yesterdayWritable: boolean
  onLogged: () => void
}) {
  const [projectId, setProjectId] = useState('')
  const [activityTypeId, setActivityTypeId] = useState('')
  const [hours, setHours] = useState('')
  const [workDone, setWorkDone] = useState('')
  const [logDate, setLogDate] = useState(new Date().toISOString().split('T')[0])

  const [showYesterday, setShowYesterday] = useState(false)
  const [yesterdayProjectId, setYesterdayProjectId] = useState('')
  const [yesterdayActivityTypeId, setYesterdayActivityTypeId] = useState('')
  const [yesterdayHours, setYesterdayHours] = useState('')
  const [yesterdayWorkDone, setYesterdayWorkDone] = useState('')

  const handleLogEntry = async (e: React.FormEvent) => {
    e.preventDefault()
    const { error } = await logEntry({
      projectId,
      activityTypeId,
      hoursWorked: parseFloat(hours),
      workDone,
      logDate,
    })
    if (error) toast(error, 'error')
    else {
      setHours(''); setWorkDone('')
      onLogged()
      toast('Time logged successfully!', 'success')
    }
  }

  const handleLogYesterday = async (e: React.FormEvent) => {
    e.preventDefault()
    const { error } = await logYesterday({
      projectId: yesterdayProjectId,
      activityTypeId: yesterdayActivityTypeId,
      hoursWorked: parseFloat(yesterdayHours),
      workDone: yesterdayWorkDone,
    })
    if (error) toast(error, 'error')
    else {
      setYesterdayProjectId('')
      setYesterdayActivityTypeId('')
      setYesterdayHours('')
      setYesterdayWorkDone('')
      onLogged()
      toast('Logged for yesterday!', 'success')
    }
  }

  return (
    <Card
      title="Log Time"
      subtitle={`Writable from ${minLogDate} (today included)`}
      icon={<IconClock className="h-4.5 w-4.5" />}
    >
      <form onSubmit={handleLogEntry} className="space-y-4">
        <Field label="Project">
          <Select value={projectId} onChange={(e) => setProjectId(e.target.value)} required>
            <option value="">Select Project…</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
        <Field label="Activity Type">
          <Select value={activityTypeId} onChange={(e) => setActivityTypeId(e.target.value)} required>
            <option value="">Select Type…</option>
            {activityTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date">
            <Input type="date" min={minLogDate} value={logDate} onChange={(e) => setLogDate(e.target.value)} required />
          </Field>
          <Field label="Hours">
            <Input type="number" step="0.25" min="0" placeholder="8.0" value={hours} onChange={(e) => setHours(e.target.value)} required />
          </Field>
        </div>
        <Field label="Work Done">
          <Textarea placeholder="What did you work on?" value={workDone} onChange={(e) => setWorkDone(e.target.value)} required className="h-24" />
        </Field>
        <Button type="submit" className="w-full py-2.5">Submit Entry</Button>
      </form>

      <div className="mt-5 border-t border-slate-100 pt-4">
        <button
          type="button"
          onClick={() => setShowYesterday(!showYesterday)}
          disabled={!yesterdayWritable}
          title={yesterdayWritable ? undefined : 'Yesterday is outside the writable backfill window'}
          className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm font-medium text-primary-600 transition hover:bg-primary-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span>Log Yesterday</span>
          <IconChevronDown className={`h-4 w-4 transition-transform ${showYesterday ? 'rotate-180' : ''}`} />
        </button>
        {showYesterday && (
          <form onSubmit={handleLogYesterday} className="mt-2 space-y-3">
            <Field label="Project">
              <Select value={yesterdayProjectId} onChange={(e) => setYesterdayProjectId(e.target.value)} required>
                <option value="">Select Project…</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </Field>
            <Field label="Activity Type">
              <Select value={yesterdayActivityTypeId} onChange={(e) => setYesterdayActivityTypeId(e.target.value)} required>
                <option value="">Select Type…</option>
                {activityTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Hours">
                <Input type="number" step="0.25" min="0" placeholder="8.0" value={yesterdayHours} onChange={(e) => setYesterdayHours(e.target.value)} required />
              </Field>
              <Field label="Work Done">
                <Input type="text" placeholder="Summary" value={yesterdayWorkDone} onChange={(e) => setYesterdayWorkDone(e.target.value)} required />
              </Field>
            </div>
            <Button type="submit" variant="secondary" className="w-full">Save Yesterday</Button>
          </form>
        )}
      </div>
    </Card>
  )
}
