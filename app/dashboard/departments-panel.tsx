// app/dashboard/departments-panel.tsx
'use client'

import { useState } from 'react'
import { dataClient } from '@/lib/data/client'
import type { Department } from '../types'
import { Alert, Badge, Button, Card, EmptyState, Field, Input } from '@/app/components/ui'
import { ConfirmDialog } from '@/app/components/confirm'
import { toast } from '@/app/components/toast'
import { IconPlus, IconTrash, IconUsers } from '@/app/components/icons'
import { EditorEmpty, EditorForm, EditorSection, ListToolbar, Monogram, PickList, PickRow, SplitPane } from '@/app/components/workspace'
import { useDepartments } from './department-select'

const NEW = '__new__'
const members = (n: number) => `${n} member${n === 1 ? '' : 's'}`

export default function DepartmentsPanel({ onChanged }: { onChanged: () => void }) {
  const { departments, error, reload } = useDepartments()
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<Department | null>(null)

  const query = search.trim().toLowerCase()
  const visible = departments.filter(d => !query || d.name.toLowerCase().includes(query))
  const creating = selectedId === NEW || departments.length === 0
  const selected = selectedId === NEW ? null : departments.find(d => d.id === selectedId) ?? visible[0] ?? null

  const afterChange = async (nextId: string | null) => {
    await reload()
    setSelectedId(nextId)
    onChanged()
  }

  return (
    <Card
      title="Departments"
      subtitle="People and admin access limits pick from this list"
      icon={<IconUsers className="h-4.5 w-4.5" />}
      bodyClassName="p-0"
      actions={<Button variant="secondary" size="sm" onClick={() => setSelectedId(NEW)}><IconPlus className="h-4 w-4" /> Add department</Button>}
    >
      {error && <Alert tone="error" className="m-4">{error}</Alert>}
      <SplitPane
        list={<>
          <ListToolbar search={search} onSearch={setSearch} placeholder="Search departments" shown={visible.length} total={departments.length} noun="departments" />
          {visible.length === 0 ? (
            <EmptyState
              icon={<IconUsers className="h-5 w-5" />}
              title={departments.length === 0 ? 'No departments yet' : 'No department matches'}
              description={departments.length === 0 ? 'Add a department, then assign people to it in Users.' : 'Clear the search to see every department.'}
              className="py-8"
            />
          ) : (
            <PickList label="Departments">
              {visible.map(d => (
                <PickRow
                  key={d.id}
                  selected={!creating && selected?.id === d.id}
                  onSelect={() => setSelectedId(d.id)}
                  leading={<Monogram name={d.name} />}
                  title={d.name}
                  trailing={<Badge tone={d.member_count ? 'blue' : 'slate'}>{members(d.member_count)}</Badge>}
                />
              ))}
            </PickList>
          )}
        </>}
        detail={creating ? (
          <DepartmentEditor key="new" onSaved={() => void afterChange(null)} onCancel={() => setSelectedId(null)} />
        ) : selected ? (
          <DepartmentEditor key={`${selected.id}:${selected.name}`} department={selected} onSaved={() => void afterChange(selected.id)} onDelete={() => setDeleting(selected)} />
        ) : (
          <EditorEmpty>Pick a department to rename or delete it.</EditorEmpty>
        )}
      />

      <ConfirmDialog
        open={deleting !== null}
        title="Delete Department"
        message={`Delete department “${deleting?.name ?? ''}”?\n\nDepartments that still have members, or that limit an admin, cannot be deleted.`}
        confirmLabel="Delete"
        onConfirm={async () => {
          if (!deleting) return
          const { error } = await dataClient.deleteDepartment(deleting.id)
          if (error) return toast(error, 'error')
          toast('Department deleted.', 'success')
          await afterChange(null)
        }}
        onClose={() => setDeleting(null)}
      />
    </Card>
  )
}

function DepartmentEditor({ department, onSaved, onCancel, onDelete }: {
  department?: Department
  onSaved: () => void
  onCancel?: () => void
  onDelete?: () => void
}) {
  const [name, setName] = useState(department?.name ?? '')
  const [saving, setSaving] = useState(false)
  const dirty = !department || name.trim() !== department.name

  const save = async () => {
    const clean = name.trim()
    if (!clean) return toast('Enter a department name.', 'error')
    setSaving(true)
    try {
      const { error } = department ? await dataClient.renameDepartment(department.id, clean) : await dataClient.addDepartment(clean)
      if (error) return toast(error, 'error')
      toast(department ? 'Department renamed.' : 'Department added.', 'success')
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <EditorForm
      label={department ? `Details for ${department.name}` : 'New department'}
      leading={<Monogram name={name || '+'} tone="primary" size="lg" />}
      title={department ? department.name : 'New department'}
      subtitle={department ? members(department.member_count) : 'Assign people to it in Users afterwards.'}
      dirty={dirty}
      saving={saving}
      onSubmit={() => void save()}
      onDiscard={() => (department ? setName(department.name) : onCancel?.())}
      saveLabel={department ? 'Save changes' : 'Add department'}
      extraActions={onDelete && (
        <Button type="button" variant="ghost" size="sm" onClick={onDelete} className="text-danger-text">
          <IconTrash className="h-3.5 w-3.5" /> Delete
        </Button>
      )}
    >
      <EditorSection title="Department" note={department ? 'Renaming updates everyone in it and any admin limited to it.' : undefined}>
        <Field label="Department name">
          <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Engineering" maxLength={100} required autoFocus={!department} />
        </Field>
      </EditorSection>
    </EditorForm>
  )
}
