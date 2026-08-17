// app/dashboard/user-whitelist.tsx
'use client'

import { useState } from 'react'
import { deleteUserTimesheets, toggleUserStatus, updateUserRole, updateUserName } from '../actions'
import { dataClient } from '@/lib/data/client'
import { downloadCSV } from '@/lib/csv'
import { TIMESHEET_CSV_HEADERS, timesheetCsvRows } from '@/lib/reports'
import { User, UserRole } from '../types'
import { ROLES } from '../constants'
import { Button, Card, RoleBadge, Td, Th } from '@/app/components/ui'
import { toast } from '@/app/components/toast'
import { IconPencil, IconUsers } from '@/app/components/icons'

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
      const { data } = await dataClient.getTimesheets()
      const rows = (data ?? []).filter(t => t.user_id === u.id)
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

  const handleRoleChange = async (userId: string, newRole: UserRole) => {
    const { error } = await updateUserRole(userId, newRole)
    if (error) toast(error, 'error')
    else {
      onChanged()
      toast('Role updated.', 'success')
    }
  }

  const handleEditName = async (userId: string, current: string) => {
    const next = prompt('Full name', current)
    if (next === null || !next.trim() || next.trim() === current) return
    const { error } = await updateUserName(userId, next)
    if (error) toast(error, 'error')
    else {
      onChanged()
      toast('Name updated.', 'success')
    }
  }

  return (
    <Card
      title="User Whitelist"
      subtitle="Manage roles and account activation"
      icon={<IconUsers className="h-4.5 w-4.5" />}
      bodyClassName="p-0"
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-100 bg-slate-50/60">
            <tr>
              <Th>Name</Th>
              <Th>Email</Th>
              <Th>Department</Th>
              <Th>Title</Th>
              <Th>Role</Th>
              <Th className="text-center">Status</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {allUsers.map(u => (
              <tr key={u.id} className="transition-colors hover:bg-slate-50/70">
                <Td>
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium text-slate-800">{u.name || '—'}</span>
                    <button
                      onClick={() => handleEditName(u.id, u.name || '')}
                      title="Edit full name"
                      className="rounded p-0.5 text-slate-400 transition hover:bg-slate-100 hover:text-primary-600"
                    >
                      <IconPencil className="h-3.5 w-3.5" />
                      <span className="sr-only">Edit name</span>
                    </button>
                  </div>
                </Td>
                <Td className="text-slate-500">{u.email}</Td>
                <Td className="text-slate-500">{u.department || '—'}</Td>
                <Td className="text-slate-500">{u.title || '—'}</Td>
                <Td>
                  <div className="flex items-center gap-2">
                    <RoleBadge role={u.role} />
                    <select
                      value={u.role}
                      disabled={u.id === selfId}
                      onChange={(e) => handleRoleChange(u.id, e.target.value as UserRole)}
                      className="cursor-pointer rounded-md border border-slate-200 bg-white px-1.5 py-1 text-xs text-slate-600 disabled:opacity-40"
                    >
                      {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                </Td>
                <Td className="text-center">
                  <button
                    onClick={() => handleToggleStatus(u)}
                    disabled={u.id === selfId && u.is_active}
                    title={u.id === selfId && u.is_active ? 'You cannot deactivate your own account' : undefined}
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset transition disabled:cursor-not-allowed disabled:opacity-40 ${
                      u.is_active
                        ? 'bg-emerald-50 text-emerald-700 ring-emerald-200 hover:bg-emerald-100'
                        : 'bg-slate-100 text-slate-500 ring-slate-200 hover:bg-slate-200'
                    }`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${u.is_active ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                    {u.is_active ? 'Active' : 'Inactive'}
                  </button>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pendingUser && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={() => setPendingUser(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-card"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-slate-900">
              Deactivate {pendingUser.email}?
            </h3>
            <p className="mt-1 text-sm text-slate-500">
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
          </div>
        </div>
      )}
    </Card>
  )
}
