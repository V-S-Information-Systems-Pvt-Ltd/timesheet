// app/dashboard/my-profile-panel.tsx
'use client'

import { useState } from 'react'
import { updateMyProfile } from '../actions'
import { User } from '../types'
import { Button, Card, Field, Input } from '@/app/components/ui'
import { toast } from '@/app/components/toast'
import { IconUsers } from '@/app/components/icons'

export default function MyProfilePanel({ profile, onSaved }: { profile: User; onSaved: () => void }) {
  const [department, setDepartment] = useState(profile.department || '')
  const [title, setTitle] = useState(profile.title || '')
  const [saving, setSaving] = useState(false)

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
          <Input placeholder="Software Engineer" value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Button type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </form>
    </Card>
  )
}
