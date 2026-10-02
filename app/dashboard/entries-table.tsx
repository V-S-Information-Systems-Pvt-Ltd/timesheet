// app/dashboard/entries-table.tsx
'use client'

import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { deleteLastEntry, deleteTimesheet, duplicateEntry, updateTimesheet } from '../actions'
import { todayISO, addDaysISO } from '@/lib/dates'
import { isFormField } from '@/lib/shortcuts'
import { createTemporaryTimesheetId, isTemporaryTimesheetId } from '@/lib/optimistic-timesheets'
import { ActivityType, Project, Timesheet, User } from '../types'
import { Badge, Button, Card, EmptyState, Field, Input, Select, Spinner, Td, Th } from '@/app/components/ui'
import { ConfirmDialog, PromptDialog } from '@/app/components/confirm'
import { toast } from '@/app/components/toast'
import { IconCalendar, IconCheck, IconClock, IconCopy, IconDocument, IconMoreHorizontal, IconPencil, IconTrash } from '@/app/components/icons'
import { copyText } from '@/lib/clipboard'
import { buildBotCommand } from '@/lib/telegram'
import ProjectPicker from './project-picker'
import BulkEditModal from './bulk-edit-modal'

export default function EntriesTable({
  timesheets,
  projects,
  activityTypes,
  users = [],
  userId,
  initialUserId,
  isAdmin,
  canFilterByUser,
  minLogDate,
  onChanged,
  onOptimisticInsert,
  onOptimisticUpdate,
  onOptimisticRemove,
  onOptimisticSettled,
  mutationLocks,
  busyIds,
  onBusyChange,
  collapsible = false,
}: {
  timesheets: Timesheet[]
  projects: Project[]
  activityTypes: ActivityType[]
  /** Profiles the current user may inspect (for the admin/manager filter). */
  users?: User[]
  userId?: string
  initialUserId?: string
  isAdmin: boolean
  /** Shows the "User" filter (admins, COs, managers, team leads). */
  canFilterByUser: boolean
  minLogDate: string
  /** Reconcile against the server. Returns false when the refetch failed or was
   * superseded, so optimistic handlers know whether to roll back. */
  onChanged: () => void | Promise<boolean>
  /** Optimistic list mutators (owned by the parent). When omitted, handlers
   * still work — they just wait for the refetch instead of updating instantly. */
  onOptimisticInsert?: (entry: Timesheet) => void
  onOptimisticUpdate?: (id: string, patch: Partial<Timesheet>) => void
  onOptimisticRemove?: (id: string) => void
  onOptimisticSettled?: (id: string, committed?: boolean) => void
  mutationLocks?: Set<string>
  busyIds?: ReadonlySet<string>
  onBusyChange?: (id: string, busy: boolean) => void
  collapsible?: boolean
}) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editProjectId, setEditProjectId] = useState('')
  const [editActivityTypeId, setEditActivityTypeId] = useState('')
  const [editHours, setEditHours] = useState('')
  const [editWorkDone, setEditWorkDone] = useState('')
  const [editLogDate, setEditLogDate] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [userFilter, setUserFilter] = useState(initialUserId || '')
  const [prevInitialUserId, setPrevInitialUserId] = useState(initialUserId)
  if (initialUserId !== prevInitialUserId) {
    setPrevInitialUserId(initialUserId)
    setUserFilter(initialUserId || '')
  }
  const [mobileMenu, setMobileMenu] = useState<{ id: string; left: number; top: number } | null>(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [bulkEditOpen, setBulkEditOpen] = useState(false)
  // Styled confirmation for destructive actions (replaces window.confirm).
  const [confirmState, setConfirmState] = useState<{
    title: string
    message: string
    action: () => Promise<void>
  } | null>(null)
  // Guards the D shortcut (and any future bulk-duplicate call) against OS
  // key-repeat bursts firing concurrent server duplicates.
  const duplicateBusyRef = useRef(false)
  const deleteBusyRef = useRef(false)
  // Prefer dashboard-owned locks so pending writes survive a table remount.
  // The mutable set guards synchronously; the immutable copy drives rendering.
  const [localRowLocks] = useState(() => new Set<string>())
  const [localBusyIds, setLocalBusyIds] = useState<Set<string>>(new Set())
  const rowLocks = mutationLocks ?? localRowLocks
  const rowBusyIds = busyIds ?? localBusyIds
  const setRowBusy = (id: string, busy: boolean) => {
    if (onBusyChange) onBusyChange(id, busy)
    else {
      if (busy) rowLocks.add(id)
      else rowLocks.delete(id)
      setLocalBusyIds(new Set(rowLocks))
    }
  }
  const editGenerationRef = useRef(0)
  // Row whose "Duplicate to date…" dialog is open (null = closed).
  const [duplicateDateTarget, setDuplicateDateTarget] = useState<Timesheet | null>(null)

  const projectById = useMemo(() => new Map(projects.map(p => [p.id, p])), [projects])
  const typeById = useMemo(() => new Map(activityTypes.map(t => [t.id, t])), [activityTypes])

  // Admin/CO/manager/team-lead rows filtered by the selected user.
  const rows = useMemo(
    () => (userFilter ? timesheets.filter(t => t.user_id === userFilter) : timesheets),
    [timesheets, userFilter]
  )

  const selectableRows = rows.filter(t => !isTemporaryTimesheetId(t.id))
  const allSelected = selectableRows.length > 0 && selectableRows.every(t => selectedIds.has(t.id))
  const someSelected = selectedIds.size > 0

  const today = todayISO()
  const yesterday = addDaysISO(today, -1)

  const canDuplicateRow = (t: Timesheet) =>
    !isTemporaryTimesheetId(t.id) && (isAdmin || t.user_id === userId)
  const canModifyRow = (t: Timesheet) =>
    canDuplicateRow(t) && (isAdmin || (t.log_date >= minLogDate && t.log_date <= today))

  const refreshEntries = async () => {
    try {
      return (await onChanged()) !== false
    } catch {
      toast('Could not refresh entries. Please refresh before retrying.', 'error')
      return false
    }
  }

  const selectedRows = rows.filter(t => selectedIds.has(t.id))
  const allSelectedModifiable = selectedRows.length > 0 && selectedRows.every(t => canModifyRow(t) && !rowBusyIds.has(t.id))

  // Deep-linkable table state: hydrate once after mount from the query string
  // (post-hydration, so SSR output stays stable) and keep it in sync via
  // history.replaceState — no router navigation or re-fetch churn.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search)
    const user = sp.get('user') ?? ''
    const size = Number(sp.get('size'))
    const page = Number(sp.get('page')) || 1
    // Deliberate one-time sync from URL state (same pattern as the shell's
    // drawer-close-on-navigate effect).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (user) setUserFilter(user)
    if (size === 25 || size === 50 || size === 100) setPageSize(size)
    if (page > 1) setPage(page)
  }, [])

  const syncUrl = (user: string, nextPage: number, size: number) => {
    if (typeof window === 'undefined') return
    const sp = new URLSearchParams()
    if (user) sp.set('user', user)
    if (nextPage > 1) sp.set('page', String(nextPage))
    if (size !== 50) sp.set('size', String(size))
    const qs = sp.toString()
    window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname)
  }

  const pageStart = (page - 1) * pageSize
  const pageEnd = pageStart + pageSize
  const pageRows = useMemo(() => rows.slice(pageStart, pageEnd), [rows, pageStart, pageEnd])
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize))

  // If the dataset shrinks (delete/filter/re-fetch) while the user is on a
  // high page, clamp back to the last valid page during render (React 19
  // pattern, avoids a setState-in-effect) so the table never renders blank.
  if (page > totalPages) setPage(totalPages)

  const groupedRows = useMemo(() => {
    const groups: { date: string; label: string; entries: Timesheet[] }[] = []
    for (const t of pageRows) {
      const existing = groups.find(g => g.date === t.log_date)
      if (existing) {
        existing.entries.push(t)
      } else {
        const label = t.log_date === today ? 'Today' : t.log_date === yesterday ? 'Yesterday' : t.log_date
        groups.push({ date: t.log_date, label, entries: [t] })
      }
    }
    return groups
  }, [pageRows, today, yesterday])

  const todayGroupExists = groupedRows.some(g => g.date === today)

  const handleJumpToToday = () => {
    const el = document.getElementById('date-group-today')
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }

  const toggleSelectAll = () => {
    setSelectedIds(allSelected ? new Set() : new Set(selectableRows.map(t => t.id)))
  }

  const goToPage = (p: number) => {
    const clamped = Math.max(1, Math.min(p, totalPages))
    setPage(clamped)
    syncUrl(userFilter, clamped, pageSize)
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
    setPage(1)
    syncUrl(value, 1, pageSize)
  }

  const startEdit = (t: Timesheet) => {
    if (!canModifyRow(t) || rowLocks.has(t.id)) return
    editGenerationRef.current++
    setEditingId(t.id)
    setEditProjectId(t.project_id)
    setEditActivityTypeId(t.activity_type_id ?? '')
    setEditHours(String(t.hours_worked))
    setEditWorkDone(t.work_done)
    setEditLogDate(t.log_date)
  }

  const cancelEdit = () => {
    editGenerationRef.current++
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
    const id = editingId
    // Snapshot the pre-edit row so a server rejection can roll back in place.
    const prev = rows.find(t => t.id === id)
    if (!prev || !canModifyRow(prev) || rowLocks.has(id)) return
    setRowBusy(id, true)
    const projectId = editProjectId
    const activityTypeId = editActivityTypeId
    const hours = editHours
    const hoursWorked = parseFloat(hours)
    const workDone = editWorkDone
    const logDate = editLogDate
    cancelEdit()
    const generation = editGenerationRef.current
    const restoreDraft = () => {
      // Never replace a different editor the user opened while this was pending.
      if (editGenerationRef.current !== generation) return
      setEditingId(id)
      setEditProjectId(projectId)
      setEditActivityTypeId(activityTypeId)
      setEditHours(hours)
      setEditWorkDone(workDone)
      setEditLogDate(logDate)
    }
    // Optimistically reflect the edit, including the joined names the row renders.
    onOptimisticUpdate?.(id, {
      project_id: projectId,
      activity_type_id: activityTypeId || null,
      hours_worked: hoursWorked,
      work_done: workDone,
      log_date: logDate,
      projects: { name: projectById.get(projectId)?.name ?? '' },
      activity_types: activityTypeId ? { name: typeById.get(activityTypeId)?.name ?? '' } : null,
    })
    try {
      const { error } = await updateTimesheet(id, {
        projectId,
        activityTypeId,
        hoursWorked,
        workDone,
        logDate,
      })
      if (error) {
        onOptimisticUpdate?.(id, prev)
        onOptimisticSettled?.(id)
        restoreDraft()
        toast(error, 'error')
      } else {
        onOptimisticSettled?.(id, true)
        await refreshEntries()
        toast('Entry updated successfully!', 'success')
      }
    } catch {
      onOptimisticUpdate?.(id, prev)
      onOptimisticSettled?.(id)
      restoreDraft()
      toast('Could not confirm the update. Please refresh before retrying.', 'error')
      await refreshEntries()
    } finally {
      setRowBusy(id, false)
    }
  }

  const performDeleteEntry = async (entryId: string) => {
    const prev = rows.find(t => t.id === entryId)
    if (!prev || !canModifyRow(prev) || rowLocks.has(entryId)) return
    setRowBusy(entryId, true)
    if (editingId === entryId) cancelEdit()
    // Drop the deleted id from the selection so the sticky bar count
    // stays accurate and the selection never references a dead row.
    setSelectedIds(sel => {
      if (!sel.has(entryId)) return sel
      const next = new Set(sel)
      next.delete(entryId)
      return next
    })
    onOptimisticRemove?.(entryId) // disappear instantly
    try {
      const { error } = await deleteTimesheet(entryId)
      if (error) {
        onOptimisticInsert?.(prev)
        onOptimisticSettled?.(entryId)
        toast(error, 'error')
      } else {
        onOptimisticSettled?.(entryId, true)
        await refreshEntries()
        toast('Entry deleted.', 'success')
      }
    } catch {
      onOptimisticInsert?.(prev)
      onOptimisticSettled?.(entryId)
      toast('Could not confirm the deletion. Please refresh before retrying.', 'error')
      await refreshEntries()
    } finally {
      setRowBusy(entryId, false)
    }
  }

  const handleDeleteEntry = (entryId: string) => {
    setConfirmState({
      title: 'Delete Entry',
      message: 'Are you sure you want to delete this entry? This cannot be undone.',
      action: () => performDeleteEntry(entryId),
    })
  }

  const performUndoLast = async () => {
    if (rowLocks.size > 0) return
    const { error } = await deleteLastEntry()
    if (error) toast(error, 'error')
    else {
      onChanged()
      toast('Most recent entry deleted.', 'success')
    }
  }

  const handleUndoLast = () => {
    if (rowLocks.size > 0) return
    const latest = timesheets.find(t => !isTemporaryTimesheetId(t.id) && t.user_id === userId)
    if (!latest) return toast('No entries to undo.', 'info')
    if (!canModifyRow(latest)) return toast('Your most recent entry is outside the writable backfill window.', 'info')
    setConfirmState({
      title: 'Undo Last Entry',
      message: 'Delete your most recent entry? This cannot be undone.',
      action: performUndoLast,
    })
  }

  const handleEditLast = () => {
    const latest = timesheets.find(t => !isTemporaryTimesheetId(t.id) && !rowLocks.has(t.id) && (isAdmin || t.user_id === userId))
    if (!latest) return toast('No entries to edit.', 'info')
    if (!canModifyRow(latest)) return toast('Your most recent entry is outside the writable backfill window.', 'info')
    startEdit(latest)
  }

  const handleDuplicateEntry = async (t: Timesheet, targetDate?: string) => {
    if (!canDuplicateRow(t) || (targetDate === undefined && !canModifyRow(t)) || rowLocks.has(t.id)) return
    const tempId = createTemporaryTimesheetId()
    const logDate = targetDate?.trim() || t.log_date
    // Optimistic clone carries the joined names the row renders; the real id
    // arrives on reconcile.
    onOptimisticInsert?.({ ...t, id: tempId, log_date: logDate, created_at: new Date().toISOString() })
    setRowBusy(t.id, true)
    try {
      const { error } = await duplicateEntry(t.id, targetDate)
      if (error) {
        onOptimisticRemove?.(tempId)
        onOptimisticSettled?.(tempId)
        toast(error, 'error')
      } else {
        onOptimisticSettled?.(tempId, true)
        if (!(await refreshEntries())) {
          onOptimisticRemove?.(tempId)
          onOptimisticSettled?.(tempId)
        }
        toast('Entry duplicated.', 'success')
      }
    } catch {
      onOptimisticRemove?.(tempId)
      onOptimisticSettled?.(tempId)
      toast('Could not confirm the duplicate. Please refresh before retrying.', 'error')
      await refreshEntries()
    } finally {
      setRowBusy(t.id, false)
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
    if (picked.length === 0 || !picked.every(canModifyRow) || picked.some(t => rowLocks.has(t.id))) return
    const clones = picked.map(t => ({ src: t, tempId: createTemporaryTimesheetId() }))
    duplicateBusyRef.current = true
    for (const t of picked) setRowBusy(t.id, true)
    try {
      // Initialize optimistic clones within the batch's cleanup boundary.
      for (const { src, tempId } of clones) {
        onOptimisticInsert?.({ ...src, id: tempId, created_at: new Date().toISOString() })
      }
      let lastError: string | null = null
      let failed = 0
      // Sequential by design: the Supabase 24h-cap trigger has no advisory lock,
      // so parallel same-day duplicates could race the cap. Optimism already makes
      // this feel instant. (Native serializes via pg_advisory_xact_lock.)
      for (const { src, tempId } of clones) {
        let committed = false
        try {
          const { error } = await duplicateEntry(src.id)
          committed = !error
          if (error) {
            lastError = error
            failed++
            onOptimisticRemove?.(tempId)
          }
        } catch {
          lastError = 'Could not confirm a duplicate. Refresh before retrying.'
          failed++
          onOptimisticRemove?.(tempId)
        }
        onOptimisticSettled?.(tempId, committed)
      }
      // Always reconcile + clear + report, even on partial failure.
      if (!(await refreshEntries())) {
        for (const { tempId } of clones) {
          onOptimisticRemove?.(tempId)
          onOptimisticSettled?.(tempId)
        }
      }
      clearSelection()
      const succeeded = clones.length - failed
      if (failed > 0) {
        toast(`Duplicated ${succeeded} of ${clones.length}; ${failed} failed: ${lastError}`, 'error')
      } else {
        toast(`Duplicated ${succeeded} entr${succeeded === 1 ? 'y' : 'ies'}.`, 'success')
      }
    } finally {
      for (const { src } of clones) setRowBusy(src.id, false)
      duplicateBusyRef.current = false
    }
  }

  const performBulkDelete = async () => {
    if (deleteBusyRef.current) return
    const picked = rows.filter(t => selectedIds.has(t.id))
    if (picked.length === 0 || !picked.every(canModifyRow) || picked.some(t => rowLocks.has(t.id))) return
    deleteBusyRef.current = true
    for (const t of picked) setRowBusy(t.id, true)
    if (editingId && picked.some(t => t.id === editingId)) cancelEdit()
    // Disappear instantly; the reconcile below restores any row whose delete fails.
    for (const t of picked) onOptimisticRemove?.(t.id)
    clearSelection()
    try {
      let lastError: string | null = null
      let failed = 0
      for (const t of picked) {
        let committed = false
        try {
          const { error } = await deleteTimesheet(t.id)
          committed = !error
          if (error) {
            lastError = error
            failed++
            onOptimisticInsert?.(t)
          }
        } catch {
          lastError = 'Could not confirm a deletion. Refresh before retrying.'
          failed++
          onOptimisticInsert?.(t)
        }
        onOptimisticSettled?.(t.id, committed)
      }
      await refreshEntries()
      if (lastError) toast(`Deleted ${picked.length - failed} of ${picked.length}; ${failed} failed: ${lastError}`, 'error')
      else toast(`Deleted ${picked.length} entr${picked.length === 1 ? 'y' : 'ies'}.`, 'success')
    } finally {
      for (const t of picked) setRowBusy(t.id, false)
      deleteBusyRef.current = false
    }
  }

  const handleBulkDelete = () => {
    if (deleteBusyRef.current) return
    const picked = rows.filter(t => selectedIds.has(t.id))
    if (picked.length === 0 || !picked.every(canModifyRow)) return
    setConfirmState({
      title: 'Delete Entries',
      message: `Delete ${picked.length} selected entr${picked.length === 1 ? 'y' : 'ies'}? This cannot be undone.`,
      action: performBulkDelete,
    })
  }

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.altKey || e.ctrlKey) return
      if (document.querySelector('[data-shortcuts-modal]')) return
      // Never fire table shortcuts underneath a modal (bulk edit, confirm).
      if (Array.from(document.querySelectorAll('[role="dialog"][aria-modal="true"]')).some(
        dialog => !dialog.closest('[aria-hidden="true"]') && dialog.getClientRects().length > 0,
      )) return
      if (e.key?.toLowerCase() === 'd' && someSelected && !isFormField(document.activeElement)) {
        e.preventDefault()
        handleDuplicateSelected()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [someSelected, selectedIds, rows])

  // Close the mobile row menu on outside click or Escape. In capture phase so
  // it runs before the trigger's own click handler (which toggles the menu).
  useEffect(() => {
    if (!mobileMenu) return
    const close = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (target.closest('[data-mobile-menu]') || target.closest('[data-mobile-trigger]')) return
      setMobileMenu(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileMenu(null)
    }
    document.addEventListener('mousedown', close, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', close, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [mobileMenu])

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
       collapsible={collapsible}
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
           <Button variant="ghost" size="sm" onClick={handleUndoLast} className="text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:text-rose-300 dark:hover:bg-rose-950/40 dark:hover:text-rose-300" data-shortcut="undo-last">
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
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-2.5">
            <span className="text-xs text-fg-muted">
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
                  <Button size="sm" variant="secondary" disabled={!allSelectedModifiable} onClick={() => setBulkEditOpen(true)}>
                    Bulk Edit
                  </Button>
              {someSelected && (
                <>
                  <Button size="sm" variant="secondary" disabled={!allSelectedModifiable} onClick={handleDuplicateSelected}>
                    <IconCopy className="h-3.5 w-3.5" /> Duplicate
                  </Button>
                  <Button size="sm" variant="danger" disabled={!allSelectedModifiable} onClick={handleBulkDelete}>
                    <IconTrash className="h-3.5 w-3.5" /> Delete
                  </Button>
                </>
              )}
            </div>
            </div>
          <div className="max-h-96 overflow-x-auto overflow-y-auto overscroll-contain">
           <table className="w-full text-sm">
             <thead className="sticky top-0 z-20 whitespace-nowrap border-b border-border bg-muted/90 backdrop-blur supports-[backdrop-filter]:bg-muted/60">
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
            <tbody className="divide-y divide-border">
              {groupedRows.map(group => (
                <Fragment key={group.date}>
                  <tr
                    key={`group-${group.date}`}
                    id={group.date === today ? 'date-group-today' : undefined}
                    className="sticky top-[38px] z-5 bg-muted/90 backdrop-blur supports-[backdrop-filter]:bg-muted/80"
                  >
                    <td colSpan={7} className="px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-fg-muted">
                      {group.label}
                    </td>
                  </tr>
                  {group.entries.map(t => {
                    // Admins can edit anything; users edit only their own entries
                    // Admins can edit anything; users can edit or delete only
                    // their own entries inside the inclusive backfill window.
                    const canEdit = canModifyRow(t)
                    if (editingId === t.id) {
                      return (
                        <tr key={t.id} className="bg-primary-50/60 dark:bg-primary-900/30 dark:text-primary-200">
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
                      <tr key={t.id} className="group transition-colors hover:bg-muted/70" data-row-id={t.id}>
                        <Td className="w-8">
                          <input
                            type="checkbox"
                            aria-label={`Select entry from ${t.log_date}`}
                            checked={selectedIds.has(t.id)}
                            disabled={isTemporaryTimesheetId(t.id) || rowBusyIds.has(t.id)}
                            onChange={() => toggleSelect(t.id)}
                            className="h-3.5 w-3.5 accent-primary-600"
                          />
                        </Td>
                        <Td className="whitespace-nowrap tabular-nums">{t.log_date}</Td>
                        <Td className="font-medium text-fg">{t.projects?.name}</Td>
                        <Td className="text-fg-muted">{t.activity_types?.name || '—'}</Td>
                        <Td className="text-right tabular-nums">{t.hours_worked}</Td>
                        <Td className="max-w-xs truncate text-fg-muted">{t.work_done}</Td>
                        <Td className="text-right relative">
                          {canDuplicateRow(t) ? (
                            <div className="inline-flex items-center gap-1">
                              <div className="hidden md:flex md:items-center md:gap-1 md:opacity-0 md:transition-opacity md:group-hover:opacity-100 md:group-focus-within:opacity-100">
                                <Button variant="ghost" size="sm" onClick={() => startEdit(t)} disabled={!canEdit || rowBusyIds.has(t.id)} className="px-2 text-primary-600 hover:bg-primary-50 dark:text-primary-200 dark:hover:bg-primary-900/30">
                                  <IconPencil className="h-3.5 w-3.5" />
                                  <span className="sr-only">Edit</span>
                                </Button>
                                <Button variant="ghost" size="sm" onClick={() => handleDuplicateEntry(t)} disabled={!canEdit || rowBusyIds.has(t.id)} className="px-2 text-fg-muted hover:bg-muted" title="Duplicate entry (select a row + press D)">
                                  {rowBusyIds.has(t.id) ? <Spinner className="h-3.5 w-3.5" /> : <IconCopy className="h-3.5 w-3.5" />}
                                  <span className="sr-only">Duplicate</span>
                                </Button>
                                <Button variant="ghost" size="sm" onClick={() => setDuplicateDateTarget(t)} disabled={rowBusyIds.has(t.id)} className="px-2 text-fg-muted hover:bg-muted" title="Duplicate to date…">
                                  <IconCalendar className="h-3.5 w-3.5" />
                                  <span className="sr-only">Duplicate to date</span>
                                </Button>
                                <Button variant="ghost" size="sm" onClick={() => handleDeleteEntry(t.id)} disabled={!canEdit || rowBusyIds.has(t.id)} className="px-2 text-rose-600 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-950/40">
                                  <IconTrash className="h-3.5 w-3.5" />
                                  <span className="sr-only">Delete</span>
                                </Button>
                              </div>
                              <div className="md:hidden">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  data-mobile-trigger
                                  aria-haspopup="menu"
                                  aria-expanded={mobileMenu?.id === t.id}
                                  className="px-2 text-fg-muted hover:bg-muted"
                                  onClick={(e) => {
                                    if (mobileMenu?.id === t.id) {
                                      setMobileMenu(null)
                                      return
                                    }
                                    // Position the menu with `fixed` coords so it
                                    // isn't clipped by the overflow-y-auto wrapper.
                                    const r = e.currentTarget.getBoundingClientRect()
                                    const width = 176 // w-44
                                    const left = Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8))
                                    setMobileMenu({ id: t.id, left, top: r.bottom + 4 })
                                  }}
                                >
                                  <IconMoreHorizontal className="h-3.5 w-3.5" />
                                </Button>
                                {mobileMenu?.id === t.id && (
                                  <div
                                    data-mobile-menu
                                    role="menu"
                                    className="fixed z-50 flex w-44 flex-col rounded-lg border border-border bg-card shadow-card"
                                    style={{ top: mobileMenu.top, left: mobileMenu.left }}
                                  >
                                    <button type="button" role="menuitem" disabled={!canEdit || rowBusyIds.has(t.id)} onClick={() => { startEdit(t); setMobileMenu(null) }} className="px-3 py-2 text-left text-sm hover:bg-muted">Edit</button>
                                    <button type="button" role="menuitem" disabled={!canEdit || rowBusyIds.has(t.id)} onClick={() => { handleDuplicateEntry(t); setMobileMenu(null) }} className="px-3 py-2 text-left text-sm hover:bg-muted disabled:opacity-50">{rowBusyIds.has(t.id) ? 'Saving…' : 'Duplicate'}</button>
                                    <button type="button" role="menuitem" disabled={rowBusyIds.has(t.id)} onClick={() => { setDuplicateDateTarget(t); setMobileMenu(null) }} className="px-3 py-2 text-left text-sm hover:bg-muted disabled:opacity-50">Duplicate to date…</button>
                                    <button type="button" role="menuitem" disabled={!canEdit || rowBusyIds.has(t.id)} onClick={() => { handleDeleteEntry(t.id); setMobileMenu(null) }} className="px-3 py-2 text-left text-sm text-rose-600 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-950/40">Delete</button>
                                  </div>
                                )}
                              </div>
                            </div>
                          ) : (
                            <Badge tone="slate">{isTemporaryTimesheetId(t.id) ? 'Saving…' : 'View only'}</Badge>
                          )}
                        </Td>
                      </tr>
                    )
                  })}
                </Fragment>
              ))}
            </tbody>
          </table>
          {totalPages > 1 && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2.5">
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => goToPage(page - 1)} disabled={page <= 1}>
                  Previous
                </Button>
                <span className="text-xs text-fg-muted">
                  Page {page} of {totalPages}
                </span>
                <Button variant="ghost" size="sm" onClick={() => goToPage(page + 1)} disabled={page >= totalPages}>
                  Next
                </Button>
              </div>
              <Select
                value={String(pageSize)}
                onChange={(e) => {
                  const size = Number(e.target.value)
                  setPageSize(size)
                  setPage(1)
                  syncUrl(userFilter, 1, size)
                }}
                className="w-auto text-xs"
                aria-label="Entries per page"
              >
                <option value="25">25 / page</option>
                <option value="50">50 / page</option>
                <option value="100">100 / page</option>
              </Select>
            </div>
          )}
        </div>
        </div>
      )}
      {bulkEditOpen && someSelected && (
        <BulkEditModal
          entries={rows.filter(t => selectedIds.has(t.id))}
          projects={projects}
          activityTypes={activityTypes}
          onClose={() => setBulkEditOpen(false)}
          onDone={() => { setBulkEditOpen(false); onChanged() }}
        />
      )}
      <PromptDialog
        open={duplicateDateTarget !== null}
        title="Duplicate to date"
        label="Target date"
        initialValue={duplicateDateTarget?.log_date ?? ''}
        submitLabel="Duplicate"
        inputType="date"
        onSubmit={(date) => {
          if (duplicateDateTarget) void handleDuplicateEntry(duplicateDateTarget, date)
        }}
        onClose={() => setDuplicateDateTarget(null)}
      />
      <ConfirmDialog
        open={confirmState !== null}
        title={confirmState?.title ?? ''}
        message={confirmState?.message ?? ''}
        confirmLabel="Delete"
        onConfirm={() => {
          if (confirmState) void confirmState.action()
        }}
        onClose={() => setConfirmState(null)}
      />
    </Card>
  )
}
