// app/dashboard/time-entry-form.tsx
'use client'

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { dataClient } from '@/lib/data/client'
import { getRecentWorkDetailed, saveRecentWorkDetailed, type CachedWorkEntry } from '@/lib/cache'
import { computeSmartHours, timesheetToLogEntry } from '@vsis/core'
import { todayISO } from '@/lib/dates'
import { buildBotCommand } from '@/lib/telegram'
import { copyText } from '@/lib/clipboard'
import { createTemporaryTimesheetId } from '@/lib/optimistic-timesheets'
import { ActivityType, OptimisticTimesheet, Project, Timesheet } from '../types'
import { Button, Card, Checkbox, Field, Input, Autocomplete } from '@/app/components/ui'
import { toast } from '@/app/components/toast'
import { IconClock, IconCopy } from '@/app/components/icons'
import ClassificationFields, { classificationFromEntry, classificationInput, emptyClassification, validateWebEntry } from './classification-fields'

const subscribeToCalendar = () => () => {}
const serverCalendarSnapshot = () => ''

/** SSR and hydration share an unknown calendar; local dates activate afterwards. */
export function useBrowserToday() {
  return useSyncExternalStore(subscribeToCalendar, todayISO, serverCalendarSnapshot)
}

interface TimeEntryFormProps {
  today: string
  projects: Project[]
  activityTypes: ActivityType[]
  minLogDate: string
  onLogged: (entry?: OptimisticTimesheet) => void
  collapsible?: boolean
  initialDraft?: Timesheet
}

export default function TimeEntryForm(props: TimeEntryFormProps) {
  if (!props.today) return (
    <Card title="Log Time" icon={<IconClock className="h-4.5 w-4.5" />} collapsible={props.collapsible}>
      <p role="status" className="text-sm text-fg-muted">Preparing local calendar…</p>
    </Card>
  )
  return <LocalTimeEntryForm {...props} />
}

function LocalTimeEntryForm({
  projects,
  minLogDate,
  onLogged,
  collapsible = false,
  today,
  initialDraft,
}: TimeEntryFormProps) {
  const [classification, setClassification] = useState(() => initialDraft ? classificationFromEntry(initialDraft) : { ...emptyClassification })
  const [hours, setHours] = useState(initialDraft ? String(initialDraft.hours_worked) : '')
  const [workDone, setWorkDone] = useState(initialDraft?.work_done ?? '')
  // Local calendar date (not UTC): in timezones ahead of UTC the UTC date
  // is still "yesterday" during the early-morning hours.
  const [logDate, setLogDate] = useState(initialDraft?.log_date ?? today)
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
    const { data, error } = await dataClient.getTimesheets({ limit: 10, includeCount: false }, { deduplicate: false })
    if (!error && data) setRecentEntries(data)
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshRecentEntries()
  }, [refreshRecentEntries])

  const handleLogEntry = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    const validated = validateWebEntry({ ...classificationInput(classification), ...(initialDraft ? { userId: initialDraft.user_id } : {}), hoursWorked: parseFloat(hours), workDone, logDate })
    setFieldErrors(validated.fieldErrors)
    if (!validated.input) return
    const input = validated.input
    setBusy(true)
    try {
      const { error, fieldErrors: errors } = await dataClient.createTimesheet(input)
      setFieldErrors(errors ?? {})
      if (error) toast(error, 'error')
      else {
        setHours(''); setWorkDone('')
        setRecentWork(saveRecentWorkDetailed({ text: workDone, project: projects.find(p => p.id === input.projectId)?.name, date: logDate, entryType: input.entryType, activityCode: input.activityCode, projectId: input.projectId, ticketNumber: input.ticketNumber, activityOther: input.activityOther }))
        const optimistic: OptimisticTimesheet = {
          tempId: createTemporaryTimesheetId(),
          user_id: '',
          project_id: input.projectId ?? null,
          activity_type_id: null,
          entry_type: input.entryType, activity_code: input.activityCode,
          ticket_number: input.ticketNumber, activity_other: input.activityOther,
          log_date: logDate,
          hours_worked: parseFloat(hours),
          work_done: workDone,
          created_at: new Date().toISOString(),
        }
        onLogged(optimistic)
        refreshRecentEntries()
        toast('Time logged successfully!', 'success')
        if (copyCommand) {
          const project = projects.find(p => p.id === input.projectId)
          const { command } = buildBotCommand(
            { log_date: logDate, hours_worked: parseFloat(hours), work_done: workDone },
            project,
            undefined
          )
          if (command) {
            const ok = await copyText(command)
            if (ok) toast('Telegram command copied.', 'success')
          }
        }
      }
    } catch {
      toast('Could not confirm the submission. Refresh entries before retrying.', 'error')
    } finally {
      setBusy(false)
    }
  }

  const handleCopyDown = () => {
    if (!lastEntry) return
    setClassification(classificationFromEntry(lastEntry))
    setFieldErrors({})
    setHours('')
    setWorkDone(lastEntry.work_done)
    toast(lastEntry.entry_type ? 'Copied details from your last entry.' : 'Copied work description. Select Type and Activity for this new entry.', 'info')
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
        <ClassificationFields projects={projects} value={classification} fieldErrors={fieldErrors} idPrefix={initialDraft ? 'copied-entry' : 'classification'} onChange={value => { setClassification(value); setFieldErrors(prev => Object.fromEntries(Object.entries(prev).filter(([key]) => !['entryType', 'projectId', 'activityCode', 'ticketNumber', 'activityOther'].includes(key)))) }} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date" error={fieldError('logDate')}>
            <Input
              type="date"
              min={minLogDate}
              max={today}
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
              <button type="button" onClick={() => setHours(String(lastEntry.hours_worked))} className="mt-1 text-xs text-primary-600 hover:text-primary-700 dark:text-primary-200 dark:hover:text-primary-200">
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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Checkbox
            label="Copy Telegram command"
            checked={copyCommand}
            onChange={(e) => setCopyCommand(e.target.checked)}
          />
          <Button type="submit" className="py-2.5" disabled={busy}>{busy ? 'Submitting…' : 'Submit Entry'}</Button>
        </div>
      </form>
    </Card>
  )
}
