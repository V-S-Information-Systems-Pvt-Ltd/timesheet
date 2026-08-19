// app/dashboard/bulk-edit-modal.tsx
// Modal for bulk-editing selected timesheet entries (project or activity type).
'use client'

import { useEffect, useMemo, useState } from 'react'
import { updateTimesheet } from '../actions'
import { ActivityType, Project, Timesheet } from '../types'
import { Button, Card, Field, Select } from '@/app/components/ui'
import { toast } from '@/app/components/toast'
import ProjectPicker from './project-picker'

export default function BulkEditModal({
  entries,
  projects,
  activityTypes,
  onClose,
  onDone,
}: {
  entries: Timesheet[]
  projects: Project[]
  activityTypes: ActivityType[]
  onClose: () => void
  onDone: () => void
}) {
  const [projectId, setProjectId] = useState('')
  const [activityTypeId, setActivityTypeId] = useState('')
  const [busy, setBusy] = useState(false)

  const uniqueProjects = useMemo(() => {
    const ids = new Set(entries.map(e => e.project_id))
    return projects.filter(p => ids.has(p.id))
  }, [entries, projects])

  const uniqueTypes = useMemo(() => {
    const ids = new Set(entries.map(e => e.activity_type_id).filter(Boolean) as string[])
    return activityTypes.filter(t => ids.has(t.id))
  }, [entries, activityTypes])

  const hasChanges = projectId || activityTypeId

  const handleSubmit = async () => {
    if (!hasChanges) return
    setBusy(true)
    let lastError: string | null = null
    for (const entry of entries) {
      const { error } = await updateTimesheet(entry.id, {
        projectId: projectId || entry.project_id,
        activityTypeId: (activityTypeId || entry.activity_type_id) ?? '',
        hoursWorked: entry.hours_worked,
        workDone: entry.work_done,
        logDate: entry.log_date,
      })
      if (error) lastError = error
    }
    setBusy(false)
    if (lastError) toast(lastError, 'error')
    else {
      toast(`Updated ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}.`, 'success')
      onDone()
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <Card
        title="Bulk Edit"
        subtitle={`${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} selected`}
        className="w-full max-w-lg"
        actions={
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
        }
      >
        <div className="space-y-4">
          <Field label="Project">
            <ProjectPicker projects={uniqueProjects} value={projectId} onChange={setProjectId} />
          </Field>
          <Field label="Activity Type">
            <Select value={activityTypeId} onChange={(e) => setActivityTypeId(e.target.value)} required className="text-sm">
              <option value="">Keep existing</option>
              {uniqueTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={busy || !hasChanges}>
              {busy ? 'Saving…' : `Save changes`}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  )
}
