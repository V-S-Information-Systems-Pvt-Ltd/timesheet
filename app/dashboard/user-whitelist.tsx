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
import { Button, Card, Checkbox, EmptyState, Field, Input, RoleBadge, Select } from '@/app/components/ui'
import { EditorEmpty, EditorForm, EditorSection, ListToolbar, Monogram, PickList, PickRow, SplitPane } from '@/app/components/workspace'
import { dashboardHref } from '@/lib/navigation'
import { Dialog } from '@/app/components/dialog'
import { toast } from '@/app/components/toast'
import { IconCheck, IconPlus, IconUsers } from '@/app/components/icons'
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
      actions={<Button variant="secondary" size="sm" onClick={() => window.history.pushState(null, '', dashboardHref('admin', 'add-user'))}><IconPlus className="h-4 w-4" /> Add person</Button>}
    >
      {inactiveUsers.length > 0 && (
        <section aria-labelledby="inactive-heading" className="border-b border-line bg-warning-surface px-4 py-3">
          <h3 id="inactive-heading" className="text-sm font-semibold text-warning-text">
            {inactiveUsers.length === 1 ? '1 account is not active' : `${inactiveUsers.length} accounts are not active`}
          </h3>
          <p className="text-xs text-warning-text">New sign-ups wait here until you activate them.</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {inactiveUsers.slice(0, INACTIVE_PREVIEW).map(u => (
              <li key={u.id} className="flex items-center gap-2 rounded-control border border-border bg-card py-1 pl-2.5 pr-1 text-sm">
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

      <SplitPane
        list={<>
          <ListToolbar
            search={search}
            onSearch={setSearch}
            placeholder="Search name, email, department or title"
            shown={visibleUsers.length}
            total={allUsers.length}
            noun="people"
            filters={<>
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
            </>}
          />
          {visibleUsers.length === 0 ? (
            <EmptyState title="No one matches these filters" description="Clear the search or pick another status or department." className="py-8" />
          ) : (
            <PickList label="People">
              {visibleUsers.map(u => (
                <PickRow
                  key={u.id}
                  selected={selected?.id === u.id}
                  onSelect={() => setSelectedId(u.id)}
                  label={`${u.name || u.email}, ${u.email}`}
                  leading={<Monogram name={u.name} email={u.email} tone={u.is_active ? 'neutral' : 'warning'} dot={u.is_active} />}
                  title={u.name || u.email}
                  subtitle={[u.title, u.department || 'No department'].filter(Boolean).join(', ')}
                  trailing={<RoleBadge role={u.role} className="hidden sm:inline-flex" />}
                />
              ))}
            </PickList>
          )}
        </>}
        detail={selected ? (
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
          <EditorEmpty>Pick a person to see and change their details.</EditorEmpty>
        )}
      />

      {pendingUser && (
        <Dialog
          open
          onClose={() => { if (!deactivationLock.current) setPendingUser(null) }}
          labelledBy="deactivate-dialog-title"
          describedBy="deactivate-dialog-desc"
          className="w-full max-w-md rounded-sheet border border-line bg-card p-6"
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
      // The server drops the scope itself when the new permission can't hold one.
      [orgAdmin && canHaveScope && changed('scope'), () => dataClient.setDepartmentScope(user.id, draft.scope)],
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
    <EditorForm
      label={`Details for ${user.email}`}
      leading={<Monogram name={user.name} email={user.email} tone="primary" size="lg" />}
      title={user.name || 'No name yet'}
      subtitle={user.email}
      status={
        <button
          type="button"
          aria-label={`${user.is_active ? 'Active: deactivate' : 'Inactive: activate'} ${user.email}`}
          onClick={onToggleStatus}
          disabled={isSelf && user.is_active}
          title={isSelf && user.is_active ? 'You cannot deactivate your own account' : user.is_active ? 'Deactivate this account' : 'Activate this account'}
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset transition disabled:cursor-not-allowed disabled:opacity-40 ${
            user.is_active ? 'bg-success-surface text-success-text ring-success-ring' : 'bg-muted text-fg-muted ring-line hover:bg-border'
          }`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${user.is_active ? 'bg-success-text' : 'bg-fg-subtle'}`} />
          {user.is_active ? 'Active' : 'Not active'}
        </button>
      }
      dirty={dirty}
      saving={saving}
      onSubmit={() => void save()}
      onDiscard={() => setDraft(initial)}
    >
        <EditorSection title="Who they are">
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
        </EditorSection>

        <EditorSection title="What they can do" disabled={isSelf} note={isSelf ? 'You cannot change your own role or reporting line.' : undefined}>
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
        </EditorSection>

        {orgAdmin && canHaveScope && !isSelf && (
          <fieldset className="space-y-2 rounded-control border border-line p-3">
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

        {!isSelf && <PasswordReset user={user} />}
    </EditorForm>
  )
}

/** Admin password reset: email a reset link, or generate a password to hand over. */
function PasswordReset({ user }: { user: User }) {
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [generated, setGenerated] = useState<string | null>(null)
  const who = user.name || user.email

  const sendEmail = async () => {
    setBusy(true)
    const { data, error } = await dataClient.resetUserPassword(user.id, 'email')
    setBusy(false)
    if (error || data?.mode !== 'email') toast(error ?? 'Could not send the reset email.', 'error')
    else toast(`Password reset link sent to ${data.email}.`, 'success')
  }

  const generate = async () => {
    setBusy(true)
    const { data, error } = await dataClient.resetUserPassword(user.id, 'generate')
    setBusy(false)
    if (error || data?.mode !== 'generate') {
      toast(error ?? 'Could not generate a password.', 'error')
      setConfirming(false)
      return
    }
    setGenerated(data.password)
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(generated ?? '')
      toast('Password copied.', 'success')
    } catch {
      toast('Could not copy. Select the password and copy it manually.', 'error')
    }
  }

  const close = () => { if (!busy) { setConfirming(false); setGenerated(null) } }

  return (
    <EditorSection title="Password" note="Send a reset link, or set a new password and give it to them yourself.">
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => void sendEmail()}>
          Email reset link
        </Button>
        <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => setConfirming(true)}>
          Generate new password
        </Button>
      </div>

      {confirming && (
        <Dialog
          open
          onClose={close}
          labelledBy="password-dialog-title"
          describedBy="password-dialog-desc"
          className="w-full max-w-md rounded-sheet border border-line bg-card p-6"
        >
          <h3 id="password-dialog-title" className="text-lg font-semibold text-fg">
            {generated ? `New password for ${who}` : `Generate a new password for ${who}?`}
          </h3>
          {generated ? (
            <>
              <p id="password-dialog-desc" className="mt-1 text-sm text-fg-muted">
                Give this to {who}. It is shown only once; they can change it after signing in.
              </p>
              <output aria-label="Generated password" className="mt-4 block select-all rounded-control border border-line bg-muted px-3 py-2 font-mono text-base tracking-wide text-fg">
                {generated}
              </output>
              <div className="mt-4 flex gap-2">
                <Button type="button" className="flex-1" onClick={() => void copy()}>Copy password</Button>
                <Button type="button" variant="ghost" className="flex-1" onClick={close}>Done</Button>
              </div>
            </>
          ) : (
            <>
              <p id="password-dialog-desc" className="mt-1 text-sm text-fg-muted">
                Their current password stops working and they are signed out on every device.
              </p>
              <div className="mt-4 flex gap-2">
                <Button type="button" variant="danger" className="flex-1" disabled={busy} onClick={() => void generate()}>
                  {busy ? 'Generating…' : 'Generate password'}
                </Button>
                <Button type="button" variant="ghost" className="flex-1" disabled={busy} onClick={close}>Cancel</Button>
              </div>
            </>
          )}
        </Dialog>
      )}
    </EditorSection>
  )
}
