// app/dashboard/project-manager.tsx
'use client'

import { useMemo, useState } from 'react'
import { dataClient } from '@/lib/data/client'
import { Project } from '../types'
import { Badge, Button, Card, EmptyState, Field, Input } from '@/app/components/ui'
import { ConfirmDialog } from '@/app/components/confirm'
import { toast } from '@/app/components/toast'
import { IconFolder, IconPlus, IconTrash } from '@/app/components/icons'
import { EditorEmpty, EditorForm, EditorSection, ListToolbar, Monogram, PickList, PickRow, SplitPane } from '@/app/components/workspace'

const NEW = '__new__'

export default function ProjectManager({
  projects,
  onChanged,
}: {
  projects: Project[]
  onChanged: () => void
}) {
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [deleteCandidate, setDeleteCandidate] = useState<Project | null>(null)

  const query = search.trim().toLowerCase()
  const visible = useMemo(() => projects.filter(p =>
    !query || p.name.toLowerCase().includes(query) || (p.so_number ?? '').toLowerCase().includes(query)
  ), [projects, query])
  const selected = selectedId === NEW ? null : projects.find(p => p.id === selectedId) ?? visible[0] ?? null
  const creating = selectedId === NEW || projects.length === 0

  const handleDelete = async (p: Project) => {
    const { error } = await dataClient.deleteProject(p.id)
    if (error) return toast(error, 'error')
    setSelectedId(null)
    onChanged()
    toast('Project deleted.', 'success')
  }

  return (
    <Card
      title="Projects"
      subtitle="Projects people can log time against, with their S.O. numbers"
      icon={<IconFolder className="h-4.5 w-4.5" />}
      bodyClassName="p-0"
      actions={<Button variant="secondary" size="sm" onClick={() => setSelectedId(NEW)}><IconPlus className="h-4 w-4" /> Add project</Button>}
    >
      <SplitPane
        list={<>
          <ListToolbar search={search} onSearch={setSearch} placeholder="Search project or S.O. number" shown={visible.length} total={projects.length} noun="projects" />
          {visible.length === 0 ? (
            <EmptyState
              icon={<IconFolder className="h-5 w-5" />}
              title={projects.length === 0 ? 'No projects yet' : 'No project matches'}
              description={projects.length === 0 ? 'Add the first project to start logging time against it.' : 'Clear the search to see every project.'}
              className="py-8"
            />
          ) : (
            <PickList label="Projects">
              {visible.map(p => (
                <PickRow
                  key={p.id}
                  selected={!creating && selected?.id === p.id}
                  onSelect={() => setSelectedId(p.id)}
                  leading={<Monogram name={p.name} />}
                  title={p.name}
                  subtitle={p.so_number ? `S.O. ${p.so_number}` : 'No S.O. number'}
                  trailing={p.is_timesheet_project === false ? <Badge>Reference</Badge> : undefined}
                />
              ))}
            </PickList>
          )}
        </>}
        detail={creating ? (
          <ProjectEditor key="new" onSaved={(id) => { onChanged(); setSelectedId(id ?? null) }} onCancel={() => setSelectedId(null)} />
        ) : selected ? (
          <ProjectEditor key={`${selected.id}:${selected.name}:${selected.so_number}`} project={selected} onSaved={onChanged} onDelete={() => setDeleteCandidate(selected)} />
        ) : (
          <EditorEmpty>Pick a project to rename it or set its S.O. number.</EditorEmpty>
        )}
      />

      <ConfirmDialog
        open={deleteCandidate !== null}
        title="Delete Project"
        message={`Delete project “${deleteCandidate?.name ?? ''}”?\n\nProjects with entries cannot be deleted until those entries are removed.`}
        confirmLabel="Delete"
        confirmValue={deleteCandidate?.name}
        onConfirm={() => { if (deleteCandidate) void handleDelete(deleteCandidate) }}
        onClose={() => setDeleteCandidate(null)}
      />
    </Card>
  )
}

/** Edits one project, or creates one when `project` is absent. */
function ProjectEditor({ project, onSaved, onCancel, onDelete }: {
  project?: Project
  onSaved: (createdId?: string) => void
  onCancel?: () => void
  onDelete?: () => void
}) {
  const initial = { name: project?.name ?? '', so: project?.so_number ?? '' }
  const [draft, setDraft] = useState(initial)
  const [saving, setSaving] = useState(false)
  const dirty = draft.name !== initial.name || draft.so !== initial.so

  const save = async () => {
    const name = draft.name.trim()
    if (!name) return toast('Enter a project name.', 'error')
    setSaving(true)
    try {
      if (!project) {
        const { error } = await dataClient.addProject(name)
        if (error) return toast(error, 'error')
        toast('Project added.', 'success')
        return onSaved()
      }
      if (name !== project.name) {
        const { error } = await dataClient.renameProject(project.id, name)
        if (error) return toast(error, 'error')
      }
      if (draft.so.trim() !== (project.so_number ?? '')) {
        const { error } = await dataClient.setProjectSO(project.id, draft.so.trim())
        if (error) return toast(error, 'error')
      }
      toast(`Saved ${name}.`, 'success')
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <EditorForm
      label={project ? `Details for ${project.name}` : 'New project'}
      leading={<Monogram name={draft.name || '+'} tone="primary" size="lg" />}
      title={project ? project.name : 'New project'}
      subtitle={project ? (project.so_number ? `S.O. ${project.so_number}` : 'No S.O. number') : 'Add it, then people can pick it in Log Time.'}
      dirty={dirty || !project}
      saving={saving}
      onSubmit={() => void save()}
      onDiscard={() => (project ? setDraft(initial) : onCancel?.())}
      saveLabel={project ? 'Save changes' : 'Add project'}
      extraActions={onDelete && (
        <Button type="button" variant="ghost" size="sm" onClick={onDelete} className="text-danger-text">
          <IconTrash className="h-3.5 w-3.5" /> Delete
        </Button>
      )}
    >
      <EditorSection title="Project">
        <Field label="Project name">
          <Input value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} placeholder="e.g. Website Revamp" required autoFocus={!project} />
        </Field>
        {project && (
          <Field label="S.O. number" hint="Leave empty to clear it.">
            <Input value={draft.so} onChange={e => setDraft(d => ({ ...d, so: e.target.value }))} placeholder="e.g. SO-1042" />
          </Field>
        )}
      </EditorSection>
    </EditorForm>
  )
}
