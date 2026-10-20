// app/dashboard/user-whitelist.tsx
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { dataClient } from '@/lib/data/client'
import { readTimesheetHistory } from '@/lib/dashboard-timesheets'
import { downloadCSV } from '@/lib/csv'
import { TIMESHEET_CSV_HEADERS, timesheetCsvRows } from '@/lib/reports'
import { HierarchyRole, PermissionRole, User } from '../types'
import { TITLES } from '../constants'
import { useAsyncData } from '../hooks'
import { HIERARCHY_ROLE_LABELS, PERMISSION_ROLE_LABELS } from '@/lib/roles'
import { Button, Card, Checkbox, EmptyState, Field, Input, RoleBadge, Select, initialsOf } from '@/app/components/ui'
import { Dialog } from '@/app/components/dialog'
import { toast } from '@/app/components/toast'
import { IconCheck, IconUsers } from '@/app/components/icons'
import { leaderUsers, reportToOptions } from '@/lib/hierarchy'
import { useDepartments } from './department-select'

const NO_DEPT = '__none__'
const INACTIVE_PREVIEW = 8
/** Roles an admin limited to some departments may grant. */
const SCOPED_PERMISSIONS: PermissionRole[] = ['pm', 'user']

export default function UserWhitelist({
  allUsers,
  selfId,
  onChanged,
  isSessionCurrent,
}: {
  allUsers: User[]
  selfId?: string
  onChanged: () => void
  isSessionCurrent: () => boolean
}) {
  // User pending deactivation — opens the entries-handling confirmation modal.
  const [pendingUser, setPendingUser] = useState<User | null>(null)
  const [deactivating, setDeactivating] = useState(false)
  const deactivationLock = useRef(false)
  const generation = useRef(0)
  useEffect(() => () => { generation.current++ }, [])
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all')
  const [departmentFilter, setDepartmentFilter] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const { departments } = useDepartments()

  const { data: dynamicTitles } = useAsyncData<string[]>(
    async () => {
      const { data: titles, error } = await dataClient.getTitles()
      return { data: titles, error: error ? { message: error } : null }
    },
    []
  )
  const availableTitles = dynamicTitles && dynamicTitles.length > 0 ? dynamicTitles : [...TITLES]

  const self = allUsers.find(u => u.id === selfId)
  const myScope = self?.scope_departments?.length ? self.scope_departments : null
  const orgAdmin = self?.permission_role === 'admin' && !myScope
  const allDepartmentNames = departments.map(d => d.name)
  const departmentNames = myScope ?? allDepartmentNames

  const query = search.trim().toLowerCase()
  const visibleUsers = useMemo(() => allUsers.filter(u =>
    (statusFilter === 'all' || u.is_active === (statusFilter === 'active')) &&
    (!departmentFilter || (u.department || '') === (departmentFilter === NO_DEPT ? '' : departmentFilter)) &&
    (!query || [u.name, u.email, u.department, u.title].some(v => (v || '').toLowerCase().includes(query)))
  ), [allUsers, query, statusFilter, departmentFilter])
  const inactiveUsers = useMemo(() => allUsers.filter(u => !u.is_active), [allUsers])
  const selected = allUsers.find(u => u.id === selectedId) ?? visibleUsers[0] ?? null

  // Candidate managers/team leads for the "Reports to" field.
  const leaders = useMemo(() => leaderUsers(allUsers), [allUsers])

  const handleToggleStatus = (u: User) => {
    if (u.is_active) {
      // Deactivating: ask what to do with the user's entries first.
      setPendingUser(u)
      return
    }
    // Reactivating: direct toggle.
    void reactivate(u)
  }

  const reactivate = async (u: User) => {
    const { error } = await dataClient.toggleUserStatus(u.id)
    if (error) toast(error, 'error')
    else {
      onChanged()
      toast(`${u.name || u.email} is now active.`, 'success')
    }
  }

  const confirmDeactivate = async (mode: 'keep' | 'export' | 'delete') => {
    const u = pendingUser
    if (!isSessionCurrent() || !u || deactivationLock.current) return
    deactivationLock.current = true
    setDeactivating(true)
    const current = ++generation.current
    try {

    if (mode === 'export') {
      // Export the user's entries as CSV before deactivating.
      try {
      const rows = await readTimesheetHistory(query => dataClient.getTimesheets(query, { deduplicate: false }), { userId: u.id }, () => current === generation.current && isSessionCurrent())
      if (current !== generation.current || !isSessionCurrent()) return
      if (rows.length > 0) {
        const safe = u.email.replace(/[^a-z0-9@._-]/gi, '_')
        downloadCSV(`timesheets-${safe}.csv`, TIMESHEET_CSV_HEADERS, timesheetCsvRows(rows))
        toast(`Exported ${rows.length} entries to CSV.`, 'success')
      } else {
        toast('No entries to export.', 'info')
      }
      } catch (error) {
        if (current === generation.current) toast(error instanceof Error ? error.message : 'Could not export complete history. User remains active.', 'error')
        return
      }
    } else if (mode === 'delete') {
      const { error } = await dataClient.deleteUserTimesheets(u.id)
      if (error) {
        toast(error, 'error')
        return
      }
      toast('User entries deleted.', 'success')
    }

    if (current !== generation.current || !isSessionCurrent()) return
    const { error } = await dataClient.toggleUserStatus(u.id)
    if (error) toast(error, 'error')
    else {
      onChanged()
      toast('User deactivated.', 'success')
      setPendingUser(null)
    }
    } catch (error) {
      if (current === generation.current && isSessionCurrent()) toast(error instanceof Error ? error.message : 'Could not confirm deactivation.', 'error')
    } finally { deactivationLock.current = false; setDeactivating(false) }
  }

  return (
    <Card
      title="Users"
      subtitle="Activate new accounts, then set each person's department, role and reporting line"
      icon={<IconUsers className="h-4.5 w-4.5" />}
      bodyClassName="p-0"
    >
      {inactiveUsers.length > 0 && (
        <section aria-labelledby="inactive-heading" className="border-b border-border bg-warning-surface px-4 py-3">
          <h3 id="inactive-heading" className="text-sm font-semibold text-warning-text">
            {inactiveUsers.length === 1 ? '1 account is not active' : `${inactiveUsers.length} accounts are not active`}
          </h3>
          <p className="text-xs text-warning-text">New sign-ups wait here until you activate them.</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {inactiveUsers.slice(0, INACTIVE_PREVIEW).map(u => (
              <li key={u.id} className="flex items-center gap-2 rounded-lg border border-border bg-card py-1 pl-2.5 pr-1 text-sm">
                <button type="button" onClick={() => setSelectedId(u.id)} className="max-w-56 truncate text-left text-fg hover:underline">
                  {u.name || u.email}
                </button>
                <Button size="sm" variant="success" onClick={() => void reactivate(u)} aria-label={`Activate ${u.email}`}>
                  <IconCheck className="h-3.5 w-3.5" /> Activate
                </Button>
              </li>
            ))}
            {inactiveUsers.length > INACTIVE_PREVIEW && (
              <li>
                <Button size="sm" variant="ghost" onClick={() => setStatusFilter('inactive')}>Show all {inactiveUsers.length}</Button>
              </li>
            )}
          </ul>
        </section>
      )}

      <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(340px,420px)]">
        <div className="min-w-0 lg:border-r lg:border-border">
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
            <Input
              type="search"
              placeholder="Search name, email, department or title"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="min-w-48 flex-1"
              aria-label="Search users"
            />
            <Select value={statusFilter} onChange={e => setStatusFilter(e.target.value as typeof statusFilter)} aria-label="Filter by status" className="w-auto">
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Not active</option>
            </Select>
            <Select value={departmentFilter} onChange={e => setDepartmentFilter(e.target.value)} aria-label="Filter by department" className="w-auto max-w-44">
              <option value="">All departments</option>
              <option value={NO_DEPT}>No department</option>
              {departmentNames.map(n => <option key={n} value={n}>{n}</option>)}
            </Select>
          </div>
          <p className="px-4 pt-2 text-xs text-fg-muted" aria-live="polite">
            {visibleUsers.length === allUsers.length ? `${allUsers.length} people` : `Showing ${visibleUsers.length} of ${allUsers.length} people`}
          </p>
          {visibleUsers.length === 0 ? (
            <EmptyState title="No one matches these filters" description="Clear the search or pick another status or department." className="py-8" />
          ) : (
            <ul className="max-h-[38rem] space-y-0.5 overflow-y-auto p-2" aria-label="People">
              {visibleUsers.map(u => {
                const isSelected = selected?.id === u.id
                return (
                  <li key={u.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(u.id)}
                      aria-pressed={isSelected}
                      aria-label={`${u.name || u.email}, ${u.email}`}
                      className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors ${isSelected ? 'bg-primary-600/10 ring-1 ring-inset ring-primary-600/40' : 'hover:bg-muted'}`}
                    >
                      <span aria-hidden className={`relative grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-semibold ${u.is_active ? 'bg-muted text-fg' : 'bg-warning-surface text-warning-text'}`}>
                        {initialsOf(u.name, u.email)}
                        <span className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-card ${u.is_active ? 'bg-success-text' : 'bg-fg-subtle'}`} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-fg">{u.name || u.email}</span>
                        <span className={`block truncate text-xs ${isSelected ? 'text-fg' : 'text-fg-muted'}`}>
                          {[u.title, u.department || 'No department'].filter(Boolean).join(', ')}
                        </span>
                      </span>
                      <RoleBadge role={u.role} className="hidden sm:inline-flex" />
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="border-t border-border lg:border-t-0">
          {selected ? (
            <UserEditor
              key={editorKey(selected)}
              user={selected}
              isSelf={selected.id === selfId}
              orgAdmin={orgAdmin}
              scopedAdmin={!!myScope}
              departmentNames={departmentNames}
              allDepartmentNames={allDepartmentNames}
              titles={availableTitles}
              reportOptions={reportToOptions(selected, allUsers)}
              noLeaders={leaders.length === 0}
              onSaved={onChanged}
              onToggleStatus={() => handleToggleStatus(selected)}
            />
          ) : (
            <p className="p-6 text-sm text-fg-muted">Pick a person to see and change their details.</p>
          )}
        </div>
      </div>

      {pendingUser && (
        <Dialog
          open
          onClose={() => { if (!deactivationLock.current) setPendingUser(null) }}
          labelledBy="deactivate-dialog-title"
          describedBy="deactivate-dialog-desc"
          className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-card"
        >
          <h3 id="deactivate-dialog-title" className="text-lg font-semibold text-fg">
            Deactivate {pendingUser.email}?
          </h3>
          <p id="deactivate-dialog-desc" className="mt-1 text-sm text-fg-muted">
            Choose what happens to this user&apos;s timesheet entries:
          </p>
          <div className="mt-4 space-y-2">
            {deactivating && <p role="status" className="text-sm text-fg-muted">Preparing complete history and updating status…</p>}
            <Button disabled={deactivating} variant="secondary" className="w-full" onClick={() => confirmDeactivate('keep')}>
              Keep entries as-is (archive)
            </Button>
            <Button disabled={deactivating} variant="secondary" className="w-full" onClick={() => confirmDeactivate('export')}>
              Export entries to CSV, then deactivate
            </Button>
            <Button disabled={deactivating} variant="danger" className="w-full" onClick={() => confirmDeactivate('delete')}>
              Delete all entries, then deactivate
            </Button>
            <Button disabled={deactivating} variant="ghost" className="w-full" onClick={() => setPendingUser(null)}>
              Cancel
            </Button>
          </div>
        </Dialog>
      )}
    </Card>
  )
}

/** Remounts the editor (dropping the draft) whenever the saved user changes. */
function editorKey(u: User): string {
  return [u.id, u.name, u.department, u.title, u.permission_role, u.hierarchy_role, u.manager_id, (u.scope_departments ?? []).join('|')].join('\u0000')
}

/** Edits one person; nothing is saved until "Save changes". */
function UserEditor({
  user, isSelf, orgAdmin, scopedAdmin, departmentNames, allDepartmentNames, titles, reportOptions, noLeaders, onSaved, onToggleStatus,
}: {
  user: User
  isSelf: boolean
  orgAdmin: boolean
  scopedAdmin: boolean
  departmentNames: string[]
  allDepartmentNames: string[]
  titles: string[]
  reportOptions: User[]
  noLeaders: boolean
  onSaved: () => void
  onToggleStatus: () => void
}) {
  const initial = {
    name: user.name || '',
    department: user.department || '',
    title: user.title || '',
    permission: user.permission_role,
    hierarchy: user.hierarchy_role,
    managerId: user.manager_id ?? '',
    scope: user.scope_departments ?? [],
  }
  type Draft = typeof initial
  const [draft, setDraft] = useState(initial)
  const [saving, setSaving] = useState(false)
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft(d => ({ ...d, [key]: value }))
  const changed = (k: keyof Draft) => JSON.stringify(draft[k]) !== JSON.stringify(initial[k])
  const dirty = (Object.keys(initial) as (keyof Draft)[]).some(changed)
  const canHaveScope = draft.permission === 'admin' || draft.permission === 'co'
  const permissionOptions = (Object.keys(PERMISSION_ROLE_LABELS) as PermissionRole[])
    .filter(r => !scopedAdmin || SCOPED_PERMISSIONS.includes(r) || r === user.permission_role)
  const departmentOptions = draft.department && !departmentNames.includes(draft.department)
    ? [draft.department, ...departmentNames] : departmentNames

  const save = async () => {
    setSaving(true)
    const steps: [boolean, () => Promise<{ error: string | null }>][] = [
      [changed('name') && !!draft.name.trim(), () => dataClient.updateUserName(user.id, draft.name.trim())],
      [changed('department'), () => dataClient.updateUserDepartment(user.id, draft.department)],
      [changed('permission') || changed('hierarchy'), () => dataClient.updateUserRoles(user.id, draft.permission, draft.hierarchy)],
      [changed('title') || changed('managerId'), () => dataClient.updateUserHierarchy(user.id, { managerId: draft.managerId || null, title: draft.title })],
      [orgAdmin && (changed('scope') || (changed('permission') && !canHaveScope && initial.scope.length > 0)),
        () => dataClient.setDepartmentScope(user.id, canHaveScope ? draft.scope : [])],
    ]
    try {
      for (const [due, run] of steps) {
        if (!due) continue
        const { error } = await run()
        if (error) { toast(error, 'error'); return }
      }
      toast(`Saved changes for ${user.name || user.email}.`, 'success')
    } finally {
      setSaving(false)
      onSaved()
    }
  }

  return (
    <form className="flex h-full flex-col" onSubmit={e => { e.preventDefault(); void save() }} aria-label={`Details for ${user.email}`}>
      <header className="flex items-start gap-3 border-b border-border px-5 py-4">
        <span aria-hidden className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-primary-600 text-sm font-semibold text-white">
          {initialsOf(user.name, user.email)}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold text-fg">{user.name || 'No name yet'}</h3>
          <p className="truncate text-sm text-fg-muted">{user.email}</p>
        </div>
        <button
          type="button"
          aria-label={`${user.is_active ? 'Active: deactivate' : 'Inactive: activate'} ${user.email}`}
          onClick={onToggleStatus}
          disabled={isSelf && user.is_active}
          title={isSelf && user.is_active ? 'You cannot deactivate your own account' : user.is_active ? 'Deactivate this account' : 'Activate this account'}
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset transition disabled:cursor-not-allowed disabled:opacity-40 ${
            user.is_active ? 'bg-success-surface text-success-text ring-success-ring' : 'bg-muted text-fg-muted ring-border hover:bg-border'
          }`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${user.is_active ? 'bg-success-text' : 'bg-fg-subtle'}`} />
          {user.is_active ? 'Active' : 'Not active'}
        </button>
      </header>

      <div className="flex-1 space-y-6 px-5 py-4">
        <fieldset className="space-y-3">
          <legend className="mb-1 text-sm font-semibold text-fg">Who they are</legend>
          <Field label="Full name">
            <Input value={draft.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Jane Doe" required />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Department">
              <Select value={draft.department} onChange={e => set('department', e.target.value)}>
                <option value="">No department</option>
                {departmentOptions.map(n => <option key={n} value={n}>{n}</option>)}
              </Select>
            </Field>
            <Field label="Title">
              <Select value={draft.title} onChange={e => set('title', e.target.value)}>
                <option value="">Unassigned</option>
                {draft.title && !titles.includes(draft.title) && <option value={draft.title}>{draft.title}</option>}
                {titles.map(t => <option key={t} value={t}>{t}</option>)}
              </Select>
            </Field>
          </div>
        </fieldset>

        <fieldset className="space-y-3" disabled={isSelf}>
          <legend className="mb-1 text-sm font-semibold text-fg">What they can do</legend>
          {isSelf && <p className="text-xs text-fg-muted">You cannot change your own role or reporting line.</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Permission">
              <Select value={draft.permission} onChange={e => set('permission', e.target.value as PermissionRole)} aria-label={`Permission role for ${user.email}`} className="disabled:opacity-50">
                {permissionOptions.map(r => (
                  <option key={r} value={r} disabled={scopedAdmin && !SCOPED_PERMISSIONS.includes(r)}>{PERMISSION_ROLE_LABELS[r]}</option>
                ))}
              </Select>
            </Field>
            <Field label="Position in org tree">
              <Select value={draft.hierarchy} onChange={e => set('hierarchy', e.target.value as HierarchyRole)} aria-label={`Hierarchy role for ${user.email}`} className="disabled:opacity-50">
                {Object.entries(HIERARCHY_ROLE_LABELS).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
              </Select>
            </Field>
          </div>
          <Field label="Reports to">
            <Select value={draft.managerId} onChange={e => set('managerId', e.target.value)} aria-label={`Reports to for ${user.email}`} className="disabled:opacity-50">
              <option value="">No one</option>
              {reportOptions.map(l => <option key={l.id} value={l.id}>{l.name || l.email}</option>)}
            </Select>
          </Field>
          {noLeaders && <p className="text-xs text-fg-muted">To pick a manager here, first set someone&apos;s position to Manager or Team Lead.</p>}
        </fieldset>

        {orgAdmin && canHaveScope && !isSelf && (
          <fieldset className="space-y-2 rounded-lg border border-border p-3">
            <legend className="px-1 text-sm font-semibold text-fg">Department access</legend>
            <p className="text-xs text-fg-muted">
              {draft.scope.length === 0
                ? 'No limit: sees and manages people in every department. Tick departments to limit access.'
                : `Sees and manages only people in ${draft.scope.length === 1 ? draft.scope[0] : `these ${draft.scope.length} departments`}. Org-wide settings are hidden.`}
            </p>
            {allDepartmentNames.length === 0 ? (
              <p className="text-xs text-fg-muted">Add departments under Administration, Departments first.</p>
            ) : (
              <div className="grid gap-x-3 sm:grid-cols-2">
                {allDepartmentNames.map(n => (
                  <Checkbox
                    key={n}
                    label={n}
                    checked={draft.scope.includes(n)}
                    onChange={e => set('scope', e.target.checked ? [...draft.scope, n] : draft.scope.filter(x => x !== n))}
                  />
                ))}
              </div>
            )}
          </fieldset>
        )}
      </div>

      <footer className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-border bg-card px-5 py-3">
        {dirty && <span className="mr-auto text-xs text-fg-muted">Unsaved changes</span>}
        <Button type="button" variant="ghost" disabled={!dirty || saving} onClick={() => setDraft(initial)}>Discard</Button>
        <Button type="submit" disabled={!dirty || saving}>{saving ? 'Saving…' : 'Save changes'}</Button>
      </footer>
    </form>
  )
}
