// app/dashboard/hierarchy-editor.tsx
// Admin feature: View, search, and update reporting structures, system roles,
// and titles across the organization with circular reporting loop prevention.
'use client'

import { useMemo, useState } from 'react'
import { getTitles, updateUserHierarchy } from '../actions'
import { useAsyncData } from '../hooks'
import { User, UserRole } from '../types'
import { ROLES, ROLE_LABELS, TITLES, roleForTitle } from '../constants'
import { reportToOptions } from '@/lib/hierarchy'
import { Button, Card, Field, Input, Select } from '@/app/components/ui'
import { toast } from '@/app/components/toast'
import { IconUsers } from '@/app/components/icons'

export default function HierarchyEditor({
  users,
  onChanged,
}: {
  users: User[]
  onChanged: () => void
}) {
  const [hierarchySearch, setHierarchySearch] = useState('')
  const [hierarchyEdits, setHierarchyEdits] = useState<
    Record<string, { title: string; role: UserRole; managerId: string }>
  >({})
  const [savingUserId, setSavingUserId] = useState<string | null>(null)

  // Fetch dynamic titles from DB; fallback to default constant
  const { data: dynamicTitles } = useAsyncData<string[]>(
    async () => {
      const { titles: t, error } = await getTitles()
      return { data: t && t.length > 0 ? t : [...TITLES], error: error ? { message: error } : null }
    },
    []
  )
  const availableTitles = dynamicTitles && dynamicTitles.length > 0 ? dynamicTitles : [...TITLES]

  const getUserEditState = (u: User) => {
    return (
      hierarchyEdits[u.id] ?? {
        title: u.title || availableTitles[0] || 'Systems Engineer',
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

    // Auto-sync role when title changes
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

    // Reject a contradictory title+role (e.g. title "Manager" with role
    // "user") before round-tripping to the server.
    if (roleForTitle(edit.title, edit.role) !== edit.role) {
      toast(
        `Role "${edit.role}" is inconsistent with the title "${edit.title}". Set the title to "Manager" or "Team Lead" to grant a leadership role (or use an admin/pm/co role).`,
        'error'
      )
      return
    }

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
    <Card
      title="Organizational Hierarchy"
      subtitle="Manage titles, system roles, and reporting lines across the organization"
      icon={<IconUsers className="h-4.5 w-4.5" />}
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Field label="" className="max-w-md flex-1">
            <Input
              placeholder="Search user by name, email, department or title…"
              value={hierarchySearch}
              onChange={(e) => setHierarchySearch(e.target.value)}
              className="text-xs"
            />
          </Field>
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
                <th className="px-3.5 py-2.5">Reports To</th>
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
                        {availableTitles.map((t) => (
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
              {filteredUsers.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3.5 py-6 text-center text-xs text-slate-400">
                    No users match &quot;{hierarchySearch.trim()}&quot;.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Card>
  )
}
