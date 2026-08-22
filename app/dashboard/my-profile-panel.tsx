// app/dashboard/my-profile-panel.tsx
'use client'

import { useState } from 'react'
import { getTitles, updateMyProfile } from '../actions'
import { useAsyncData } from '../hooks'
import { User } from '../types'
import { TITLES } from '../constants'
import { Button, Card, Field, Input, Select } from '@/app/components/ui'
import { toast } from '@/app/components/toast'
import { IconUsers } from '@/app/components/icons'

export default function MyProfilePanel({ profile, onSaved }: { profile: User; onSaved: () => void }) {
  const [department, setDepartment] = useState(profile.department || '')
  const [title, setTitle] = useState(profile.title || TITLES[2])
  const [saving, setSaving] = useState(false)

  const { data: dynamicTitles } = useAsyncData<string[]>(
    async () => {
      const { titles: t, error } = await getTitles()
      return { data: t && t.length > 0 ? t : [...TITLES], error: error ? { message: error } : null }
    },
    []
  )
  const availableTitles = dynamicTitles && dynamicTitles.length > 0 ? dynamicTitles : [...TITLES]

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    const { error } = await updateMyProfile({ department, title })
    setSaving(false)
    if (error) toast(error, 'error')
    else {
      onSaved()
      toast('Profile updated.', 'success')
    }
  }

  return (
    <Card
      title="My Profile"
      subtitle="Edit your department and title"
      icon={<IconUsers className="h-4.5 w-4.5" />}
    >
      <form onSubmit={handleSave} className="space-y-3">
        <Field label="Full Name">
          <Input value={profile.name} disabled title="Only an administrator can change your full name." />
        </Field>
        <Field label="Email">
          <Input value={profile.email} disabled />
        </Field>
        <Field label="Department">
          <Input placeholder="Engineering" value={department} onChange={(e) => setDepartment(e.target.value)} />
        </Field>
        <Field label="Title">
          <Select value={title} onChange={(e) => setTitle(e.target.value)}>
            {/* If user already has a custom title not in list, include it */}
            {title && !availableTitles.includes(title) && (
              <option value={title}>{title}</option>
            )}
            {availableTitles.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </Field>
        <Button type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </form>
    </Card>
  )
}
