// app/dashboard/entries-table.tsx
'use client'

import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { deleteLastEntry, deleteTimesheet, duplicateEntry, updateTimesheet } from '../actions'
import { todayISO, addDaysISO } from '@/lib/dates'
import { isFormField } from '@/lib/shortcuts'
import { ActivityType, Project, Timesheet, User } from '../types'
import { Badge, Button, Card, EmptyState, Field, Input, Select, Td, Th } from '@/app/components/ui'
import { toast } from '@/app/components/toast'
import { IconCalendar, IconCheck, IconClock, IconCopy, IconDocument, IconPencil, IconTrash } from '@/app/components/icons'
import { copyText } from '@/lib/clipboard'
import { buildBotCommand } from '@/lib/telegram'
import ProjectPicker from './project-picker'

export default function EntriesTable({
  timesheets,
  projects,
  activityTypes,
  users = [],
  userId,
  isAdmin,
  canFilterByUser,
  minLogDate,
  onChanged,
}: {
  timesheets: Timesheet[]
  projects: Project[]
  activityTypes: ActivityType[]
  /** Profiles the current user may inspect (for the admin/manager filter). */
  users?: User[]
  userId?: string
  isAdmin: boolean
  /** Shows the "User" filter (admins, COs, managers, team leads). */
  canFilterByUser: boolean
  minLogDate: string
  onChanged: () => void
}) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editProjectId, setEditProjectId] = useState('')
  const [editActivityTypeId, setEditActivityTypeId] = useState('')
  const [editHours, setEditHours] = useState('')
  const [editWorkDone, setEditWorkDone] = useState('')
  const [editLogDate, setEditLogDate] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [userFilter, setUserFilter] = useState('')
  // Guards the D shortcut (and any future bulk-duplicate call) against OS
  // key-repeat bursts firing concurrent server duplicates.
  const duplicateBusyRef = useRef(false)

  const projectById = useMemo(() => new Map(projects.map(p => [p.id, p])), [projects])
  const typeById = useMemo(() => new Map(activityTypes.map(t => [t.id, t])), [activityTypes])

  // Admin/CO/manager/team-lead rows filtered by the selected user.
  const rows = useMemo(
    () => (userFilter ? timesheets.filter(t => t.user_id === userFilter) : timesheets),
    [timesheets, userFilter]
  )

  const allSelected = rows.length > 0 && rows.every(t => selectedIds.has(t.id))
  const someSelected = selectedIds.size > 0

  const today = todayISO()
  const yesterday = addDaysISO(today, -1)

  const groupedRows = useMemo(() => {
    const groups: { date: string; label: string; entries: Timesheet[] }[] = []
    for (const t of rows) {
      const existing = groups.find(g => g.date === t.log_date)
      if (existing) {
        existing.entries.push(t)
      } else {
        const label = t.log_date === today ? 'Today' : t.log_date === yesterday ? 'Yesterday' : t.log_date
        groups.push({ date: t.log_date, label, entries: [t] })
      }
    }
    return groups
  }, [rows, today, yesterday])

  const todayGroupExists = groupedRows.some(g => g.date === today)

  const handleJumpToToday = () => {
    const el = document.getElementById('date-group-today')
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }

  const toggleSelectAll = () => {
    setSelectedIds(allSelected ? new Set() : new Set(rows.map(t => t.id)))
  }

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const clearSelection = () => setSelectedIds(new Set())

  const handleUserFilterChange = (value: string) => {
    setUserFilter(value)
    setSelectedIds(new Set())
  }

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

  const handleDuplicateEntry = async (t: Timesheet) => {
    const { error } = await duplicateEntry(t.id)
    if (error) toast(error, 'error')
    else {
      onChanged()
      toast('Entry duplicated.', 'success')
    }
  }

  const handleCopyCommands = async () => {
    const picked = rows.filter(t => selectedIds.has(t.id))
    const commands: string[] = []
    let skipped = 0
    for (const t of picked) {
      const project = projectById.get(t.project_id)
      const activityType = t.activity_type_id ? typeById.get(t.activity_type_id) : undefined
      const { command } = buildBotCommand(t, project, activityType)
      if (command) commands.push(command)
      else skipped++
    }
    if (commands.length === 0) {
      toast('None of the selected entries have a bot number configured.', 'info')
      return
    }
    const ok = await copyText(commands.join('\n'))
    if (ok) {
      toast(
        `Copied ${commands.length} command${commands.length === 1 ? '' : 's'}${skipped ? ` (${skipped} skipped — no bot number)` : ''}.`,
        'success'
      )
      clearSelection()
    } else {
      toast('Could not copy to clipboard.', 'error')
    }
  }

  const handleDuplicateSelected = async () => {
    if (!someSelected || duplicateBusyRef.current) return
    const picked = rows.filter(t => selectedIds.has(t.id))
    if (picked.length === 0) return
    duplicateBusyRef.current = true
    try {
      for (const t of picked) {
        const { error } = await duplicateEntry(t.id)
        if (error) {
          toast(error, 'error')
          return
        }
      }
      onChanged()
      clearSelection()
      toast(`Duplicated ${picked.length} entr${picked.length === 1 ? 'y' : 'ies'}.`, 'success')
    } finally {
      duplicateBusyRef.current = false
    }
  }

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.altKey || e.ctrlKey) return
      if (e.key.toLowerCase() === 'd' && someSelected && !isFormField(document.activeElement)) {
        e.preventDefault()
        handleDuplicateSelected()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [someSelected, selectedIds, rows])

  return (
    <Card
      title={canFilterByUser ? 'Recent Entries' : 'My Recent Entries'}
      subtitle={
        canFilterByUser && userFilter
          ? `${rows.length} entr${rows.length === 1 ? 'y' : 'ies'} · ${
              users.find(u => u.id === userFilter)?.name || 'selected user'
            }`
          : `${timesheets.length} entr${timesheets.length === 1 ? 'y' : 'ies'}`
      }
      icon={<IconDocument className="h-4.5 w-4.5" />}
      className="md:col-span-2"
       bodyClassName="p-0"
       actions={
         <>
           {timesheets.length > 0 && (
             <Button variant="ghost" size="sm" onClick={handleJumpToToday} disabled={!todayGroupExists} title="Jump to today">
               <IconCalendar className="h-3.5 w-3.5" /> Today
             </Button>
           )}
           <Button variant="ghost" size="sm" onClick={handleEditLast} data-shortcut="edit-last">
             <IconPencil className="h-3.5 w-3.5" /> Edit Last
           </Button>
           <Button variant="ghost" size="sm" onClick={handleUndoLast} className="text-rose-600 hover:bg-rose-50 hover:text-rose-700" data-shortcut="undo-last">
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
        <div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-2.5">
            <span className="text-xs text-slate-500">
              {someSelected
                ? `${selectedIds.size} selected`
                : 'Select entries to copy their Telegram bot commands'}
            </span>
            <div className="flex flex-wrap items-center gap-2">
              {canFilterByUser && users.length > 0 && (
                <Select
                  value={userFilter}
                  onChange={e => handleUserFilterChange(e.target.value)}
                  aria-label="Filter by user"
                  className="w-44 text-xs"
                >
                  <option value="">All users</option>
                  {users.map(u => (
                    <option key={u.id} value={u.id}>{u.name || u.email}</option>
                  ))}
                </Select>
              )}
              {someSelected && (
                <Button variant="ghost" size="sm" onClick={clearSelection}>
                  Clear
                </Button>
              )}
              <Button size="sm" variant="secondary" disabled={!someSelected} onClick={handleCopyCommands}>
                <IconCopy className="h-3.5 w-3.5" /> Copy Commands
              </Button>
            </div>
          </div>
          <div className="max-h-96 overflow-y-auto">
           <table className="w-full text-sm">
             <thead className="sticky top-0 whitespace-nowrap border-b border-slate-100 bg-slate-50/90 backdrop-blur supports-[backdrop-filter]:bg-slate-50/60">
              <tr>
                <Th className="w-8">
                  <input
                    type="checkbox"
                    aria-label="Select all entries"
                    checked={allSelected}
                    ref={el => { if (el) el.indeterminate = someSelected && !allSelected }}
                    onChange={toggleSelectAll}
                    className="h-3.5 w-3.5 accent-primary-600"
                  />
                </Th>
                <Th>Date</Th>
                <Th>Project</Th>
                <Th>Type</Th>
                <Th className="text-right">Hrs</Th>
                <Th>Work Done</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {groupedRows.map(group => (
                <Fragment key={group.date}>
                  <tr
                    key={`group-${group.date}`}
                    id={group.date === today ? 'date-group-today' : undefined}
                    className="sticky top-[38px] z-5 bg-slate-100/90 backdrop-blur supports-[backdrop-filter]:bg-slate-100/80"
                  >
                    <td colSpan={7} className="px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {group.label}
                    </td>
                  </tr>
                  {group.entries.map(t => {
                    // Admins can edit anything; users edit only their own entries
                    // that are still inside the backfill window.
                    const canEdit = (isAdmin || t.user_id === userId) && (isAdmin || t.log_date >= minLogDate)
                    if (editingId === t.id) {
                      return (
                        <tr key={t.id} className="bg-primary-50/60">
                          <td colSpan={7} className="p-3">
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
                      <tr key={t.id} className="transition-colors hover:bg-slate-50/70" data-row-id={t.id}>
                        <Td className="w-8">
                          <input
                            type="checkbox"
                            aria-label={`Select entry from ${t.log_date}`}
                            checked={selectedIds.has(t.id)}
                            onChange={() => toggleSelect(t.id)}
                            className="h-3.5 w-3.5 accent-primary-600"
                          />
                        </Td>
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
                              <Button variant="ghost" size="sm" onClick={() => handleDuplicateEntry(t)} className="px-2 text-slate-500 hover:bg-slate-100" title="Duplicate entry (select a row + press D)">
                                <IconCopy className="h-3.5 w-3.5" />
                                <span className="sr-only">Duplicate</span>
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
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        </div>
      )}
    </Card>
  )
}
