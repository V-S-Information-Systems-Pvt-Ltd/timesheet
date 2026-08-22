// app/dashboard/add-user-form.tsx
'use client'

import { useState } from 'react'
import { addUser, getTitles } from '../actions'
import { useAsyncData } from '../hooks'
import { HierarchyRole, PermissionRole, User } from '../types'
import { TITLES } from '../constants'
import { HIERARCHY_ROLE_LABELS, PERMISSION_ROLE_LABELS } from '@/lib/roles'
import { Button, Card, Field, Input, Select } from '@/app/components/ui'
import { toast } from '@/app/components/toast'
import { IconPlus } from '@/app/components/icons'
import { leaderUsers } from '@/lib/hierarchy'

export default function AddUserForm({
  users = [],
  onChanged,
}: {
  /** All visible users (admins) — used for the optional reporting line. */
  users?: User[]
  onChanged: () => void
}) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [department, setDepartment] = useState('')
  const [title, setTitle] = useState('')
  const [permissionRole, setPermissionRole] = useState<PermissionRole>('user')
  const [hierarchyRole, setHierarchyRole] = useState<HierarchyRole>('user')
  const [managerId, setManagerId] = useState('')
  const [active, setActive] = useState(true)

  const { data: dynamicTitles } = useAsyncData<string[]>(
    async () => {
      const { titles: t, error } = await getTitles()
      return { data: t && t.length > 0 ? t : [...TITLES], error: error ? { message: error } : null }
    },
    []
  )
  const availableTitles = dynamicTitles && dynamicTitles.length > 0 ? dynamicTitles : [...TITLES]

  const leaders = leaderUsers(users)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const { error } = await addUser({
      name,
      email,
      password,
      department,
      title,
      permissionRole,
      hierarchyRole,
      isActive: active,
      managerId: managerId || null,
    })
    if (error) toast(error, 'error')
    else {
      setName(''); setEmail(''); setPassword(''); setDepartment(''); setTitle('')
      setPermissionRole('user'); setHierarchyRole('user'); setManagerId(''); setActive(true)
      onChanged()
      toast('User added successfully!', 'success')
    }
  }

  return (
    <Card
      title="Add User"
      subtitle="Create an account and set its role"
      icon={<IconPlus className="h-4.5 w-4.5" />}
    >
      <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
        <Field label="Full Name">
          <Input placeholder="Jane Doe" value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Field label="Email">
          <Input type="email" placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="Temporary Password" className="sm:col-span-2">
          <Input type="password" placeholder="At least 6 characters" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <Field label="Department">
          <Input placeholder="Engineering" value={department} onChange={(e) => setDepartment(e.target.value)} />
        </Field>
        <Field label="Title">
          <Select value={title} onChange={(e) => setTitle(e.target.value)}>
            {availableTitles.map(t => <option key={t} value={t}>{t}</option>)}
          </Select>
        </Field>
        <Field label="Permission Role" hint="What the user is allowed to do">
          <Select value={permissionRole} onChange={(e) => setPermissionRole(e.target.value as PermissionRole)}>
            {Object.entries(PERMISSION_ROLE_LABELS).map(([v, label]) => (
              <option key={v} value={v}>{label}</option>
            ))}
          </Select>
        </Field>
        <Field label="Hierarchy Role" hint="Reporting position in the org">
          <Select value={hierarchyRole} onChange={(e) => setHierarchyRole(e.target.value as HierarchyRole)}>
            {Object.entries(HIERARCHY_ROLE_LABELS).map(([v, label]) => (
              <option key={v} value={v}>{label}</option>
            ))}
          </Select>
        </Field>
        <Field label="Reports to">
          {leaders.length === 0 ? (
            <p className="text-xs text-amber-600">
              No managers or team leads yet — set a user&apos;s Hierarchy Role to “Manager” or “Team Lead” first.
            </p>
          ) : (
            <Select
              value={managerId}
              onChange={(e) => setManagerId(e.target.value)}
            >
              <option value="">— None —</option>
              {leaders.map(l => (
                <option key={l.id} value={l.id}>{l.name || l.email}</option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Status">
          <label className="flex h-[38px] cursor-pointer items-center gap-2.5 rounded-lg border border-slate-300 bg-white px-3 shadow-sm">
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-primary-600 accent-primary-600"
            />
            <span className="text-sm text-slate-700">Active</span>
          </label>
        </Field>
        <Button type="submit" className="sm:col-span-2">
          <IconPlus className="h-4 w-4" /> Add User
        </Button>
      </form>
    </Card>
  )
}
