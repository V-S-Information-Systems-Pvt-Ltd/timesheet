// app/dashboard/entries-table.tsx
'use client'

import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { dataClient } from '@/lib/data/client'
import { readTimesheetHistory, selectedSnapshotRows, type EntriesPage } from '@/lib/dashboard-timesheets'
import { addDaysISO } from '@/lib/dates'
import { isFormField } from '@/lib/shortcuts'
import { createTemporaryTimesheetId, isTemporaryTimesheetId } from '@/lib/optimistic-timesheets'
import { ActivityType, Project, Timesheet, User } from '../types'
import { Alert, Badge, Button, Card, Checkbox, EmptyState, Field, IconButton, Input, LoadingState, Menu, Select, Spinner, Td, Th } from '@/app/components/ui'
import { ConfirmDialog, PromptDialog } from '@/app/components/confirm'
import { toast } from '@/app/components/toast'
import { IconCalendar, IconCheck, IconClock, IconCopy, IconDocument, IconMoreHorizontal, IconPencil, IconTrash } from '@/app/components/icons'
import { copyText } from '@/lib/clipboard'
import { buildBotCommand } from '@/lib/telegram'
import ProjectPicker from './project-picker'
import BulkEditModal from './bulk-edit-modal'
import { activityDisplayLabel } from '@vsis/contracts'
import ClassificationFields, { classificationFromEntry, classificationInput, emptyClassification, validateWebEntry } from './classification-fields'
import TimeEntryForm from './time-entry-form'
import { Dialog } from '@/app/components/dialog'

export default function EntriesTable({
  timesheets,
  projects,
  activityTypes,
  users = [],
  userId,
  pagination,
  totalCount,
  loading,
  readError,
  scope,
  isSessionCurrent,
  isAdmin,
  canFilterByUser,
  minLogDate,
  today,
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
  pagination: EntriesPage
  totalCount: number | null
  loading: boolean
  readError: string | null
  scope: string
  isSessionCurrent: () => boolean
  isAdmin: boolean
  /** Shows the "User" filter (admins, COs, managers, team leads). */
  canFilterByUser: boolean
  minLogDate: string
  /** Empty during SSR/initial hydration; confirmed browser-local day afterwards. */
  today: string
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
  const [editClassification, setEditClassification] = useState({ ...emptyClassification })
  const [editFieldErrors, setEditFieldErrors] = useState<Record<string, string[]>>({})
  const [newDraft, setNewDraft] = useState<Timesheet | null>(null)
  const [editHours, setEditHours] = useState('')
  const [editWorkDone, setEditWorkDone] = useState('')
  const [editLogDate, setEditLogDate] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const { user: userFilter, page, size: pageSize } = pagination
  const [selectionSnapshot, setSelectionSnapshot] = useState<Map<string, Timesheet>>(new Map())
  // Retained rows are display-only until the current-scope read succeeds.
  // Identity also rejects callbacks captured before a failed read/recovery.
  const readContext = useMemo(() => ({ scope, ready: !loading && !readError }), [scope, loading, readError])
  const currentReadContext = useRef(readContext)
  const canUseSnapshots = () => readContext.ready && currentReadContext.current === readContext && isSessionCurrent()
  const [bulkMutationActive, setBulkMutationActive] = useState(false)
  const historyGeneration = useRef(0)
  const editGenerationRef = useRef(0)
  const latestGeneration = useRef(0)
  const historyContext = useRef({ scope, timesheets, busyIds })
  useLayoutEffect(() => {
    currentReadContext.current = readContext
    historyContext.current = { scope, timesheets, busyIds }
    historyGeneration.current++
    if (!readContext.ready) {
      latestGeneration.current++
      editGenerationRef.current++
    }
  }, [scope, timesheets, busyIds, readContext])
  const [historyState, setHistoryState] = useState<{ scope: string; timesheets: Timesheet[]; busyIds: ReadonlySet<string> | undefined; generation: number; loading: boolean; error: string | null }>({ scope, timesheets, busyIds, generation: 0, loading: false, error: null })
  const historyMatches = historyState.scope === scope && historyState.timesheets === timesheets && historyState.busyIds === busyIds
  const historyLoading = historyMatches && historyState.loading
  const historyError = historyMatches ? historyState.error : null
  const [previousScope, setPreviousScope] = useState(scope)
  const [previousReadContext, setPreviousReadContext] = useState(readContext)
  const [bulkEditSnapshot, setBulkEditSnapshot] = useState<Timesheet[] | null>(null)
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
    if (busy) {
      historyGeneration.current++
      setSelectedIds(new Set())
      setSelectionSnapshot(new Map())
      setHistoryState(prev => ({ ...prev, loading: false, error: null }))
    }
    if (onBusyChange) onBusyChange(id, busy)
    else {
      if (busy) rowLocks.add(id)
      else rowLocks.delete(id)
      setLocalBusyIds(new Set(rowLocks))
    }
  }
  // Row whose "Duplicate to date…" dialog is open (null = closed).
  const [duplicateDateTarget, setDuplicateDateTarget] = useState<Timesheet | null>(null)
  const [latestToEdit, setLatestToEdit] = useState<{ id: string; isCurrent: () => boolean } | null>(null)
  const [latestReading, setLatestReading] = useState(false)
  if (previousScope !== scope || previousReadContext !== readContext) {
    setPreviousScope(scope)
    setPreviousReadContext(readContext)
    if (previousScope !== scope || !readContext.ready) {
      setSelectedIds(new Set())
      setSelectionSnapshot(new Map())
      setHistoryState(prev => ({ ...prev, loading: false, error: null }))
      setEditingId(null)
      setConfirmState(null)
      setDuplicateDateTarget(null)
      setNewDraft(null)
      // Edit Last carries only an ID across its intentional page navigation;
      // it opens from the fresh destination rows, never from a saved row.
      if (readError) setLatestToEdit(null)
      setLatestReading(false)
      // A submitted batch still owns its modal and locks through reconciliation.
      if (!bulkMutationActive) setBulkEditSnapshot(null)
    }
  }

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

  const yesterday = today ? addDaysISO(today, -1) : ''

  const canDuplicateRow = (t: Timesheet) =>
    !isTemporaryTimesheetId(t.id) && (isAdmin || t.user_id === userId)
  const canModifyRow = (t: Timesheet) =>
    readContext.ready && Boolean(today) && canDuplicateRow(t) && (isAdmin || (t.log_date >= minLogDate && t.log_date <= today))

  const refreshEntries = async () => {
    try {
      return (await onChanged()) !== false
    } catch {
      toast('Could not refresh entries. Please refresh before retrying.', 'error')
      return false
    }
  }

  const selectedRows = selectedSnapshotRows(selectionSnapshot, selectedIds)
  const allSelectedModifiable = selectedRows.length > 0 && selectedRows.every(t => canModifyRow(t) && !rowBusyIds.has(t.id))

  const syncUrl = (user: string, nextPage: number, size: number) => {
    if (typeof window === 'undefined') return
    if (rowLocks.size > 0 || historyLoading) return
    const sp = new URLSearchParams(window.location.search)
    if (user) sp.set('user', user); else sp.delete('user')
    if (nextPage > 1) sp.set('page', String(nextPage)); else sp.delete('page')
    if (size !== 50) sp.set('size', String(size)); else sp.delete('size')
    const qs = sp.toString()
    window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname)
  }

  const pageRows = rows
  const totalPages = Math.max(1, Math.ceil((totalCount ?? 0) / pageSize))
  const navigationBusy = loading || historyLoading || rowBusyIds.size > 0
  // Correct an out-of-range deep link after its authoritative count arrives.
  useEffect(() => {
    if (!loading && !readError && totalCount !== null && page > totalPages && rowLocks.size === 0) {
      syncUrl(userFilter, totalPages, pageSize)
    }
    // URL changes are observed by the parent useSearchParams hook.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, readError, totalCount, page, totalPages, userFilter, pageSize])

  useEffect(() => () => { historyGeneration.current++; latestGeneration.current++ }, [])

  const groupedRows = useMemo(() => {
    const groups: { date: string; label: string; entries: Timesheet[] }[] = []
    for (const t of pageRows) {
      const existing = groups.find(g => g.date === t.log_date)
      if (existing) {
        existing.entries.push(t)
      } else {
        const label = today && t.log_date === today ? 'Today' : yesterday && t.log_date === yesterday ? 'Yesterday' : t.log_date
        groups.push({ date: t.log_date, label, entries: [t] })
      }
    }
    return groups
  }, [pageRows, today, yesterday])

  const todayGroupExists = Boolean(today) && groupedRows.some(g => g.date === today)

  const handleJumpToToday = () => {
    if (!today) return
    const el = document.getElementById('date-group-today')
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }

  const toggleSelectAll = () => {
    if (!canUseSnapshots() || navigationBusy) return
    setSelectionSnapshot(prev => {
      const next = new Map(prev)
      for (const row of selectableRows) next.set(row.id, row)
      return next
    })
    setSelectedIds(prev => {
      const next = new Set(prev)
      for (const row of selectableRows) { if (allSelected) next.delete(row.id); else next.add(row.id) }
      return next
    })
  }

  const selectAllHistory = async () => {
    if (!canUseSnapshots() || navigationBusy || rowLocks.size > 0) return
    const generation = ++historyGeneration.current
    setHistoryState({ scope, timesheets, busyIds, generation, loading: true, error: null })
    try {
      const snapshot = await readTimesheetHistory(
        query => dataClient.getTimesheets(query, { deduplicate: false }),
        { userId: userFilter || undefined },
        () => generation === historyGeneration.current && rowLocks.size === 0 && canUseSnapshots(),
      )
      if (generation !== historyGeneration.current || !canUseSnapshots()) return
      setSelectionSnapshot(new Map(snapshot.map(row => [row.id, row])))
      setSelectedIds(new Set(snapshot.map(row => row.id)))
      setHistoryState({ scope, timesheets, busyIds, generation, loading: false, error: null })
    } catch (error) {
      if (generation !== historyGeneration.current) return
      setHistoryState({ scope, timesheets, busyIds, generation, loading: false, error: error instanceof Error ? error.message : 'Could not select complete history.' })
    }
  }

  const goToPage = (p: number) => {
    const clamped = Math.max(1, Math.min(p, totalPages))
    syncUrl(userFilter, clamped, pageSize)
  }

  const toggleSelect = (id: string) => {
    if (!canUseSnapshots() || navigationBusy || isTemporaryTimesheetId(id)) return
    const row = rows.find(row => row.id === id)
    if (!row) return
    setSelectionSnapshot(prev => new Map(prev).set(id, row))
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const clearSelection = () => { historyGeneration.current++; setSelectedIds(new Set()); setSelectionSnapshot(new Map()); setHistoryState(prev => ({ ...prev, loading: false, error: null })) }

  const handleUserFilterChange = (value: string) => {
    syncUrl(value, 1, pageSize)
  }

  const startEdit = (t: Timesheet) => {
    if (!canUseSnapshots() || historyLoading || !canModifyRow(t) || rowLocks.has(t.id)) return
    editGenerationRef.current++
    setEditingId(t.id)
    setEditProjectId(t.project_id ?? '')
    setEditClassification(classificationFromEntry(t))
    setEditFieldErrors({})
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
    setEditClassification({ ...emptyClassification })
    setEditFieldErrors({})
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
    if (!canUseSnapshots() || !prev || !canModifyRow(prev) || rowLocks.has(id)) return
    const classification = { ...editClassification }
    const validated = validateWebEntry({
      ...(prev.entry_type ? classificationInput(classification) : { projectId: editProjectId, activityTypeId: editActivityTypeId }),
      hoursWorked: parseFloat(editHours), workDone: editWorkDone, logDate: editLogDate,
    }, !prev.entry_type)
    setEditFieldErrors(validated.fieldErrors)
    if (!validated.input) return
    const input = validated.input
    setRowBusy(id, true)
    const projectId = input.projectId ?? ''
    const activityTypeId = input.activityTypeId ?? ''
    const hours = editHours
    const hoursWorked = parseFloat(hours)
    const workDone = editWorkDone
    const logDate = editLogDate
    cancelEdit()
    const generation = editGenerationRef.current
    const restoreDraft = (fieldErrors: Record<string, string[]> = {}) => {
      // Never replace a different editor the user opened while this was pending.
      if (editGenerationRef.current !== generation || !canUseSnapshots()) return
      setEditingId(id)
      setEditProjectId(projectId)
      setEditActivityTypeId(activityTypeId)
      setEditClassification(classification)
      setEditFieldErrors(fieldErrors)
      setEditHours(hours)
      setEditWorkDone(workDone)
      setEditLogDate(logDate)
    }
    // Optimistically reflect the edit, including the joined names the row renders.
    onOptimisticUpdate?.(id, {
      project_id: projectId || null,
      activity_type_id: activityTypeId || null,
      entry_type: input.entryType ?? null, activity_code: input.activityCode ?? null,
      ticket_number: input.ticketNumber ?? null, activity_other: input.activityOther ?? null,
      hours_worked: hoursWorked,
      work_done: workDone,
      log_date: logDate,
      projects: projectId ? { name: projectById.get(projectId)?.name ?? '' } : null,
      activity_types: activityTypeId ? { name: typeById.get(activityTypeId)?.name ?? '' } : null,
    })
    try {
      const { error, fieldErrors } = await dataClient.updateTimesheet(id, input)
      if (error) {
        onOptimisticUpdate?.(id, prev)
        onOptimisticSettled?.(id)
        restoreDraft(fieldErrors)
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
    if (!canUseSnapshots() || historyLoading || !prev || !canModifyRow(prev) || rowLocks.has(entryId)) return
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
      const { error } = await dataClient.deleteTimesheet(entryId)
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
    if (!canUseSnapshots()) return
    setConfirmState({
      title: 'Delete Entry',
      message: 'Are you sure you want to delete this entry? This cannot be undone.',
      action: () => performDeleteEntry(entryId),
    })
  }

  const performUndoLast = async (latest: Timesheet) => {
    if (!canUseSnapshots() || rowLocks.size > 0 || !canModifyRow(latest)) return
    setRowBusy(latest.id, true)
    try {
      const { error } = await dataClient.deleteLastTimesheet()
      if (error) toast(error, 'error')
      else { await refreshEntries(); toast('Most recent entry deleted.', 'success') }
    } finally { setRowBusy(latest.id, false) }
  }

  const handleUndoLast = async () => {
    if (!canUseSnapshots() || !today || historyLoading || latestReading || rowLocks.size > 0) return
    const generation = ++latestGeneration.current
    setLatestReading(true)
    try {
      const { data: latest, error } = await dataClient.getLastTimesheet()
      if (generation !== latestGeneration.current || !canUseSnapshots() || historyContext.current.scope !== scope) return
      if (error) return toast(error, 'error')
      if (!latest) return toast('No entries to undo.', 'info')
      if (!canModifyRow(latest)) return toast('Your most recent entry is outside the writable backfill window.', 'info')
      setConfirmState({ title: 'Undo Last Entry', message: 'Delete your most recent entry? This cannot be undone.', action: () => performUndoLast(latest) })
    } finally { if (generation === latestGeneration.current) setLatestReading(false) }
  }

  const handleEditLast = async () => {
    if (!canUseSnapshots() || !today || historyLoading || latestReading || rowLocks.size > 0) return
    const generation = ++latestGeneration.current
    setLatestReading(true)
    try {
      const result = await dataClient.getTimesheets({ userId: isAdmin ? undefined : userId, limit: 1, includeCount: false }, { deduplicate: false })
      if (generation !== latestGeneration.current || !canUseSnapshots() || historyContext.current.scope !== scope) return
      if (result.error) return toast(result.error, 'error')
      const latest = result.data?.[0]
      if (!latest) return toast('No entries to edit.', 'info')
      if (!canModifyRow(latest)) return toast('Your most recent entry is outside the writable backfill window.', 'info')
      if (rows.some(row => row.id === latest.id)) startEdit(latest)
      else {
        setLatestToEdit({ id: latest.id, isCurrent: isSessionCurrent })
        syncUrl('', 1, pageSize)
      }
    } finally { if (generation === latestGeneration.current) setLatestReading(false) }
  }

  useEffect(() => {
    if (!latestToEdit || !canUseSnapshots() || page !== 1 || userFilter) return
    if (latestToEdit.isCurrent()) {
      const row = rows.find(row => row.id === latestToEdit.id)
      // External URL/page navigation completes asynchronously before this editor opens.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (row) startEdit(row)
      else toast('The latest entry changed. Please retry Edit Last.', 'info')
    }
    setLatestToEdit(null)
    // Open the editor only after the independently selected first page arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestToEdit, loading, readError, rows, page, userFilter])

  const handleDuplicateEntry = async (t: Timesheet, targetDate?: string) => {
    if (!canUseSnapshots() || !today || historyLoading || !canDuplicateRow(t) || (targetDate === undefined && !canModifyRow(t)) || rowLocks.has(t.id)) return
    const logDate = targetDate?.trim() || t.log_date
    if (!t.entry_type) {
      setNewDraft({ ...t, log_date: logDate })
      toast('Historical entry copied to a new draft. Select Type and Activity.', 'info')
      return
    }
    const tempId = createTemporaryTimesheetId()
    // Optimistic clone carries the joined names the row renders; the real id
    // arrives on reconcile.
    onOptimisticInsert?.({ ...t, id: tempId, log_date: logDate, created_at: new Date().toISOString() })
    setRowBusy(t.id, true)
    try {
      const { error, code } = await dataClient.duplicateTimesheet(t.id, targetDate)
      if (error) {
        onOptimisticRemove?.(tempId)
        onOptimisticSettled?.(tempId)
        if ((code === 'VALIDATION_ERROR' || code === 'CLASSIFICATION_REQUIRED') && canUseSnapshots()) setNewDraft({ ...t, log_date: logDate })
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
    if (!canUseSnapshots() || historyLoading) return
    const picked = selectedRows
    const commands: string[] = []
    let skipped = 0
    for (const t of picked) {
      const project = t.project_id ? projectById.get(t.project_id) : undefined
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
    if (!canUseSnapshots() || historyLoading || !someSelected || duplicateBusyRef.current) return
    const picked = selectedRows
    if (picked.length === 0 || !picked.every(canModifyRow) || picked.some(t => rowLocks.has(t.id))) return
    if (picked.length === 1 && !picked[0].entry_type) { setNewDraft({ ...picked[0] }); clearSelection(); return }
    const legacyRows = picked.filter(t => !t.entry_type)
    const clones = picked.filter(t => t.entry_type).map(t => ({ src: t, tempId: createTemporaryTimesheetId() }))
    if (legacyRows.length) toast(`CLASSIFICATION_REQUIRED: ${legacyRows.map(t => t.id).join(', ')}. Duplicate these historical entries individually to classify a new draft.`, 'info')
    if (!clones.length) { clearSelection(); return }
    duplicateBusyRef.current = true
    for (const { src } of clones) setRowBusy(src.id, true)
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
          if (!isSessionCurrent()) throw new Error('Session changed')
          const { error } = await dataClient.duplicateTimesheet(src.id)
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

  const performBulkDelete = async (picked: Timesheet[]) => {
    if (!canUseSnapshots() || historyLoading || deleteBusyRef.current) return
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
          if (!isSessionCurrent()) throw new Error('Session changed')
          const { error } = await dataClient.deleteTimesheet(t.id)
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
    if (!canUseSnapshots() || deleteBusyRef.current) return
    const picked = selectedRows
    if (picked.length === 0 || !picked.every(canModifyRow)) return
    setConfirmState({
      title: 'Delete Entries',
      message: `Delete ${picked.length} selected entr${picked.length === 1 ? 'y' : 'ies'}? This cannot be undone.`,
      action: () => performBulkDelete(picked),
    })
  }

  const openBulkEdit = () => {
    if (!canUseSnapshots() || historyLoading || !allSelectedModifiable || selectedRows.length > 500 || rowLocks.size > 0) return
    setBulkEditSnapshot(selectedRows.map(row => ({ ...row })))
  }

  const openDuplicateDate = (row: Timesheet) => {
    if (!canUseSnapshots() || historyLoading || !today || !canDuplicateRow(row) || rowLocks.has(row.id)) return
    setDuplicateDateTarget(row)
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
  }, [someSelected, selectedIds, selectedRows, historyLoading, today, minLogDate, readContext])


  return (
    <Card
      title={canFilterByUser ? 'Recent Entries' : 'My Recent Entries'}
      subtitle={
        canFilterByUser && userFilter
          ? `${totalCount ?? '…'} entr${totalCount === 1 ? 'y' : 'ies'} · ${
              users.find(u => u.id === userFilter)?.name || 'selected user'
            }`
          : `${totalCount ?? '…'} entr${totalCount === 1 ? 'y' : 'ies'}`
      }
      icon={<IconDocument className="h-4.5 w-4.5" />}
       bodyClassName="p-0"
       collapsible={collapsible}
       actions={
         <>
           {timesheets.length > 0 && (
             <Button variant="ghost" size="sm" onClick={handleJumpToToday} disabled={!todayGroupExists} title="Jump to today">
               <IconCalendar className="h-3.5 w-3.5" /> Today
             </Button>
           )}
           <Button variant="ghost" size="sm" disabled={!readContext.ready || !today || historyLoading || latestReading || rowBusyIds.size > 0} onClick={handleEditLast} data-shortcut="edit-last">
             <IconPencil className="h-3.5 w-3.5" /> Edit Last
           </Button>
           <Button variant="ghost" size="sm" disabled={!readContext.ready || !today || historyLoading || latestReading || rowBusyIds.size > 0} onClick={handleUndoLast} className="text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:text-rose-300 dark:hover:bg-rose-950/40 dark:hover:text-rose-300" data-shortcut="undo-last">
             <IconTrash className="h-3.5 w-3.5" /> Undo Last
           </Button>
         </>
       }
    >
        <div>
          {readError && <Alert tone="error" className="m-4">{readError} <Button variant="secondary" size="sm" onClick={() => void onChanged()}>Retry entries</Button></Alert>}
          {historyError && <Alert tone="error" className="m-4">{historyError}</Alert>}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-2.5">
            <span className="text-xs text-fg-muted">
              {historyLoading ? 'Loading filtered history…' : someSelected
                ? `${selectedIds.size} selected`
                : 'Select entries to copy their Telegram bot commands'}
            </span>
            <div className="flex flex-wrap items-center gap-2">
              {canFilterByUser && users.length > 0 && (
                <Select
                  value={userFilter}
                  disabled={navigationBusy}
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
              <Button variant="secondary" size="sm" disabled={navigationBusy || Boolean(readError)} onClick={() => void selectAllHistory()}>Select all filtered history</Button>
              {someSelected && (
                <Button variant="ghost" size="sm" onClick={clearSelection}>
                  Clear
                </Button>
              )}
              <Button size="sm" variant="secondary" disabled={!readContext.ready || historyLoading || !someSelected} onClick={handleCopyCommands}>
                <IconCopy className="h-3.5 w-3.5" /> Copy Commands
              </Button>
                  <Button size="sm" variant="secondary" disabled={historyLoading || !allSelectedModifiable || selectedRows.length > 500} title={selectedRows.length > 500 ? 'Bulk edit supports up to 500 entries. Select fewer entries.' : undefined} onClick={openBulkEdit}>
                    Bulk Edit
                  </Button>
              {someSelected && (
                <>
                  <Button size="sm" variant="secondary" disabled={historyLoading || !allSelectedModifiable} onClick={handleDuplicateSelected}>
                    <IconCopy className="h-3.5 w-3.5" /> Duplicate
                  </Button>
                  <Button size="sm" variant="danger" disabled={historyLoading || !allSelectedModifiable} onClick={handleBulkDelete}>
                    <IconTrash className="h-3.5 w-3.5" /> Delete
                  </Button>
                </>
              )}
            </div>
            </div>
          <div className="max-h-96 overflow-x-auto overflow-y-auto overscroll-contain">
          {loading && <LoadingState label="Loading entries…" />}
          {!loading && !readError && timesheets.length === 0 && <EmptyState className="m-5" icon={<IconClock className="h-5 w-5" />} title="No entries found" description="Try another user filter or log an entry." />}
           <table className="w-full text-sm">
             <thead className="sticky top-0 z-20 whitespace-nowrap border-b border-border bg-muted/90 backdrop-blur supports-[backdrop-filter]:bg-muted/60">
              <tr>
                <Th className="w-8">
                  <Checkbox
                    aria-label="Select entries on this page"
                    disabled={!readContext.ready || navigationBusy}
                    checked={allSelected}
                    ref={el => { if (el) el.indeterminate = someSelected && !allSelected }}
                    onChange={toggleSelectAll}
                    className="h-3.5 w-3.5 accent-primary-600"
                  />
                </Th>
                <Th>Date</Th>
                <Th>Project</Th>
                <Th>Type / Activity</Th>
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
                    id={today && group.date === today ? 'date-group-today' : undefined}
                    className="sticky top-[38px] z-5 bg-muted/90 backdrop-blur supports-[backdrop-filter]:bg-muted/80"
                  >
                    <td colSpan={7} className="px-4 py-1.5 text-xs font-semibold text-fg-subtle">
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
                              <Field label="Date" className="w-36" error={editFieldErrors.logDate?.[0]}>
                                <Input type="date" value={editLogDate} onChange={(e) => setEditLogDate(e.target.value)} required className="text-xs" />
                              </Field>
                              {t.entry_type ? <ClassificationFields projects={projects} value={editClassification} fieldErrors={editFieldErrors} idPrefix={`edit-${t.id}`} onChange={value => { setEditClassification(value); setEditFieldErrors({}) }} /> : <>
                              <Field label="Project" className="w-56" error={editFieldErrors.projectId?.[0]}>
                                <ProjectPicker
                                  projects={projects}
                                  value={editProjectId}
                                  onChange={setEditProjectId}
                                  required
                                />
                              </Field>
                              <Field label="Activity Type" className="w-40" error={editFieldErrors.activityTypeId?.[0]}>
                                <Select value={editActivityTypeId} onChange={(e) => setEditActivityTypeId(e.target.value)} required className="text-xs">
                                  <option value="">Select Type…</option>
                                  {t.activity_type_id && !activityTypes.some(at => at.id === t.activity_type_id) && <option value={t.activity_type_id}>{t.activity_types?.name || 'Stored activity'}</option>}
                                  {activityTypes.map(at => <option key={at.id} value={at.id}>{at.name}</option>)}
                                </Select>
                              </Field>
                              </>}
                              <Field label="Hours" className="w-20" error={editFieldErrors.hoursWorked?.[0]}>
                                <Input type="number" step="0.25" min="0" value={editHours} onChange={(e) => setEditHours(e.target.value)} required className="text-xs" />
                              </Field>
                              <Field label="Work Done" className="min-w-40 flex-1" error={editFieldErrors.workDone?.[0]}>
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
                          <Checkbox
                            aria-label={`Select entry from ${t.log_date}`}
                            checked={selectedIds.has(t.id)}
                            disabled={!readContext.ready || navigationBusy || isTemporaryTimesheetId(t.id) || rowBusyIds.has(t.id)}
                            onChange={() => toggleSelect(t.id)}
                            className="h-3.5 w-3.5 accent-primary-600"
                          />
                        </Td>
                        <Td className="whitespace-nowrap tabular-nums">{t.log_date}</Td>
                        <Td className="font-medium text-fg">{t.projects?.name || (t.entry_type ? 'No project' : '—')}</Td>
                        <Td className="text-fg-muted">
                          {t.entry_type && t.activity_code ? activityDisplayLabel(t.entry_type, t.activity_code) : `Legacy · ${t.activity_types?.name || '—'}`}
                          {t.ticket_number && <div className="text-xs">Ticket Number: {t.ticket_number}</div>}
                          {t.activity_other && <div className="text-xs">Other Activity: {t.activity_other}</div>}
                        </Td>
                        <Td className="text-right tabular-nums">{t.hours_worked}</Td>
                        <Td className="max-w-xs truncate text-fg-muted">{t.work_done}</Td>
                        <Td className="text-right relative">
                          {canDuplicateRow(t) ? (
                            <div className="inline-flex items-center gap-1">
                              <div className="hidden md:flex md:items-center md:gap-1 md:opacity-0 md:transition-opacity md:group-hover:opacity-100 md:group-focus-within:opacity-100">
                                <IconButton label="Edit" size="sm" tone="primary" className="min-h-9 min-w-9" onClick={() => startEdit(t)} disabled={!canEdit || rowBusyIds.has(t.id)}>
                                  <IconPencil className="h-3.5 w-3.5" />
                                </IconButton>
                                <IconButton label="Duplicate" size="sm" className="min-h-9 min-w-9" onClick={() => handleDuplicateEntry(t)} disabled={!canEdit || rowBusyIds.has(t.id)} title="Duplicate entry (select a row + press D)">
                                  {rowBusyIds.has(t.id) ? <Spinner className="h-3.5 w-3.5" /> : <IconCopy className="h-3.5 w-3.5" />}
                                </IconButton>
                                <IconButton label="Duplicate to date" size="sm" className="min-h-9 min-w-9" onClick={() => openDuplicateDate(t)} disabled={!readContext.ready || historyLoading || !today || rowBusyIds.has(t.id)} title="Duplicate to date…">
                                  <IconCalendar className="h-3.5 w-3.5" />
                                </IconButton>
                                <IconButton label="Delete" size="sm" tone="danger" className="min-h-9 min-w-9" onClick={() => handleDeleteEntry(t.id)} disabled={!canEdit || rowBusyIds.has(t.id)}>
                                  <IconTrash className="h-3.5 w-3.5" />
                                </IconButton>
                              </div>
                              <Menu
                                key={`${scope}:${readContext.ready}`}
                                className="md:hidden"
                                disabled={!readContext.ready}
                                label="Entry actions"
                                trigger={<IconMoreHorizontal className="h-4 w-4" />}
                                items={[
                                  { label: 'Edit', disabled: !canEdit || rowBusyIds.has(t.id), onSelect: () => startEdit(t) },
                                  { label: rowBusyIds.has(t.id) ? 'Saving…' : 'Duplicate', disabled: !canEdit || rowBusyIds.has(t.id), onSelect: () => { void handleDuplicateEntry(t) } },
                                  { label: 'Duplicate to date…', disabled: !readContext.ready || historyLoading || !today || rowBusyIds.has(t.id), onSelect: () => openDuplicateDate(t) },
                                  { label: 'Delete', destructive: true, disabled: !canEdit || rowBusyIds.has(t.id), onSelect: () => handleDeleteEntry(t.id) },
                                ]}
                              />
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
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2.5">
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => goToPage(page - 1)} disabled={navigationBusy || page <= 1}>
                  Previous
                </Button>
                <span className="text-xs text-fg-muted">
                  Page {page} of {totalCount === null ? '…' : totalPages}
                </span>
                <Button variant="ghost" size="sm" onClick={() => goToPage(page + 1)} disabled={navigationBusy || Boolean(readError) || page >= totalPages}>
                  Next
                </Button>
              </div>
              <Select
                value={String(pageSize)}
                disabled={navigationBusy}
                onChange={(e) => {
                  const size = Number(e.target.value)
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
        </div>
        </div>
      {bulkEditSnapshot && (
        <BulkEditModal
          entries={bulkEditSnapshot}
          projects={projects}
          activityTypes={activityTypes}
          isSessionCurrent={isSessionCurrent}
          onClose={() => setBulkEditSnapshot(null)}
          onMutationStart={() => {
            if (!canUseSnapshots() || historyContext.current.scope !== scope || !bulkEditSnapshot.length || bulkEditSnapshot.length > 500 ||
              !bulkEditSnapshot.every(row => canModifyRow(row) && !rowLocks.has(row.id))) return false
            setBulkMutationActive(true)
            clearSelection()
            for (const row of bulkEditSnapshot) setRowBusy(row.id, true)
            return true
          }}
          onMutationEnd={() => {
            setBulkMutationActive(false)
            for (const row of bulkEditSnapshot) setRowBusy(row.id, false)
          }}
          onReconcile={() => isSessionCurrent() ? refreshEntries() : Promise.resolve(false)}
        />
      )}
      {newDraft && <Dialog open onClose={() => setNewDraft(null)} ariaLabel="Classify copied entry">
        <div className="w-full max-w-lg">
          <Button variant="secondary" onClick={() => setNewDraft(null)}>Cancel draft</Button>
          <TimeEntryForm today={today} minLogDate={minLogDate} projects={projects} activityTypes={activityTypes} initialDraft={newDraft} onLogged={() => { setNewDraft(null); void refreshEntries() }} />
        </div>
      </Dialog>}
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
