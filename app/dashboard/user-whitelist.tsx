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
import { Alert, Button, Card, EmptyState, IconButton, Input, RoleBadge, Select, TableFrame, Td, Th } from '@/app/components/ui'
import { Dialog } from '@/app/components/dialog'
import { PromptDialog } from '@/app/components/confirm'
import { toast } from '@/app/components/toast'
import { IconPencil, IconUsers } from '@/app/components/icons'
import { leaderUsers, reportToOptions } from '@/lib/hierarchy'

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
  const [nameEditTarget, setNameEditTarget] = useState<User | null>(null)
  const [departmentEditTarget, setDepartmentEditTarget] = useState<User | null>(null)
  const [titleBusyUserId, setTitleBusyUserId] = useState<string | null>(null)

  const { data: dynamicTitles } = useAsyncData<string[]>(
    async () => {
      const { data: titles, error } = await dataClient.getTitles()
      return { data: titles, error: error ? { message: error } : null }
    },
    []
  )
  const availableTitles = dynamicTitles && dynamicTitles.length > 0 ? dynamicTitles : [...TITLES]

  const query = search.trim().toLowerCase()
  const visibleUsers = useMemo(() => {
    if (!query) return allUsers
    return allUsers.filter(u =>
      (u.name || '').toLowerCase().includes(query) ||
      (u.email || '').toLowerCase().includes(query) ||
      (u.department || '').toLowerCase().includes(query) ||
      (u.title || '').toLowerCase().includes(query)
    )
  }, [allUsers, query])

  // Candidate managers/team leads for the "Reports to" column.
  const leaders = useMemo(() => leaderUsers(allUsers), [allUsers])

  const handleManagerChange = async (u: User, managerId: string) => {
    const { error } = await dataClient.setUserManager(u.id, managerId || null)
    if (error) toast(error, 'error')
    else {
      onChanged()
      toast(`Reporting line updated for ${u.email}.`, 'success')
    }
  }

  const handleTitleChange = async (u: User, title: string) => {
    setTitleBusyUserId(u.id)
    try {
      const { error } = await dataClient.updateUserHierarchy(u.id, {
        managerId: u.manager_id ?? null,
        title,
      })
      if (error) toast(error, 'error')
      else {
        onChanged()
        toast(`Title updated for ${u.email}.`, 'success')
      }
    } finally {
      setTitleBusyUserId(null)
    }
  }

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
      toast('User status updated.', 'success')
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

  const handleRolesChange = async (
    userId: string,
    permissionRole: PermissionRole,
    hierarchyRole: HierarchyRole
  ) => {
    const { error } = await dataClient.updateUserRoles(userId, permissionRole, hierarchyRole)
    if (error) toast(error, 'error')
    else {
      onChanged()
      toast('Roles updated.', 'success')
    }
  }

  const handleEditName = async (userId: string, next: string) => {
    const { error } = await dataClient.updateUserName(userId, next)
    if (error) toast(error, 'error')
    else {
      onChanged()
      toast('Name updated.', 'success')
    }
  }

  const handleEditDepartment = async (userId: string, next: string) => {
    const { error } = await dataClient.updateUserDepartment(userId, next)
    if (error) toast(error, 'error')
    else {
      onChanged()
      toast('Department updated.', 'success')
    }
  }

  return (
    <Card
      title="User Whitelist"
      subtitle="Manage titles, roles, reporting lines, and account activation"
      icon={<IconUsers className="h-4.5 w-4.5" />}
      bodyClassName="p-0"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <Input
          type="search"
          placeholder="Search by name, email, department or title…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="max-w-xs"
          aria-label="Search users"
        />
        <span className="text-xs text-fg-muted">
          {query ? `${visibleUsers.length} of ${allUsers.length} user(s)` : `${allUsers.length} user(s)`}
        </span>
      </div>
      {leaders.length === 0 && (
        <Alert tone="warning" className="m-4">
          No managers or team leads yet — set a user&apos;s Hierarchy Role to Manager or Team Lead to enable
          the &quot;Reports to&quot; dropdown.
        </Alert>
      )}
      <TableFrame className="table-stack">
        <thead className="border-b border-border bg-muted/60">
          <tr>
            <Th>Name</Th>
            <Th>Email</Th>
            <Th>Department</Th>
            <Th>Title</Th>
            <Th>Roles</Th>
            <Th>Reports to</Th>
            <Th className="text-center">Status</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {visibleUsers.map(u => (
            <tr key={u.id} className="transition-colors hover:bg-muted/70">
              <Td label="Name" className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="font-medium text-fg">{u.name || '—'}</span>
                  <IconButton
                    label={`Edit name for ${u.email}`}
                    size="sm"
                    tone="primary"
                    className="min-h-11 min-w-11 md:min-h-9 md:min-w-9"
                    onClick={() => setNameEditTarget(u)}
                  >
                    <IconPencil className="h-3.5 w-3.5" />
                  </IconButton>
                </div>
              </Td>
              <Td label="Email" className="text-fg-muted">{u.email}</Td>
              <Td label="Department" className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-fg-muted">{u.department || '—'}</span>
                  <IconButton
                    label={`Edit department for ${u.email}`}
                    size="sm"
                    tone="primary"
                    className="min-h-11 min-w-11 md:min-h-9 md:min-w-9"
                    onClick={() => setDepartmentEditTarget(u)}
                  >
                    <IconPencil className="h-3.5 w-3.5" />
                  </IconButton>
                </div>
              </Td>
              <Td label="Title" className="min-w-0">
                <Select
                  value={u.title || ''}
                  disabled={titleBusyUserId === u.id}
                  onChange={(e) => void handleTitleChange(u, e.target.value)}
                  aria-label={`Title for ${u.email}`}
                  className="w-auto max-w-48 text-xs disabled:cursor-wait disabled:opacity-50"
                >
                  <option value="">— Unassigned —</option>
                  {u.title && !availableTitles.includes(u.title) && (
                    <option value={u.title}>{u.title} (current)</option>
                  )}
                  {availableTitles.map((title) => (
                    <option key={title} value={title}>{title}</option>
                  ))}
                </Select>
              </Td>
              <Td label="Roles" className="min-w-0">
                <div className="flex items-center gap-2">
                  <RoleBadge role={u.role} />
                  <div className="flex flex-col gap-1">
                    <Select
                      value={u.permission_role}
                      disabled={u.id === selfId}
                      onChange={(e) => handleRolesChange(u.id, e.target.value as PermissionRole, u.hierarchy_role)}
                      title="Permission role (what the user can do)"
                      aria-label={`Permission role for ${u.email}`}
                      className="text-xs disabled:opacity-40"
                    >
                      {Object.entries(PERMISSION_ROLE_LABELS).map(([v, label]) => (
                        <option key={v} value={v}>{label}</option>
                      ))}
                    </Select>
                    <Select
                      value={u.hierarchy_role}
                      disabled={u.id === selfId}
                      onChange={(e) => handleRolesChange(u.id, u.permission_role, e.target.value as HierarchyRole)}
                      title="Hierarchy role (reporting position)"
                      aria-label={`Hierarchy role for ${u.email}`}
                      className="text-xs disabled:opacity-40"
                    >
                      {Object.entries(HIERARCHY_ROLE_LABELS).map(([v, label]) => (
                        <option key={v} value={v}>{label}</option>
                      ))}
                    </Select>
                  </div>
                </div>
              </Td>
              <Td label="Reports to" className="min-w-0">
                <Select
                  value={u.manager_id ?? ''}
                  disabled={u.id === selfId}
                  onChange={e => handleManagerChange(u, e.target.value)}
                  title={u.id === selfId ? 'You cannot change your own reporting line here' : undefined}
                  aria-label={`Reports to for ${u.email}`}
                  className="max-w-44 text-xs disabled:opacity-40"
                >
                  <option value="">— None —</option>
                  {reportToOptions(u, allUsers).map(l => (
                    <option key={l.id} value={l.id}>{l.name || l.email}</option>
                  ))}
                </Select>
              </Td>
              <Td label="Status" className="text-center">
                <button
                  type="button"
                  aria-label={`${u.is_active ? 'Active: deactivate' : 'Inactive: activate'} ${u.email}`}
                  onClick={() => handleToggleStatus(u)}
                  disabled={u.id === selfId && u.is_active}
                  title={u.id === selfId && u.is_active ? 'You cannot deactivate your own account' : undefined}
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset transition disabled:cursor-not-allowed disabled:opacity-40 ${
                    u.is_active
                      ? 'bg-success-surface text-success-text ring-success-ring'
                      : 'bg-muted text-fg-muted ring-border hover:bg-border'
                  }`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${u.is_active ? 'bg-success-text' : 'bg-fg-subtle'}`} />
                  {u.is_active ? 'Active' : 'Inactive'}
                </button>
              </Td>
            </tr>
          ))}
          {visibleUsers.length === 0 && (
            <tr>
              <td colSpan={7} className="p-4">
                <EmptyState title="No matching users" description={`No users match "${search.trim()}".`} className="py-6" />
              </td>
            </tr>
          )}
        </tbody>
      </TableFrame>

      <PromptDialog
        open={nameEditTarget !== null}
        title="Edit Full Name"
        label="Full name"
        initialValue={nameEditTarget?.name ?? ''}
        placeholder="e.g. Jane Doe"
        submitLabel="Save"
        onSubmit={(value) => {
          if (nameEditTarget) void handleEditName(nameEditTarget.id, value)
        }}
        onClose={() => setNameEditTarget(null)}
      />

      <PromptDialog
        open={departmentEditTarget !== null}
        title="Edit Department"
        label="Department"
        initialValue={departmentEditTarget?.department ?? ''}
        placeholder="e.g. Engineering"
        required={false}
        submitLabel="Save"
        onSubmit={(value) => {
          if (departmentEditTarget) void handleEditDepartment(departmentEditTarget.id, value)
        }}
        onClose={() => setDepartmentEditTarget(null)}
      />

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
