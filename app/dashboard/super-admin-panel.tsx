// app/dashboard/super-admin-panel.tsx
// Super-admin only (SUPER_ADMIN_EMAIL):
//  1. Email Domain Whitelist (self-registration & auto-activation management)
//  2. Manage Standard Titles (Add / Remove system titles)
//  3. Destructive Lifecycle Controls (database reset, permanent deletions)
'use client'

import { useState } from 'react'
import {
  addTitle,
  addWhitelistedDomain,
  deleteActivityType,
  deleteTitle,
  deleteUser,
  deleteWhitelistedDomain,
  getTitles,
  getWhitelistedDomains,
  resetDatabase,
  toggleDomainAutoActivate,
} from '../actions'
import { useAsyncData } from '../hooks'
import { dataClient } from '@/lib/data/client'
import { ActivityType, AdminDashboardLayout, DashboardLayout, User, WhitelistedDomain } from '../types'
import { TITLES } from '../constants'
import { Badge, Button, Card, Field, Input, Select } from '@/app/components/ui'
import { ConfirmDialog } from '@/app/components/confirm'
import { toast } from '@/app/components/toast'
import { IconAlert, IconCheck, IconPlus, IconTrash, IconUsers } from '@/app/components/icons'
import DefaultPanelOrder from './default-panel-order'

/** A destructive action awaiting typed confirmation. */
interface PendingDestructive {
  title: string
  message: string
  confirmLabel: string
  /** Token the super-admin must type (email, name, or code). */
  confirmValue?: string
  action: () => Promise<void>
}

export default function SuperAdminPanel({
  users,
  selfEmail,
  defaultLayouts,
  onDefaultsChanged,
  onChanged,
}: {
  users: User[]
  /** Email of the acting super-admin; required to unlock the factory reset. */
  selfEmail?: string
  defaultLayouts: { dashboard: DashboardLayout; admin: AdminDashboardLayout } | null
  onDefaultsChanged: (l: { dashboard: DashboardLayout; admin: AdminDashboardLayout }) => void
  onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [deleteUserId, setDeleteUserId] = useState('')
  const [deleteTypeId, setDeleteTypeId] = useState('')
  const [pending, setPending] = useState<PendingDestructive | null>(null)

  // Domain Whitelist State
  const [newDomain, setNewDomain] = useState('')
  const [newDomainAutoActivate, setNewDomainAutoActivate] = useState(false)
  const [domainBusy, setDomainBusy] = useState(false)

  // Title Management State
  const [newTitle, setNewTitle] = useState('')
  const [titleBusy, setTitleBusy] = useState(false)

  const { data: domainList, reload: reloadDomains } = useAsyncData<WhitelistedDomain[]>(
    async () => {
      const { domains: d, error } = await getWhitelistedDomains()
      return { data: d ?? [], error: error ? { message: error } : null }
    },
    []
  )
  const domains = domainList ?? []

  const { data: titleList, reload: reloadTitles } = useAsyncData<string[]>(
    async () => {
      const { titles: t, error } = await getTitles()
      return { data: t && t.length > 0 ? t : [...TITLES], error: error ? { message: error } : null }
    },
    []
  )
  const titles = titleList ?? [...TITLES]

  const { data: types, reload: reloadTypes } = useAsyncData<ActivityType[]>(
    async () => {
      const { data, error } = await dataClient.getAllActivityTypes()
      return { data, error: error ? { message: error } : null }
    },
    []
  )
  const activityTypes = types ?? []

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

  const handleDeleteDomain = (d: WhitelistedDomain) => {
    setPending({
      title: 'Remove Whitelisted Domain',
      message: `Remove @${d.domain} from whitelisted domains? Users with that email will no longer be able to self-register.`,
      confirmLabel: 'Remove',
      confirmValue: d.domain,
      action: async () => {
        const { error } = await deleteWhitelistedDomain(d.id)
        if (error) toast(error, 'error')
        else {
          toast(`Domain @${d.domain} removed.`, 'success')
          reloadDomains()
        }
      },
    })
  }

  // Title Management
  const handleAddTitle = async (e: React.FormEvent) => {
    e.preventDefault()
    const clean = newTitle.trim()
    if (!clean) return
    setTitleBusy(true)
    try {
      const { error } = await addTitle(clean)
      if (error) {
        toast(error, 'error')
      } else {
        toast(`Title "${clean}" added.`, 'success')
        setNewTitle('')
        reloadTitles()
      }
    } finally {
      setTitleBusy(false)
    }
  }

  const handleDeleteTitle = (t: string) => {
    setPending({
      title: 'Remove Standard Title',
      message: `Remove title "${t}" from standard titles? Existing user profiles with this title will retain their value.`,
      confirmLabel: 'Remove',
      confirmValue: t,
      action: async () => {
        setTitleBusy(true)
        try {
          const { error } = await deleteTitle(t)
          if (error) {
            toast(error, 'error')
          } else {
            toast(`Title "${t}" removed.`, 'success')
            reloadTitles()
          }
        } finally {
          setTitleBusy(false)
        }
      },
    })
  }

  // Destructive operations
  const handleReset = (mode: 'timesheets' | 'activity' | 'all') => {
    const scope =
      mode === 'timesheets'
        ? 'all timesheet entries'
        : mode === 'activity'
          ? 'entries, leave, and reminders (activity types are re-seeded)'
          : 'everything except your own account, then defaults are re-seeded'
    setPending({
      title: mode === 'all' ? 'Full Factory Reset' : 'Reset Database',
      message:
        mode === 'all'
          ? `This permanently wipes ${scope}.\n\nType your account email to confirm.`
          : `This permanently deletes ${scope}.\n\nType RESET to confirm.`,
      confirmLabel: 'Reset',
      confirmValue: mode === 'all' ? (selfEmail ?? '') : 'RESET',
      action: async () => {
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
      },
    })
  }

  const handleDeleteUser = () => {
    if (!deleteUserId) return
    const target = users.find((u) => u.id === deleteUserId)
    setPending({
      title: 'Permanently Delete User',
      message: `Permanently delete ${target?.email ?? 'this user'} and all of their entries? This cannot be undone.\n\nType the user's email to confirm.`,
      confirmLabel: 'Delete User',
      confirmValue: target?.email ?? '',
      action: async () => {
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
      },
    })
  }

  const handleDeleteType = () => {
    if (!deleteTypeId) return
    const target = activityTypes.find((t) => t.id === deleteTypeId)
    setPending({
      title: 'Delete Activity Type',
      message: `Permanently delete activity type "${target?.name}"? Existing entries keep their data (the type becomes unset).\n\nType the type name to confirm.`,
      confirmLabel: 'Delete Type',
      confirmValue: target?.name ?? '',
      action: async () => {
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
      },
    })
  }

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
              <label className="flex h-[38px] cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 shadow-sm">
                <input
                  type="checkbox"
                  checked={newDomainAutoActivate}
                  onChange={(e) => setNewDomainAutoActivate(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-primary-600 accent-primary-600"
                />
                <span className="text-xs font-medium text-slate-700">
                  Activate Automatically
                </span>
              </label>
            </Field>

            <Button type="submit" size="md" disabled={domainBusy || !newDomain.trim()}>
              <IconPlus className="h-4 w-4" /> Add Domain
            </Button>
          </form>

          <div className="overflow-hidden rounded-xl border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
              <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-3">Domain</th>
                  <th className="px-4 py-3">Auto-Activate Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {domains.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-4 py-6 text-center text-xs text-slate-400">
                      No email domains whitelisted yet. Users with any email will not be able to self-register.
                    </td>
                  </tr>
                ) : (
                  domains.map((d) => (
                    <tr key={d.id} className="hover:bg-slate-50/50">
                      <td className="px-4 py-3 font-medium text-slate-800">
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
                          <span className="text-[11px] text-slate-400 hover:text-slate-600 underline ml-1">
                            (click to toggle)
                          </span>
                        </button>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteDomain(d)}
                          className="text-rose-600 hover:text-rose-700 hover:bg-rose-50"
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

{/* 2. Super-Admin Standard Titles Management */}
      <Card
        title="Manage Titles"
        subtitle="Add or remove standard job titles available in the organizational hierarchy and user profiles"
        icon={<IconUsers className="h-4.5 w-4.5" />}
      >
        <div className="space-y-5">
          <form onSubmit={handleAddTitle} className="flex flex-wrap items-end gap-3">
            <Field label="New Title Name" className="min-w-64 flex-1">
              <Input
                placeholder="e.g. Lead Systems Architect"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                required
              />
            </Field>
            <Button type="submit" size="md" disabled={titleBusy || !newTitle.trim()}>
              <IconPlus className="h-4 w-4" /> Add Title
            </Button>
          </form>

          <div className="overflow-hidden rounded-xl border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
              <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-3">Title Name</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {titles.map((t) => (
                  <tr key={t} className="hover:bg-slate-50/50">
                    <td className="px-4 py-3 font-medium text-slate-800">
                      {t}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={titleBusy}
                        onClick={() => handleDeleteTitle(t)}
                        className="text-rose-600 hover:text-rose-700 hover:bg-rose-50"
                      >
                        <IconTrash className="h-3.5 w-3.5" /> Remove
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Card>

      {/* 3. Group defaults & system info */}
      <Card
        title="Default Panel Order & System Info"
        icon={<IconUsers className="h-4.5 w-4.5" />}
      >
        <div className="space-y-5">
          <div>
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

      {/* 3. Destructive Lifecycle Controls */}
      <Card
        title="Destructive System Operations"
        subtitle="Data-lifecycle controls — available only to the configured super-admin account"
        icon={<IconAlert className="h-4.5 w-4.5" />}
      >
        <div className="space-y-6">
          <div>
            <h3 className="mb-2 text-sm font-semibold text-slate-800">
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

          <div className="border-t border-slate-100 pt-5">
            <h3 className="mb-2 text-sm font-semibold text-slate-800">
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

          <div className="border-t border-slate-100 pt-5">
            <h3 className="mb-2 text-sm font-semibold text-slate-800">
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

          <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
            <IconUsers className="mr-1 inline h-3.5 w-3.5" />
            {users.length} user(s) · {activityTypes.length} activity type(s) · {domains.length} whitelisted domain(s) · {titles.length} title(s)
            {users.filter((u) => !u.is_active).length > 0 && (
              <Badge tone="slate" className="ml-2">
                {users.filter((u) => !u.is_active).length} inactive
              </Badge>
            )}
          </div>
        </div>
      </Card>

      <ConfirmDialog
        open={pending !== null}
        title={pending?.title ?? ''}
        message={pending?.message ?? ''}
        confirmLabel={pending?.confirmLabel ?? 'Confirm'}
        confirmValue={pending?.confirmValue}
        onConfirm={() => {
          if (pending) void pending.action()
        }}
        onClose={() => setPending(null)}
      />
    </div>
  )
}