// app/dashboard/user-whitelist.tsx
'use client'

import { useMemo, useState } from 'react'
import {
  deleteUserTimesheets,
  getTitles,
  setUserManager,
  toggleUserStatus,
  updateUserDepartment,
  updateUserHierarchy,
  updateUserRoles,
  updateUserName,
} from '../actions'
import { dataClient } from '@/lib/data/client'
import { downloadCSV } from '@/lib/csv'
import { TIMESHEET_CSV_HEADERS, timesheetCsvRows } from '@/lib/reports'
import { HierarchyRole, PermissionRole, User } from '../types'
import { TITLES } from '../constants'
import { useAsyncData } from '../hooks'
import { HIERARCHY_ROLE_LABELS, PERMISSION_ROLE_LABELS } from '@/lib/roles'
import { Button, Card, Input, RoleBadge, Td, Th } from '@/app/components/ui'
import { Dialog } from '@/app/components/dialog'
import { PromptDialog } from '@/app/components/confirm'
import { toast } from '@/app/components/toast'
import { IconPencil, IconUsers } from '@/app/components/icons'
import { leaderUsers, reportToOptions } from '@/lib/hierarchy'

export default function UserWhitelist({
  allUsers,
  selfId,
  onChanged,
}: {
  allUsers: User[]
  selfId?: string
  onChanged: () => void
}) {
  // User pending deactivation — opens the entries-handling confirmation modal.
  const [pendingUser, setPendingUser] = useState<User | null>(null)
  const [search, setSearch] = useState('')
  const [nameEditTarget, setNameEditTarget] = useState<User | null>(null)
  const [departmentEditTarget, setDepartmentEditTarget] = useState<User | null>(null)
  const [titleBusyUserId, setTitleBusyUserId] = useState<string | null>(null)

  const { data: dynamicTitles } = useAsyncData<string[]>(
    async () => {
      const { titles, error } = await getTitles()
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
    const { error } = await setUserManager(u.id, managerId || null)
    if (error) toast(error, 'error')
    else {
      onChanged()
      toast(`Reporting line updated for ${u.email}.`, 'success')
    }
  }

  const handleTitleChange = async (u: User, title: string) => {
    setTitleBusyUserId(u.id)
    try {
      const { error } = await updateUserHierarchy(u.id, {
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
    const { error } = await toggleUserStatus(u.id)
    if (error) toast(error, 'error')
    else {
      onChanged()
      toast('User status updated.', 'success')
    }
  }

  const confirmDeactivate = async (mode: 'keep' | 'export' | 'delete') => {
    const u = pendingUser
    if (!u) return
    setPendingUser(null)

    if (mode === 'export') {
      // Export the user's entries as CSV before deactivating.
      const { data } = await dataClient.getTimesheets({ userId: u.id })
      const rows = data ?? []
      if (rows.length > 0) {
        const safe = u.email.replace(/[^a-z0-9@._-]/gi, '_')
        downloadCSV(`timesheets-${safe}.csv`, TIMESHEET_CSV_HEADERS, timesheetCsvRows(rows))
        toast(`Exported ${rows.length} entries to CSV.`, 'success')
      } else {
        toast('No entries to export.', 'info')
      }
    } else if (mode === 'delete') {
      const { error } = await deleteUserTimesheets(u.id)
      if (error) {
        toast(error, 'error')
        return
      }
      toast('User entries deleted.', 'success')
    }

    const { error } = await toggleUserStatus(u.id)
    if (error) toast(error, 'error')
    else {
      onChanged()
      toast('User deactivated.', 'success')
    }
  }

  const handleRolesChange = async (
    userId: string,
    permissionRole: PermissionRole,
    hierarchyRole: HierarchyRole
  ) => {
    const { error } = await updateUserRoles(userId, permissionRole, hierarchyRole)
    if (error) toast(error, 'error')
    else {
      onChanged()
      toast('Roles updated.', 'success')
    }
  }

  const handleEditName = async (userId: string, next: string) => {
    const { error } = await updateUserName(userId, next)
    if (error) toast(error, 'error')
    else {
      onChanged()
      toast('Name updated.', 'success')
    }
  }

  const handleEditDepartment = async (userId: string, next: string) => {
    const { error } = await updateUserDepartment(userId, next)
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
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <Input
          type="search"
          placeholder="Search by name, email, department or title…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="max-w-xs"
          aria-label="Search users"
        />
        <span className="text-xs text-slate-600">
          {query ? `${visibleUsers.length} of ${allUsers.length} user(s)` : `${allUsers.length} user(s)`}
        </span>
      </div>
      {leaders.length === 0 && (
        <div className="border-b border-amber-100 bg-amber-50 px-4 py-2 text-xs text-amber-700">
          No managers or team leads yet — set a user&apos;s Hierarchy Role to Manager or Team Lead to enable
          the &quot;Reports to&quot; dropdown.
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-100 bg-slate-50/60">
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
          <tbody className="divide-y divide-slate-100">
            {visibleUsers.map(u => (
              <tr key={u.id} className="transition-colors hover:bg-slate-50/70">
                <Td>
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium text-slate-800">{u.name || '—'}</span>
                    <button
                      type="button"
                      onClick={() => setNameEditTarget(u)}
                      title="Edit full name"
                      className="rounded p-0.5 text-slate-600 transition hover:bg-slate-100 hover:text-primary-600"
                    >
                      <IconPencil className="h-3.5 w-3.5" />
                      <span className="sr-only">Edit name</span>
                    </button>
                  </div>
                </Td>
                <Td className="text-slate-600">{u.email}</Td>
                <Td>
                  <div className="flex items-center gap-1.5">
                    <span className="text-slate-600">{u.department || '—'}</span>
                    <button
                      type="button"
                      onClick={() => setDepartmentEditTarget(u)}
                      title="Edit department"
                      aria-label={`Edit department for ${u.email}`}
                      className="rounded p-0.5 text-slate-600 transition hover:bg-slate-100 hover:text-primary-600"
                    >
                      <IconPencil className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </Td>
                <Td>
                  <select
                    value={u.title || ''}
                    disabled={titleBusyUserId === u.id}
                    onChange={(e) => void handleTitleChange(u, e.target.value)}
                    aria-label={`Title for ${u.email}`}
                    className="max-w-48 cursor-pointer rounded-md border border-slate-200 bg-white px-1.5 py-1 text-xs text-slate-600 disabled:cursor-wait disabled:opacity-50"
                  >
                    <option value="">— Unassigned —</option>
                    {u.title && !availableTitles.includes(u.title) && (
                      <option value={u.title}>{u.title} (current)</option>
                    )}
                    {availableTitles.map((title) => (
                      <option key={title} value={title}>{title}</option>
                    ))}
                  </select>
                </Td>
                <Td>
                  <div className="flex items-center gap-2">
                    <RoleBadge role={u.role} />
                    <div className="flex flex-col gap-1">
                      <select
                        value={u.permission_role}
                        disabled={u.id === selfId}
                        onChange={(e) => handleRolesChange(u.id, e.target.value as PermissionRole, u.hierarchy_role)}
                        title="Permission role (what the user can do)"
                        aria-label={`Permission role for ${u.email}`}
                        className="cursor-pointer rounded-md border border-slate-200 bg-white px-1.5 py-1 text-xs text-slate-600 disabled:opacity-40"
                      >
                        {Object.entries(PERMISSION_ROLE_LABELS).map(([v, label]) => (
                          <option key={v} value={v}>{label}</option>
                        ))}
                      </select>
                      <select
                        value={u.hierarchy_role}
                        disabled={u.id === selfId}
                        onChange={(e) => handleRolesChange(u.id, u.permission_role, e.target.value as HierarchyRole)}
                        title="Hierarchy role (reporting position)"
                        aria-label={`Hierarchy role for ${u.email}`}
                        className="cursor-pointer rounded-md border border-slate-200 bg-white px-1.5 py-1 text-xs text-slate-600 disabled:opacity-40"
                      >
                        {Object.entries(HIERARCHY_ROLE_LABELS).map(([v, label]) => (
                          <option key={v} value={v}>{label}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </Td>
                <Td>
                  <select
                    value={u.manager_id ?? ''}
                    disabled={u.id === selfId}
                    onChange={e => handleManagerChange(u, e.target.value)}
                    title={u.id === selfId ? 'You cannot change your own reporting line here' : undefined}
                    aria-label={`Reports to for ${u.email}`}
                    className="max-w-44 cursor-pointer rounded-md border border-slate-200 bg-white px-1.5 py-1 text-xs text-slate-600 disabled:opacity-40"
                  >
                    <option value="">— None —</option>
                    {reportToOptions(u, allUsers).map(l => (
                      <option key={l.id} value={l.id}>{l.name || l.email}</option>
                    ))}
                  </select>
                </Td>
                <Td className="text-center">
                  <button
                    onClick={() => handleToggleStatus(u)}
                    disabled={u.id === selfId && u.is_active}
                    title={u.id === selfId && u.is_active ? 'You cannot deactivate your own account' : undefined}
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset transition disabled:cursor-not-allowed disabled:opacity-40 ${
                      u.is_active
                        ? 'bg-emerald-50 text-emerald-700 ring-emerald-200 hover:bg-emerald-100'
                        : 'bg-slate-100 text-slate-600 ring-slate-200 hover:bg-slate-200'
                    }`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${u.is_active ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                    {u.is_active ? 'Active' : 'Inactive'}
                  </button>
                </Td>
              </tr>
            ))}
            {visibleUsers.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-sm text-slate-600">
                  No users match &quot;{search.trim()}&quot;.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

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
          onClose={() => setPendingUser(null)}
          labelledBy="deactivate-dialog-title"
          describedBy="deactivate-dialog-desc"
          className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-card"
        >
          <h3 id="deactivate-dialog-title" className="text-lg font-semibold text-slate-900">
            Deactivate {pendingUser.email}?
          </h3>
          <p id="deactivate-dialog-desc" className="mt-1 text-sm text-slate-600">
            Choose what happens to this user&apos;s timesheet entries:
          </p>
          <div className="mt-4 space-y-2">
            <Button variant="secondary" className="w-full" onClick={() => confirmDeactivate('keep')}>
              Keep entries as-is (archive)
            </Button>
            <Button variant="secondary" className="w-full" onClick={() => confirmDeactivate('export')}>
              Export entries to CSV, then deactivate
            </Button>
            <Button variant="danger" className="w-full" onClick={() => confirmDeactivate('delete')}>
              Delete all entries, then deactivate
            </Button>
            <Button variant="ghost" className="w-full" onClick={() => setPendingUser(null)}>
              Cancel
            </Button>
          </div>
        </Dialog>
      )}
    </Card>
  )
}
