// app/dashboard/backfill-form.tsx
'use client'

import { useState } from 'react'
import { logYesterday } from '../actions'
import { Project, User } from '../types'
import { Button, Card, Field, Input, Select} from '@/app/components/ui'
import { toast } from '@/app/components/toast'
import { IconCalendar } from '@/app/components/icons'

export default function BackfillForm({
  allUsers,
  projects,
  onChanged,
}: {
  allUsers: User[]
  projects: Project[]
  onChanged: () => void
}) {
  const [userId, setUserId] = useState('')
  const [projectId, setProjectId] = useState('')
  const [hours, setHours] = useState('')
  const [workDone, setWorkDone] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const { error } = await logYesterday({
      projectId,
      hoursWorked: parseFloat(hours),
      workDone,
      userId,
    })
    if (error) toast(error, 'error')
    else {
      setUserId(''); setProjectId(''); setHours(''); setWorkDone('')
      onChanged()
      toast('Backfill saved!', 'success')
    }
  }

  return (
    <Card
      title="Backfill Yesterday"
      subtitle="Log yesterday's entry for another user"
      icon={<IconCalendar className="h-4.5 w-4.5" />}
    >
      <form onSubmit={handleSubmit} className="space-y-3.5">
        <Field label="User">
          <Select value={userId} onChange={(e) => setUserId(e.target.value)} required>
            <option value="">Select User…</option>
            {allUsers.map(u => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
          </Select>
        </Field>
        <Field label="Project">
          <Select value={projectId} onChange={(e) => setProjectId(e.target.value)} required>
            <option value="">Select Project…</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Hours">
            <Input type="number" step="0.25" min="0" placeholder="8.0" value={hours} onChange={(e) => setHours(e.target.value)} required />
          </Field>
          <Field label="Work Done">
            <Input type="text" placeholder="Summary" value={workDone} onChange={(e) => setWorkDone(e.target.value)} required />
          </Field>
        </div>
        <Button type="submit" variant="secondary" className="w-full">
          Save for User (1/day)
        </Button>
      </form>
    </Card>
  )
}
