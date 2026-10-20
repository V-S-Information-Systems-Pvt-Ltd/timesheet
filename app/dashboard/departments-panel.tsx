// app/dashboard/departments-panel.tsx
'use client'

import { useState } from 'react'
import { dataClient } from '@/lib/data/client'
import type { Department } from '../types'
import { Alert, Badge, Button, Card, EmptyState, Field, IconButton, Input } from '@/app/components/ui'
import { ConfirmDialog, PromptDialog } from '@/app/components/confirm'
import { toast } from '@/app/components/toast'
import { IconPencil, IconPlus, IconTrash, IconUsers } from '@/app/components/icons'
import { useDepartments } from './department-select'

export default function DepartmentsPanel({ onChanged }: { onChanged: () => void }) {
  const { departments, error, reload } = useDepartments()
  const [newName, setNewName] = useState('')
  const [renaming, setRenaming] = useState<Department | null>(null)
  const [deleting, setDeleting] = useState<Department | null>(null)

  const run = async (op: Promise<{ error: string | null }>, done: string) => {
    const { error } = await op
    if (error) return toast(error, 'error')
    toast(done, 'success')
    await reload()
    onChanged()
  }

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    const name = newName.trim()
    if (!name) return
    await run(dataClient.addDepartment(name), 'Department added.')
    setNewName('')
  }

  return (
    <Card
      title="Departments"
      subtitle={`${departments.length} department${departments.length === 1 ? '' : 's'}. People and admin limits pick from this list.`}
      icon={<IconUsers className="h-4.5 w-4.5" />}
    >
      {error && <Alert tone="error" className="mb-4">{error}</Alert>}
      <form onSubmit={handleAdd} className="mb-5 flex flex-wrap items-end gap-3">
        <Field label="New department" className="min-w-52 flex-1">
          <Input placeholder="e.g. Engineering" maxLength={100} value={newName} onChange={e => setNewName(e.target.value)} required />
        </Field>
        <Button type="submit"><IconPlus className="h-4 w-4" /> Add Department</Button>
      </form>

      {departments.length === 0 ? (
        <EmptyState icon={<IconUsers className="h-5 w-5" />} title="No departments yet" description="Add a department above, then assign users to it." />
      ) : (
        <ul className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
          {departments.map(d => (
            <li key={d.id} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/60 px-4 py-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-fg">{d.name}</div>
                <Badge tone={d.member_count ? 'blue' : 'slate'} className="mt-1">
                  {d.member_count} member{d.member_count === 1 ? '' : 's'}
                </Badge>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <IconButton label={`Rename ${d.name}`} size="sm" tone="primary" onClick={() => setRenaming(d)} className="min-h-11 min-w-11 md:min-h-9 md:min-w-9">
                  <IconPencil className="h-3.5 w-3.5" />
                </IconButton>
                <IconButton label={`Delete ${d.name}`} size="sm" tone="danger" onClick={() => setDeleting(d)} className="min-h-11 min-w-11 md:min-h-9 md:min-w-9">
                  <IconTrash className="h-3.5 w-3.5" />
                </IconButton>
              </div>
            </li>
          ))}
        </ul>
      )}

      <PromptDialog
        open={renaming !== null}
        title="Rename Department"
        label="Department name"
        initialValue={renaming?.name ?? ''}
        required
        submitLabel="Rename"
        onSubmit={value => {
          if (renaming && value.trim() !== renaming.name) void run(dataClient.renameDepartment(renaming.id, value.trim()), 'Department renamed.')
        }}
        onClose={() => setRenaming(null)}
      />
      <ConfirmDialog
        open={deleting !== null}
        title="Delete Department"
        message={`Delete department “${deleting?.name ?? ''}”?\n\nDepartments that still have members, or that limit an admin, cannot be deleted.`}
        confirmLabel="Delete"
        onConfirm={() => { if (deleting) void run(dataClient.deleteDepartment(deleting.id), 'Department deleted.') }}
        onClose={() => setDeleting(null)}
      />
    </Card>
  )
}
