// app/dashboard/time-entry-form.tsx
'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { logEntry } from '../actions'
import { dataClient } from '@/lib/data/client'
import { getRecentWorkDetailed, saveRecentWorkDetailed, type CachedWorkEntry } from '@/lib/cache'
import { computeSmartHours, timesheetToLogEntry } from '@/lib/smart-hours'
import { todayISO } from '@/lib/dates'
import { buildBotCommand } from '@/lib/telegram'
import { copyText } from '@/lib/clipboard'
import { ActivityType, OptimisticTimesheet, Project, Timesheet } from '../types'
import { Button, Card, Field, Input, Autocomplete } from '@/app/components/ui'
import { cn } from '@/app/components/cn'
import { toast } from '@/app/components/toast'
import { IconClock, IconCopy } from '@/app/components/icons'
import ProjectPicker from './project-picker'

/** Activity-type radio group for the log-time form. Rendered as a real
 * fieldset/legend so screen readers announce the group name. */
function ActivityTypeRadios({
  types,
  value,
  onChange,
  error,
}: {
  types: ActivityType[]
  value: string
  onChange: (id: string) => void
  error?: string
}) {
  return (
    <fieldset className="space-y-1.5">
      <legend className="mb-1.5 text-xs font-medium text-slate-600">Activity Type</legend>
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
      {error && <p role="alert" className="text-xs text-rose-600">{error}</p>}
    </fieldset>
  )
}

export default function TimeEntryForm({
  projects,
  activityTypes,
  minLogDate,
  onLogged,
  collapsible = false,
}: {
  projects: Project[]
  activityTypes: ActivityType[]
  minLogDate: string
  onLogged: (entry?: OptimisticTimesheet) => void
  collapsible?: boolean
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
  const [recentWork, setRecentWork] = useState<CachedWorkEntry[]>([])
  const [recentEntries, setRecentEntries] = useState<Timesheet[]>([])
  // Per-field server validation errors, keyed by field name; cleared per
  // field as the user edits it.
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({})

  const clearFieldError = (key: string) =>
    setFieldErrors(prev => {
      if (!(key in prev)) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })

  const fieldError = (key: string): string | undefined => fieldErrors[key]?.[0]

  const internalProject = useMemo(() => projects.find(p => p.name === 'Internal'), [projects])
  const effectiveProjectId = projectId || internalProject?.id || ''
  const lastEntry = recentEntries[0] ?? null
  const smartHours = useMemo(() => {
    if (recentEntries.length === 0) return null
    return computeSmartHours(recentEntries.map(timesheetToLogEntry))
  }, [recentEntries])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRecentWork(getRecentWorkDetailed())
  }, [])

  const refreshRecentEntries = useCallback(async () => {
    const { data, error } = await dataClient.getTimesheets({ limit: 10 })
    if (!error && data) setRecentEntries(data)
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshRecentEntries()
  }, [refreshRecentEntries])

  const handleLogEntry = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    try {
      const { error, fieldErrors: errors } = await logEntry({
        projectId: effectiveProjectId,
        activityTypeId,
        hoursWorked: parseFloat(hours),
        workDone,
        logDate,
      })
      setFieldErrors(errors ?? {})
      if (error) toast(error, 'error')
      else {
        setHours(''); setWorkDone('')
        saveRecentWorkDetailed({ text: workDone, project: projects.find(p => p.id === effectiveProjectId)?.name, date: logDate })
        const optimistic: OptimisticTimesheet = {
          tempId: `optimistic-${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`}`,
          user_id: '',
          project_id: effectiveProjectId,
          activity_type_id: activityTypeId,
          log_date: logDate,
          hours_worked: parseFloat(hours),
          work_done: workDone,
          created_at: new Date().toISOString(),
        }
        onLogged(optimistic)
        refreshRecentEntries()
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

  const handleCopyDown = () => {
    if (!lastEntry) return
    setProjectId(lastEntry.project_id)
    setActivityTypeId(lastEntry.activity_type_id ?? '')
    setHours('')
    setWorkDone(lastEntry.work_done)
    toast('Copied details from your last entry.', 'success')
  }

  const handleQuickFillHours = () => {
    if (smartHours !== null) setHours(String(smartHours))
  }

  return (
    <Card
      title="Log Time"
      subtitle={`Writable from ${minLogDate} (today included)`}
      icon={<IconClock className="h-4.5 w-4.5" />}
      collapsible={collapsible}
    >
      <form onSubmit={handleLogEntry} className="space-y-4" data-shortcut="time-entry-form" tabIndex={-1}>
        <Field label="Project" id="project-input" error={fieldError('projectId')}>
          <ProjectPicker
            projects={projects}
            value={effectiveProjectId}
            onChange={(v) => { clearFieldError('projectId'); setProjectId(v) }}
            required
            inputId="project-input"
          />
        </Field>
        <ActivityTypeRadios
          types={activityTypes}
          value={activityTypeId}
          onChange={(id) => { clearFieldError('activityTypeId'); setActivityTypeId(id) }}
          error={fieldError('activityTypeId')}
        />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date" error={fieldError('logDate')}>
            <Input
              type="date"
              min={minLogDate}
              max={todayISO()}
              value={logDate}
              onChange={(e) => { clearFieldError('logDate'); setLogDate(e.target.value) }}
              required
            />
          </Field>
          <Field label="Hours" error={fieldError('hoursWorked')}>
            <Input
              type="number"
              step="0.25"
              min="0"
              max="24"
              placeholder={lastEntry && !hours ? String(lastEntry.hours_worked) : '8.0'}
              value={hours}
              onChange={(e) => { clearFieldError('hoursWorked'); setHours(e.target.value) }}
              required
            />
            {lastEntry && !hours && (
              <button type="button" onClick={() => setHours(String(lastEntry.hours_worked))} className="mt-1 text-xs text-primary-600 hover:text-primary-700">
                Use {lastEntry.hours_worked}h from last entry
              </button>
            )}
          </Field>
        </div>
        {smartHours !== null && !hours && (
          <div>
            <Button type="button" variant="secondary" size="sm" onClick={handleQuickFillHours}>
              Quick-fill {smartHours}h
            </Button>
          </div>
        )}
        <Field label="Work Done" error={fieldError('workDone')}>
          <Autocomplete
            options={recentWork.map(w => w.text)}
            value={workDone}
            onChange={(v) => { clearFieldError('workDone'); setWorkDone(v) }}
            placeholder="What did you work on?"
            inputClassName="text-sm"
            required
          />
        </Field>
        {lastEntry && (
          <Button variant="secondary" size="sm" onClick={handleCopyDown}>
            <IconCopy className="h-3.5 w-3.5" /> Copy from last entry
          </Button>
        )}
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
