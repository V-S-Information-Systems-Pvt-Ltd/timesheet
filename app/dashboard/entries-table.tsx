// app/dashboard/entries-table.tsx
'use client'

import { useState } from 'react'
import { deleteLastEntry, deleteTimesheet, updateTimesheet } from '../actions'
import { ActivityType, Project, Timesheet } from '../types'
import { Badge, Button, Card, EmptyState, Field, Input, Select, Td, Th} from '@/app/components/ui'
import { toast } from '@/app/components/toast'
import { IconCheck, IconClock, IconDocument, IconPencil, IconTrash } from '@/app/components/icons'
import ProjectPicker from './project-picker'

export default function EntriesTable({
  timesheets,
  projects,
  activityTypes,
  userId,
  isAdmin,
  minLogDate,
  onChanged,
}: {
  timesheets: Timesheet[]
  projects: Project[]
  activityTypes: ActivityType[]
  userId?: string
  isAdmin: boolean
  minLogDate: string
  onChanged: () => void
}) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editProjectId, setEditProjectId] = useState('')
  const [editActivityTypeId, setEditActivityTypeId] = useState('')
  const [editHours, setEditHours] = useState('')
  const [editWorkDone, setEditWorkDone] = useState('')
  const [editLogDate, setEditLogDate] = useState('')

  const startEdit = (t: Timesheet) => {
    setEditingId(t.id)
    setEditProjectId(t.project_id)
    setEditActivityTypeId(t.activity_type_id ?? '')
    setEditHours(String(t.hours_worked))
    setEditWorkDone(t.work_done)
    setEditLogDate(t.log_date)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditProjectId('')
    setEditActivityTypeId('')
    setEditHours('')
    setEditWorkDone('')
    setEditLogDate('')
  }

  const handleUpdateEntry = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingId) return
    const { error } = await updateTimesheet(editingId, {
      projectId: editProjectId,
      activityTypeId: editActivityTypeId,
      hoursWorked: parseFloat(editHours),
      workDone: editWorkDone,
      logDate: editLogDate,
    })
    if (error) toast(error, 'error')
    else {
      cancelEdit()
      onChanged()
      toast('Entry updated successfully!', 'success')
    }
  }

  const handleDeleteEntry = async (entryId: string) => {
    if (!confirm('Are you sure you want to delete this entry?')) return
    const { error } = await deleteTimesheet(entryId)
    if (error) toast(error, 'error')
    else {
      if (editingId === entryId) cancelEdit()
      onChanged()
      toast('Entry deleted.', 'success')
    }
  }

  const handleUndoLast = async () => {
    if (!confirm('Delete your most recent entry?')) return
    const { error } = await deleteLastEntry()
    if (error) toast(error, 'error')
    else {
      onChanged()
      toast('Most recent entry deleted.', 'success')
    }
  }

  const handleEditLast = () => {
    if (timesheets.length === 0) return toast('No entries to edit.', 'info')
    startEdit(timesheets[0])
  }

  return (
    <Card
      title="My Recent Entries"
      subtitle={`${timesheets.length} entr${timesheets.length === 1 ? 'y' : 'ies'}`}
      icon={<IconDocument className="h-4.5 w-4.5" />}
      className="md:col-span-2"
      bodyClassName="p-0"
      actions={
        <>
          <Button variant="ghost" size="sm" onClick={handleEditLast}>
            <IconPencil className="h-3.5 w-3.5" /> Edit Last
          </Button>
          <Button variant="ghost" size="sm" onClick={handleUndoLast} className="text-rose-600 hover:bg-rose-50 hover:text-rose-700">
            <IconTrash className="h-3.5 w-3.5" /> Undo Last
          </Button>
        </>
      }
    >
      {timesheets.length === 0 ? (
        <EmptyState
          className="m-5"
          icon={<IconClock className="h-5 w-5" />}
          title="No entries yet"
          description="Log your first entry using the form on the left."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-100 bg-slate-50/60">
              <tr>
                <Th>Date</Th>
                <Th>Project</Th>
                <Th>Type</Th>
                <Th className="text-right">Hrs</Th>
                <Th>Work Done</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {timesheets.map(t => {
                // Admins can edit anything; users edit only their own entries
                // that are still inside the backfill window.
                const canEdit = (isAdmin || t.user_id === userId) && (isAdmin || t.log_date >= minLogDate)
                if (editingId === t.id) {
                  return (
                    <tr key={t.id} className="bg-primary-50/60">
                      <td colSpan={6} className="p-3">
                        <form onSubmit={handleUpdateEntry} className="flex flex-wrap items-end gap-2">
                          <Field label="Date" className="w-36">
                            <Input type="date" value={editLogDate} onChange={(e) => setEditLogDate(e.target.value)} required className="text-xs" />
                          </Field>
                          <Field label="Project" className="w-56">
                            <ProjectPicker
                              projects={projects}
                              value={editProjectId}
                              onChange={setEditProjectId}
                              required
                            />
                          </Field>
                          <Field label="Type" className="w-40">
                            <Select value={editActivityTypeId} onChange={(e) => setEditActivityTypeId(e.target.value)} required className="text-xs">
                              <option value="">Select Type…</option>
                              {activityTypes.map(at => <option key={at.id} value={at.id}>{at.name}</option>)}
                            </Select>
                          </Field>
                          <Field label="Hours" className="w-20">
                            <Input type="number" step="0.25" min="0" value={editHours} onChange={(e) => setEditHours(e.target.value)} required className="text-xs" />
                          </Field>
                          <Field label="Work Done" className="min-w-40 flex-1">
                            <Input type="text" value={editWorkDone} onChange={(e) => setEditWorkDone(e.target.value)} required placeholder="Work Done" className="text-xs" />
                          </Field>
                          <Button type="submit" size="sm">
                            <IconCheck className="h-3.5 w-3.5" /> Save
                          </Button>
                          <Button type="button" variant="secondary" size="sm" onClick={cancelEdit}>
                            Cancel
                          </Button>
                        </form>
                      </td>
                    </tr>
                  )
                }
                return (
                  <tr key={t.id} className="transition-colors hover:bg-slate-50/70">
                    <Td className="whitespace-nowrap tabular-nums">{t.log_date}</Td>
                    <Td className="font-medium text-slate-800">{t.projects?.name}</Td>
                    <Td className="text-slate-500">{t.activity_types?.name || '—'}</Td>
                    <Td className="text-right tabular-nums">{t.hours_worked}</Td>
                    <Td className="max-w-xs truncate text-slate-500">{t.work_done}</Td>
                    <Td className="text-right">
                      {canEdit ? (
                        <div className="inline-flex items-center gap-1">
                          <Button variant="ghost" size="sm" onClick={() => startEdit(t)} className="px-2 text-primary-600 hover:bg-primary-50">
                            <IconPencil className="h-3.5 w-3.5" />
                            <span className="sr-only">Edit</span>
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => handleDeleteEntry(t.id)} className="px-2 text-rose-600 hover:bg-rose-50">
                            <IconTrash className="h-3.5 w-3.5" />
                            <span className="sr-only">Delete</span>
                          </Button>
                        </div>
                      ) : (
                        <Badge tone="slate">View only</Badge>
                      )}
                    </Td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}
