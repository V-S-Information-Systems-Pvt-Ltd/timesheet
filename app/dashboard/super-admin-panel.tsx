// app/dashboard/super-admin-panel.tsx
// Super-admin only (SUPER_ADMIN_EMAIL): destructive data-lifecycle controls —
// database reset (3 modes), permanent user deletion, permanent activity-type
// deletion. The dashboard renders this only when amISuperAdmin() is true.
'use client'

import { useState } from 'react'
import { deleteActivityType, deleteUser, resetDatabase } from '../actions'
import { useAsyncData } from '../hooks'
import { dataClient } from '@/lib/data/client'
import { ActivityType, AdminDashboardLayout, DashboardLayout, User } from '../types'
import { Badge, Button, Card, Field, Select } from '@/app/components/ui'
import { toast } from '@/app/components/toast'
import { IconAlert, IconTrash, IconUsers } from '@/app/components/icons'
import DefaultPanelOrder from './default-panel-order'

export default function SuperAdminPanel({
  users,
  defaultLayouts,
  onDefaultsChanged,
  onChanged,
}: {
  users: User[]
  defaultLayouts: { dashboard: DashboardLayout; admin: AdminDashboardLayout } | null
  onDefaultsChanged: (l: { dashboard: DashboardLayout; admin: AdminDashboardLayout }) => void
  onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [deleteUserId, setDeleteUserId] = useState('')
  const [deleteTypeId, setDeleteTypeId] = useState('')

  const { data: types, reload: reloadTypes } = useAsyncData<ActivityType[]>(
    async () => {
      const { data, error } = await dataClient.getAllActivityTypes()
      return { data, error: error ? { message: error } : null }
    },
    []
  )
  const activityTypes = types ?? []

  const handleReset = async (mode: 'timesheets' | 'activity' | 'all') => {
    const code = mode === 'all' ? 'RESET ALL' : 'RESET'
    const typed = prompt(`This wipes data. Type "${code}" to confirm:`)
    if (typed === null) return
    if (typed.trim() !== code) {
      toast('Reset cancelled — confirmation text did not match.', 'info')
      return
    }
    setBusy(true)
    try {
      const { error } = await resetDatabase(mode)
      if (error) toast(error, 'error')
      else {
        toast('Database reset complete.', 'success')
        onChanged()
      }
    } finally {
      setBusy(false)
    }
  }

  const handleDeleteUser = async () => {
    if (!deleteUserId) return
    const target = users.find(u => u.id === deleteUserId)
    if (!confirm(`Permanently delete ${target?.email ?? 'this user'} and all of their entries? This cannot be undone.`)) return
    setBusy(true)
    try {
      const { error } = await deleteUser(deleteUserId)
      if (error) toast(error, 'error')
      else {
        setDeleteUserId('')
        toast('User deleted.', 'success')
        onChanged()
      }
    } finally {
      setBusy(false)
    }
  }

  const handleDeleteType = async () => {
    if (!deleteTypeId) return
    const target = activityTypes.find(t => t.id === deleteTypeId)
    if (!confirm(`Permanently delete activity type "${target?.name}"? Existing entries keep their data (the type becomes unset).`)) return
    setBusy(true)
    try {
      const { error } = await deleteActivityType(deleteTypeId)
      if (error) toast(error, 'error')
      else {
        setDeleteTypeId('')
        toast('Activity type deleted.', 'success')
        reloadTypes()
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card
      title="Super Admin"
      subtitle="Destructive operations — available only to the configured super-admin account"
      icon={<IconAlert className="h-4.5 w-4.5" />}
    >
      <div className="space-y-6">
        <div>
          <h3 className="mb-2 text-sm font-semibold text-slate-800">Reset database</h3>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => handleReset('timesheets')}>
              Reset timesheets
            </Button>
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => handleReset('activity')}>
              Reset activity data
            </Button>
            <Button variant="danger" size="sm" disabled={busy} onClick={() => handleReset('all')}>
              Full factory reset
            </Button>
          </div>
          <p className="mt-1.5 text-xs text-slate-400">
            Timesheets: deletes all entries. Activity data: entries, leave, reminders (activity types re-seeded).
            Factory reset: everything except your own account, then defaults re-seeded.
          </p>
        </div>

        <div className="border-t border-slate-100 pt-5">
          <h3 className="mb-2 text-sm font-semibold text-slate-800">Remove user</h3>
          <div className="flex flex-wrap items-end gap-2">
            <Field label="User" className="min-w-64 flex-1">
              <Select value={deleteUserId} onChange={e => setDeleteUserId(e.target.value)}>
                <option value="">Select user…</option>
                {users.map(u => (
                  <option key={u.id} value={u.id}>
                    {u.email} ({u.name || 'no name'})
                  </option>
                ))}
              </Select>
            </Field>
            <Button variant="danger" size="sm" disabled={busy || !deleteUserId} onClick={handleDeleteUser}>
              <IconTrash className="h-3.5 w-3.5" /> Delete
            </Button>
          </div>
        </div>

        <div className="border-t border-slate-100 pt-5">
          <h3 className="mb-2 text-sm font-semibold text-slate-800">Remove activity type</h3>
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Activity type" className="min-w-64 flex-1">
              <Select value={deleteTypeId} onChange={e => setDeleteTypeId(e.target.value)}>
                <option value="">Select type…</option>
                {activityTypes.map(t => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Button variant="danger" size="sm" disabled={busy || !deleteTypeId} onClick={handleDeleteType}>
              <IconTrash className="h-3.5 w-3.5" /> Delete
            </Button>
          </div>
        </div>

        <div className="border-t border-slate-100 pt-5">
          <h3 className="mb-2 text-sm font-semibold text-slate-800">Default panel order</h3>
          <p className="mb-3 text-xs text-slate-400">
            Group-wide default order/visibility for the user dashboard and the admin panel. Users
            who haven&apos;t customized their own panels inherit these defaults.
          </p>
          <DefaultPanelOrder defaultLayouts={defaultLayouts} onSaved={onDefaultsChanged} />
        </div>

        <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
          <IconUsers className="mr-1 inline h-3.5 w-3.5" />
          {users.length} user(s) · {activityTypes.length} activity type(s)
          {users.filter(u => !u.is_active).length > 0 && (
            <Badge tone="slate" className="ml-2">{users.filter(u => !u.is_active).length} inactive</Badge>
          )}
        </div>
      </div>
    </Card>
  )
}