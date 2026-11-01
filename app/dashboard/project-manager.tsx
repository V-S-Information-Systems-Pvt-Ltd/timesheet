// app/dashboard/project-manager.tsx
'use client'

import { useMemo, useState } from 'react'
import { dataClient } from '@/lib/data/client'
import { Project } from '../types'
import { Badge, Button, Card, Checkbox, EmptyState, Field, Input } from '@/app/components/ui'
import { ConfirmDialog } from '@/app/components/confirm'
import { toast } from '@/app/components/toast'
import { IconFolder, IconPlus, IconTrash } from '@/app/components/icons'
import { EditorEmpty, EditorForm, EditorSection, ListToolbar, Monogram, PickList, PickRow, SplitPane } from '@/app/components/workspace'
import { useDepartments } from './department-select'

const NEW = '__new__'

export default function ProjectManager({
  projects,
  onChanged,
}: {
  projects: Project[]
  onChanged: () => void
}) {
  const [search, setSearch] = useState('')
  const [showHidden, setShowHidden] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [deleteCandidate, setDeleteCandidate] = useState<Project | null>(null)

  const query = search.trim().toLowerCase()
  const hiddenCount = projects.filter(p => p.is_hidden).length
  const visible = useMemo(() => projects.filter(p =>
    (showHidden || !p.is_hidden) &&
    (!query || p.name.toLowerCase().includes(query) || (p.so_number ?? '').toLowerCase().includes(query))
  ), [projects, query, showHidden])
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
          <ListToolbar
            search={search}
            onSearch={setSearch}
            placeholder="Search project or S.O. number"
            shown={visible.length}
            total={projects.length}
            noun="projects"
            filters={hiddenCount > 0 && <Checkbox label={`Show hidden (${hiddenCount})`} checked={showHidden} onChange={e => setShowHidden(e.target.checked)} />}
          />
          {visible.length === 0 ? (
            <EmptyState
              icon={<IconFolder className="h-5 w-5" />}
              title={projects.length === 0 ? 'No projects yet' : 'No project matches'}
              description={projects.length === 0 ? 'Add the first project to start logging time against it.' : 'Clear the search or show hidden projects to see every project.'}
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
                  subtitle={[p.so_number ? `S.O. ${p.so_number}` : 'No S.O. number', p.departments?.length ? p.departments.join(', ') : null].filter(Boolean).join(' · ')}
                  trailing={p.is_timesheet_project === false ? <Badge>Reference</Badge> : p.is_hidden ? <Badge>Hidden</Badge> : undefined}
                />
              ))}
            </PickList>
          )}
        </>}
        detail={creating ? (
          <ProjectEditor key="new" onSaved={(id) => { onChanged(); setSelectedId(id ?? null) }} onCancel={() => setSelectedId(null)} />
        ) : selected ? (
          <ProjectEditor key={`${selected.id}:${selected.name}:${selected.so_number}:${selected.is_hidden}:${(selected.departments ?? []).join('|')}`} project={selected} onSaved={onChanged} onDelete={() => setDeleteCandidate(selected)} />
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
  const initial = { name: project?.name ?? '', so: project?.so_number ?? '', hidden: project?.is_hidden ?? false, departments: project?.departments ?? [] }
  const [draft, setDraft] = useState(initial)
  const [saving, setSaving] = useState(false)
  const { departments } = useDepartments()
  const sameDepartments = (a: string[], b: string[]) => a.length === b.length && a.every(d => b.includes(d))
  const scopeDirty = draft.hidden !== initial.hidden || !sameDepartments(draft.departments, initial.departments)
  const dirty = draft.name !== initial.name || draft.so !== initial.so || scopeDirty
  // A stale department (renamed elsewhere) stays visible so it can be unticked.
  const departmentNames = [...new Set([...departments.map(d => d.name), ...initial.departments])]

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
      if (scopeDirty) {
        const { error } = await dataClient.setProjectScope(project.id, { hidden: draft.hidden, departments: draft.departments })
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
      {project && project.is_timesheet_project !== false && (
        <EditorSection title="Availability">
          <Checkbox
            label="Hide from new entries"
            checked={draft.hidden}
            onChange={e => setDraft(d => ({ ...d, hidden: e.target.checked }))}
          />
          <p className="text-xs text-fg-muted">Hidden projects keep their existing entries and reports, but nobody can pick them in Log Time.</p>
          <fieldset className="space-y-2 rounded-control border border-line p-3">
            <legend className="px-1 text-sm font-semibold text-fg">Departments</legend>
            <p className="text-xs text-fg-muted">
              {draft.departments.length === 0
                ? 'Open to every department. Tick departments to limit who can log time against it.'
                : `Only people in ${draft.departments.length === 1 ? draft.departments[0] : `these ${draft.departments.length} departments`} can log time against it.`}
            </p>
            {departmentNames.length === 0 ? (
              <p className="text-xs text-fg-muted">Add departments under Administration, Departments first.</p>
            ) : (
              <div className="grid gap-x-3 sm:grid-cols-2">
                {departmentNames.map(n => (
                  <Checkbox
                    key={n}
                    label={n}
                    checked={draft.departments.includes(n)}
                    onChange={e => setDraft(d => ({ ...d, departments: e.target.checked ? [...d.departments, n] : d.departments.filter(x => x !== n) }))}
                  />
                ))}
              </div>
            )}
          </fieldset>
        </EditorSection>
      )}
    </EditorForm>
  )
}
