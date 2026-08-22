// app/dashboard/super-admin-panel.tsx
// Super-admin only (SUPER_ADMIN_EMAIL):
//  1. Email Domain Whitelist (self-registration & auto-activation management)
//  2. Organizational Hierarchy & Reporting Structure Editor (Titles & Managers)
//  3. Destructive Lifecycle Controls (database reset, permanent deletions)
'use client'

import { useMemo, useState } from 'react'
import {
  addWhitelistedDomain,
  deleteActivityType,
  deleteUser,
  deleteWhitelistedDomain,
  getWhitelistedDomains,
  resetDatabase,
  toggleDomainAutoActivate,
  updateUserHierarchy,
} from '../actions'
import { useAsyncData } from '../hooks'
import { dataClient } from '@/lib/data/client'
import { ActivityType, User, UserRole, WhitelistedDomain } from '../types'
import { ROLES, ROLE_LABELS, TITLES, roleForTitle } from '../constants'
import { reportToOptions } from '@/lib/hierarchy'
import { Badge, Button, Card, Field, Input, Select } from '@/app/components/ui'
import { toast } from '@/app/components/toast'
import { IconAlert, IconCheck, IconPlus, IconTrash, IconUsers } from '@/app/components/icons'

export default function SuperAdminPanel({
  users,
  onChanged,
}: {
  users: User[]
  onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [deleteUserId, setDeleteUserId] = useState('')
  const [deleteTypeId, setDeleteTypeId] = useState('')

  // Domain Whitelist State
  const [newDomain, setNewDomain] = useState('')
  const [newDomainAutoActivate, setNewDomainAutoActivate] = useState(false)
  const [domainBusy, setDomainBusy] = useState(false)

  // Hierarchy Editor State
  const [hierarchySearch, setHierarchySearch] = useState('')
  const [hierarchyEdits, setHierarchyEdits] = useState<
    Record<string, { title: string; role: UserRole; managerId: string }>
  >({})
  const [savingUserId, setSavingUserId] = useState<string | null>(null)

  const { data: domainList, reload: reloadDomains } = useAsyncData<WhitelistedDomain[]>(
    async () => {
      const { domains: d, error } = await getWhitelistedDomains()
      return { data: d ?? [], error: error ? { message: error } : null }
    },
    []
  )
  const domains = domainList ?? []

  const { data: types, reload: reloadTypes } = useAsyncData<ActivityType[]>(
    async () => {
      const { data, error } = await dataClient.getAllActivityTypes()
      return { data, error: error ? { message: error } : null }
    },
    []
  )
  const activityTypes = types ?? []

  // Initialize hierarchy edits map from current user state
  const getUserEditState = (u: User) => {
    return (
      hierarchyEdits[u.id] ?? {
        title: u.title || TITLES[2],
        role: u.role || 'user',
        managerId: u.manager_id || '',
      }
    )
  }

  const handleEditChange = (
    userId: string,
    field: 'title' | 'role' | 'managerId',
    value: string
  ) => {
    const current = getUserEditState(users.find((u) => u.id === userId)!)
    const updated = { ...current, [field]: value }

    // If title changed and role was not manually touched, auto-sync role
    if (field === 'title') {
      updated.role = roleForTitle(value, current.role)
    }

    setHierarchyEdits((prev) => ({
      ...prev,
      [userId]: updated,
    }))
  }

  const handleSaveUserHierarchy = async (u: User) => {
    const edit = getUserEditState(u)
    setSavingUserId(u.id)
    try {
      const { error } = await updateUserHierarchy(u.id, {
        managerId: edit.managerId || null,
        title: edit.title,
        role: edit.role,
      })
      if (error) {
        toast(error, 'error')
      } else {
        toast(`Hierarchy updated for ${u.email}`, 'success')
        // Clean edit override on success
        setHierarchyEdits((prev) => {
          const next = { ...prev }
          delete next[u.id]
          return next
        })
        onChanged()
      }
    } finally {
      setSavingUserId(null)
    }
  }

  // Add Domain
  const handleAddDomain = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newDomain.trim()) return
    setDomainBusy(true)
    try {
      const { error } = await addWhitelistedDomain(newDomain, newDomainAutoActivate)
      if (error) {
        toast(error, 'error')
      } else {
        toast(`Domain @${newDomain.trim()} whitelisted!`, 'success')
        setNewDomain('')
        setNewDomainAutoActivate(false)
        reloadDomains()
      }
    } finally {
      setDomainBusy(false)
    }
  }

  const handleToggleAutoActivate = async (d: WhitelistedDomain) => {
    const next = !d.auto_activate
    const { error } = await toggleDomainAutoActivate(d.id, next)
    if (error) toast(error, 'error')
    else {
      toast(`Auto-activation ${next ? 'enabled' : 'disabled'} for @${d.domain}`, 'success')
      reloadDomains()
    }
  }

  const handleDeleteDomain = async (d: WhitelistedDomain) => {
    if (!confirm(`Remove @${d.domain} from whitelisted domains?`)) return
    const { error } = await deleteWhitelistedDomain(d.id)
    if (error) toast(error, 'error')
    else {
      toast(`Domain @${d.domain} removed.`, 'success')
      reloadDomains()
    }
  }

  // Destructive operations
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
    const target = users.find((u) => u.id === deleteUserId)
    if (
      !confirm(
        `Permanently delete ${target?.email ?? 'this user'} and all of their entries? This cannot be undone.`
      )
    )
      return
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
    const target = activityTypes.find((t) => t.id === deleteTypeId)
    if (
      !confirm(
        `Permanently delete activity type "${target?.name}"? Existing entries keep their data (the type becomes unset).`
      )
    )
      return
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

  const filteredUsers = useMemo(() => {
    const q = hierarchySearch.trim().toLowerCase()
    if (!q) return users
    return users.filter(
      (u) =>
        (u.name || '').toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        (u.department || '').toLowerCase().includes(q) ||
        (u.title || '').toLowerCase().includes(q)
    )
  }, [users, hierarchySearch])

  return (
    <div className="space-y-6">
      {/* 1. Whitelisted Email Domains */}
      <Card
        title="Email Domain Whitelist"
        subtitle="Manage domains permitted for account registration with optional automatic activation"
        icon={<IconCheck className="h-4.5 w-4.5" />}
      >
        <div className="space-y-5">
          <form onSubmit={handleAddDomain} className="flex flex-wrap items-end gap-3">
            <Field label="Allow Domain" className="min-w-64 flex-1">
              <Input
                placeholder="company.com"
                value={newDomain}
                onChange={(e) => setNewDomain(e.target.value)}
                required
              />
            </Field>

            <Field label="Auto-Activation" className="shrink-0">
              <label className="flex h-[38px] cursor-pointer items-center gap-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 shadow-sm">
                <input
                  type="checkbox"
                  checked={newDomainAutoActivate}
                  onChange={(e) => setNewDomainAutoActivate(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-primary-600 accent-primary-600"
                />
                <span className="text-xs font-medium text-slate-700 dark:text-slate-200">
                  Activate Automatically
                </span>
              </label>
            </Field>

            <Button type="submit" size="md" disabled={domainBusy || !newDomain.trim()}>
              <IconPlus className="h-4 w-4" /> Add Domain
            </Button>
          </form>

          <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
            <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-800 text-left text-sm">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-xs font-semibold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-3">Domain</th>
                  <th className="px-4 py-3">Auto-Activate Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-900">
                {domains.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-4 py-6 text-center text-xs text-slate-400">
                      No email domains whitelisted yet. Users with any email will not be able to self-register.
                    </td>
                  </tr>
                ) : (
                  domains.map((d) => (
                    <tr key={d.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                      <td className="px-4 py-3 font-medium text-slate-800 dark:text-slate-200">
                        @{d.domain}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => handleToggleAutoActivate(d)}
                          className="inline-flex items-center gap-1.5 cursor-pointer"
                        >
                          {d.auto_activate ? (
                            <Badge tone="green">Auto-Active</Badge>
                          ) : (
                            <Badge tone="amber">Pending Approval</Badge>
                          )}
                          <span className="text-[11px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 underline ml-1">
                            (click to toggle)
                          </span>
                        </button>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteDomain(d)}
                          className="text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                        >
                          <IconTrash className="h-3.5 w-3.5" /> Remove
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </Card>

      {/* 2. Hierarchy & Reporting Structure Management */}
      <Card
        title="Edit Organizational Hierarchy"
        subtitle="Manage standard titles, system roles, and reporting lines across the organization"
        icon={<IconUsers className="h-4.5 w-4.5" />}
      >
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Input
              placeholder="Search user by name, email, department or title…"
              value={hierarchySearch}
              onChange={(e) => setHierarchySearch(e.target.value)}
              className="max-w-md text-xs"
            />
            <span className="text-xs text-slate-400">
              Showing {filteredUsers.length} of {users.length} users
            </span>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
            <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-800 text-left text-sm">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-3.5 py-2.5">User</th>
                  <th className="px-3.5 py-2.5">Title</th>
                  <th className="px-3.5 py-2.5">Role</th>
                  <th className="px-3.5 py-2.5">Reports To (Manager)</th>
                  <th className="px-3.5 py-2.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-900">
                {filteredUsers.map((u) => {
                  const edit = getUserEditState(u)
                  const managerOptions = reportToOptions(u, users)
                  const isDirty =
                    (u.title || '') !== edit.title ||
                    u.role !== edit.role ||
                    (u.manager_id || '') !== edit.managerId

                  return (
                    <tr key={u.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                      <td className="px-3.5 py-3">
                        <div className="font-medium text-slate-800 dark:text-slate-100">
                          {u.name || 'No name'}
                        </div>
                        <div className="text-xs text-slate-400">{u.email}</div>
                        {u.department && (
                          <div className="text-[11px] text-slate-400">{u.department}</div>
                        )}
                      </td>
                      <td className="px-3.5 py-3 min-w-48">
                        <Select
                          value={edit.title}
                          onChange={(e) => handleEditChange(u.id, 'title', e.target.value)}
                          className="text-xs py-1.5"
                        >
                          {TITLES.map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </Select>
                      </td>
                      <td className="px-3.5 py-3 min-w-32">
                        <Select
                          value={edit.role}
                          onChange={(e) =>
                            handleEditChange(u.id, 'role', e.target.value as UserRole)
                          }
                          className="text-xs py-1.5"
                        >
                          {ROLES.map((r) => (
                            <option key={r} value={r}>
                              {ROLE_LABELS[r] ?? r}
                            </option>
                          ))}
                        </Select>
                      </td>
                      <td className="px-3.5 py-3 min-w-56">
                        <Select
                          value={edit.managerId}
                          onChange={(e) => handleEditChange(u.id, 'managerId', e.target.value)}
                          className="text-xs py-1.5"
                        >
                          <option value="">— None (Top-level) —</option>
                          {managerOptions.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name ? `${m.name} (${m.email})` : m.email}
                              {m.title ? ` - ${m.title}` : ''}
                            </option>
                          ))}
                        </Select>
                      </td>
                      <td className="px-3.5 py-3 text-right">
                        <Button
                          variant={isDirty ? 'primary' : 'ghost'}
                          size="sm"
                          disabled={!isDirty || savingUserId === u.id}
                          onClick={() => handleSaveUserHierarchy(u)}
                        >
                          {savingUserId === u.id ? 'Saving…' : 'Save'}
                        </Button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </Card>

      {/* 3. Destructive Lifecycle Controls */}
      <Card
        title="Destructive System Operations"
        subtitle="Data-lifecycle controls — available only to the configured super-admin account"
        icon={<IconAlert className="h-4.5 w-4.5" />}
      >
        <div className="space-y-6">
          <div>
            <h3 className="mb-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
              Reset database
            </h3>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() => handleReset('timesheets')}
              >
                Reset timesheets
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() => handleReset('activity')}
              >
                Reset activity data
              </Button>
              <Button
                variant="danger"
                size="sm"
                disabled={busy}
                onClick={() => handleReset('all')}
              >
                Full factory reset
              </Button>
            </div>
            <p className="mt-1.5 text-xs text-slate-400">
              Timesheets: deletes all entries. Activity data: entries, leave, reminders (activity types re-seeded).
              Factory reset: everything except your own account, then defaults re-seeded.
            </p>
          </div>

          <div className="border-t border-slate-100 dark:border-slate-800 pt-5">
            <h3 className="mb-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
              Remove user
            </h3>
            <div className="flex flex-wrap items-end gap-2">
              <Field label="User" className="min-w-64 flex-1">
                <Select
                  value={deleteUserId}
                  onChange={(e) => setDeleteUserId(e.target.value)}
                >
                  <option value="">Select user…</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.email} ({u.name || 'no name'})
                    </option>
                  ))}
                </Select>
              </Field>
              <Button
                variant="danger"
                size="sm"
                disabled={busy || !deleteUserId}
                onClick={handleDeleteUser}
              >
                <IconTrash className="h-3.5 w-3.5" /> Delete
              </Button>
            </div>
          </div>

          <div className="border-t border-slate-100 dark:border-slate-800 pt-5">
            <h3 className="mb-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
              Remove activity type
            </h3>
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Activity type" className="min-w-64 flex-1">
                <Select
                  value={deleteTypeId}
                  onChange={(e) => setDeleteTypeId(e.target.value)}
                >
                  <option value="">Select type…</option>
                  {activityTypes.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button
                variant="danger"
                size="sm"
                disabled={busy || !deleteTypeId}
                onClick={handleDeleteType}
              >
                <IconTrash className="h-3.5 w-3.5" /> Delete
              </Button>
            </div>
          </div>

          <div className="rounded-lg bg-slate-50 dark:bg-slate-800/50 px-3 py-2 text-xs text-slate-500">
            <IconUsers className="mr-1 inline h-3.5 w-3.5" />
            {users.length} user(s) · {activityTypes.length} activity type(s) · {domains.length} whitelisted domain(s)
            {users.filter((u) => !u.is_active).length > 0 && (
              <Badge tone="slate" className="ml-2">
                {users.filter((u) => !u.is_active).length} inactive
              </Badge>
            )}
          </div>
        </div>
      </Card>
    </div>
  )
}