// app/dashboard/add-user-form.tsx
'use client'

import { useState } from 'react'
import { addUser } from '../actions'
import { User, UserRole } from '../types'
import { ROLES, TITLES, roleForTitle } from '../constants'
import { Button, Card, Field, Input, Select } from '@/app/components/ui'
import { toast } from '@/app/components/toast'
import { IconPlus } from '@/app/components/icons'
import { candidateManagers } from '@/lib/hierarchy'

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
  const [title, setTitle] = useState<string>(TITLES[2]) // Systems Engineer
  const [role, setRole] = useState<UserRole>('user')
  const [managerId, setManagerId] = useState('')
  const [active, setActive] = useState(true)

  const handleTitleChange = (newTitle: string) => {
    setTitle(newTitle)
    setRole(r => roleForTitle(newTitle, r))
  }

  const managerCandidates = candidateManagers(null, users)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const { error } = await addUser({
      name,
      email,
      password,
      department,
      title,
      role,
      isActive: active,
      managerId: managerId || null,
    })
    if (error) toast(error, 'error')
    else {
      setName(''); setEmail(''); setPassword(''); setDepartment(''); setTitle('')
      setRole('user'); setManagerId(''); setActive(true)
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
          <Select value={title} onChange={(e) => handleTitleChange(e.target.value)}>
            {TITLES.map(t => <option key={t} value={t}>{t}</option>)}
          </Select>
        </Field>
        <Field label="Role">
          <Select value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
            {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
          </Select>
        </Field>
        <Field label="Reports to">
          <Select
            value={managerId}
            onChange={(e) => setManagerId(e.target.value)}
          >
            <option value="">— None —</option>
            {managerCandidates.map(m => (
              <option key={m.id} value={m.id}>
                {m.name || m.email}{m.title ? ` (${m.title})` : ''}
              </option>
            ))}
          </Select>
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
