// app/dashboard/bulk-edit-modal.tsx
// Modal for bulk-editing selected timesheet entries (project or activity type).
'use client'

import { useEffect, useRef, useState } from 'react'
import { dataClient } from '@/lib/data/client'
import { ActivityType, Project, Timesheet } from '../types'
import { Button, Card, Field, Select } from '@/app/components/ui'
import { Dialog } from '@/app/components/dialog'
import { toast } from '@/app/components/toast'
import ProjectPicker from './project-picker'
import ClassificationFields, { classificationFromEntry, classificationInput, emptyClassification, validateWebEntry, type ClassificationDraft } from './classification-fields'

type BulkEditPayload = Parameters<typeof dataClient.bulkUpdateTimesheets>[0]
type BulkEditResult = Awaited<ReturnType<typeof dataClient.bulkUpdateTimesheets>>

/** Stored format selects each row's payload; v2 changes never reclassify legacy rows. */
export function buildBulkEditPayload(entries: Timesheet[], legacy: { projectId: string; activityTypeId: string }, classification: ClassificationDraft | null): BulkEditPayload {
  return entries.map(entry => ({
    id: entry.id,
    ...(entry.entry_type ? classificationInput(classification ?? classificationFromEntry(entry)) : {
      projectId: legacy.projectId || entry.project_id,
      activityTypeId: legacy.activityTypeId || entry.activity_type_id,
    }),
    hoursWorked: entry.hours_worked, workDone: entry.work_done, logDate: entry.log_date,
  }))
}

/** A captured batch owns its locks through write and reconciliation, even when
 * its dialog unmounts. Session checks prevent follow-up reads in a new session.
 */
export async function runBulkEditMutation(payload: BulkEditPayload, lifecycle: {
  start: () => boolean
  release: () => void
  isSessionCurrent: () => boolean
  write: (snapshot: BulkEditPayload) => Promise<BulkEditResult>
  reconcile: () => Promise<boolean>
}): Promise<(BulkEditResult & { refreshed: boolean }) | null> {
  const snapshot = payload.map(entry => ({ ...entry }))
  if (!lifecycle.isSessionCurrent() || !lifecycle.start()) return null
  try {
    let result: BulkEditResult
    try { result = await lifecycle.write(snapshot) }
    catch { result = { error: 'Could not confirm the bulk edit. Refresh before retrying.' } }
    let refreshed = false
    if (lifecycle.isSessionCurrent()) {
      try { refreshed = await lifecycle.reconcile() }
      catch { /* The batch still releases every lock after failed reconciliation. */ }
    }
    return { ...result, refreshed }
  } finally { lifecycle.release() }
}

export default function BulkEditModal({
  entries,
  projects,
  activityTypes,
  onClose,
  onMutationStart,
  onMutationEnd,
  onReconcile,
  isSessionCurrent,
}: {
  entries: Timesheet[]
  projects: Project[]
  activityTypes: ActivityType[]
  onClose: () => void
  onMutationStart: () => boolean
  onMutationEnd: () => void
  onReconcile: () => Promise<boolean>
  isSessionCurrent: () => boolean
}) {
  const [projectId, setProjectId] = useState('')
  const [activityTypeId, setActivityTypeId] = useState('')
  const [classification, setClassification] = useState({ ...emptyClassification })
  const [replaceClassification, setReplaceClassification] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({})
  const [busy, setBusy] = useState(false)
  const submissionLock = useRef(false)
  const generation = useRef(0)
  useEffect(() => () => { generation.current++ }, [])

  const hasLegacy = entries.some(entry => !entry.entry_type)
  const hasNew = entries.some(entry => Boolean(entry.entry_type))
  const hasChanges = (hasLegacy && (projectId || activityTypeId)) || (hasNew && replaceClassification)
  const close = () => { if (!submissionLock.current) onClose() }

  const handleSubmit = async () => {
    if (!hasChanges || submissionLock.current || !isSessionCurrent()) return
    // Build the entire primitive payload before start invalidates selection.
    const payload = buildBulkEditPayload(entries, { projectId, activityTypeId }, replaceClassification ? classification : null)
    for (let index = 0; index < payload.length; index++) {
      const validated = validateWebEntry(payload[index], !entries[index].entry_type)
      if (!validated.input) { setFieldErrors(validated.fieldErrors); return }
      payload[index] = { ...validated.input, id: payload[index].id }
    }
    setFieldErrors({})
    submissionLock.current = true
    setBusy(true)
    const current = generation.current
    try {
      const result = await runBulkEditMutation(payload, {
        start: onMutationStart, release: onMutationEnd, isSessionCurrent,
        write: snapshot => dataClient.bulkUpdateTimesheets(snapshot), reconcile: onReconcile,
      })
      if (current !== generation.current || !isSessionCurrent()) return
      if (!result) toast('Selection is no longer available. Select entries again.', 'error')
      else if (result.error) toast(result.error, 'error')
      else if (result.errors?.length || result.updated !== payload.length) {
        toast(`Updated ${result.updated ?? 0} of ${payload.length} entries. Select entries again before retrying.`, 'error')
      } else toast(`Updated ${payload.length} entr${payload.length === 1 ? 'y' : 'ies'}.`, 'success')
      if (result && !result.refreshed) toast('Could not refresh entries. Refresh before selecting again.', 'error')
    } finally {
      submissionLock.current = false
      if (current === generation.current && isSessionCurrent()) {
        setBusy(false)
        // Every attempted batch discards its captured selection, including failures.
        onClose()
      }
    }
  }

  // Bulk edit triggers a confirmation toast on success and an error toast on
  // failure; the Save button is disabled while there are no changes.

  return (
    <Dialog open onClose={close} ariaLabel="Bulk Edit">
      <Card
        title="Bulk Edit"
        subtitle={`${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} selected`}
        className="w-full max-w-lg"
      >
        <fieldset disabled={busy} className="space-y-4">
          {hasLegacy && <>
            <p className="text-xs text-fg-muted">Historical entries keep their stored Project + Activity Type format.</p>
            <Field label="Project" error={fieldErrors.projectId?.[0]}>
              <ProjectPicker projects={projects} value={projectId} onChange={setProjectId} />
            </Field>
            <Field label="Activity Type" error={fieldErrors.activityTypeId?.[0]}>
              <Select value={activityTypeId} onChange={e => setActivityTypeId(e.target.value)} className="text-sm">
                <option value="">Keep existing</option>
                {activityTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>
            </Field>
          </>}
          {hasNew && <>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={replaceClassification} onChange={e => { setReplaceClassification(e.target.checked); setClassification({ ...emptyClassification }); setFieldErrors({}) }} />
              Change Type / Activity for new-format entries
            </label>
            {replaceClassification && <ClassificationFields projects={projects} value={classification} onChange={value => { setClassification(value); setFieldErrors({}) }} fieldErrors={fieldErrors} idPrefix="bulk" />}
          </>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={close} disabled={busy}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={busy || !hasChanges}>
              {busy ? 'Saving…' : `Save changes`}
            </Button>
          </div>
        </fieldset>
      </Card>
    </Dialog>
  )
}
