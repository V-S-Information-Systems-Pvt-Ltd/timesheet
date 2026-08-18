// app/dashboard/time-entry-form.tsx
'use client'

import { useMemo, useState } from 'react'
import { logEntry } from '../actions'
import { todayISO } from '@/lib/dates'
import { buildBotCommand } from '@/lib/telegram'
import { copyText } from '@/lib/clipboard'
import { ActivityType, Project } from '../types'
import { Button, Card, Field, Input, Textarea } from '@/app/components/ui'
import { cn } from '@/app/components/cn'
import { toast } from '@/app/components/toast'
import { IconClock } from '@/app/components/icons'
import ProjectPicker from './project-picker'

/** Activity-type radio group for the log-time form. */
function ActivityTypeRadios({
  types,
  value,
  onChange,
}: {
  types: ActivityType[]
  value: string
  onChange: (id: string) => void
}) {
  return (
    <div className="space-y-1.5">
      {types.map(t => (
        <label
          key={t.id}
          className={cn(
            'flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-sm transition-colors',
            value === t.id
              ? 'border-primary-600 bg-primary-50 font-medium text-primary-800'
              : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
          )}
        >
          <input
            type="radio"
            name="activity-type"
            value={t.id}
            checked={value === t.id}
            onChange={() => onChange(t.id)}
            required={!value}
            className="h-4 w-4 shrink-0 accent-primary-600"
          />
          {t.name}
        </label>
      ))}
    </div>
  )
}

export default function TimeEntryForm({
  projects,
  activityTypes,
  minLogDate,
  onLogged,
}: {
  projects: Project[]
  activityTypes: ActivityType[]
  minLogDate: string
  onLogged: () => void
}) {
  const [projectId, setProjectId] = useState('')
  const [activityTypeId, setActivityTypeId] = useState('')
  const [hours, setHours] = useState('')
  const [workDone, setWorkDone] = useState('')
  // Local calendar date (not UTC): in timezones ahead of UTC the UTC date
  // is still "yesterday" during the early-morning hours.
  const [logDate, setLogDate] = useState(todayISO())
  const [copyCommand, setCopyCommand] = useState(false)

  const [busy, setBusy] = useState(false)

  // Default the project to "Internal" (the placeholder project) until the
  // user explicitly picks a real one. Derived during render so no effect is
  // needed; the submit handler uses the effective id.
  const internalProject = useMemo(() => projects.find(p => p.name === 'Internal'), [projects])
  const effectiveProjectId = projectId || internalProject?.id || ''

  const handleLogEntry = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    try {
      const { error } = await logEntry({
        projectId: effectiveProjectId,
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
        if (copyCommand) {
          const project = projects.find(p => p.id === effectiveProjectId)
          const type = activityTypes.find(t => t.id === activityTypeId)
          const { command } = buildBotCommand(
            { log_date: logDate, hours_worked: parseFloat(hours), work_done: workDone },
            project,
            type
          )
          if (command) {
            const ok = await copyText(command)
            if (ok) toast('Telegram command copied.', 'success')
          }
        }
      }
    } finally {
      setBusy(false)
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
          <ProjectPicker
            projects={projects}
            value={effectiveProjectId}
            onChange={setProjectId}
            required
          />
        </Field>
        <Field label="Activity Type">
          <ActivityTypeRadios types={activityTypes} value={activityTypeId} onChange={setActivityTypeId} />
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
        <div className="flex items-center justify-between gap-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={copyCommand}
              onChange={(e) => setCopyCommand(e.target.checked)}
              className="h-4 w-4 accent-primary-600"
            />
            Copy Telegram command
          </label>
          <Button type="submit" className="py-2.5" disabled={busy}>{busy ? 'Submitting…' : 'Submit Entry'}</Button>
        </div>
      </form>
    </Card>
  )
}