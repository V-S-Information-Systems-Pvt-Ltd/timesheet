// app/dashboard/project-manager.tsx
'use client'

import { useState } from 'react'
import { addProject, deleteProject, renameProject, setProjectSO, setProjectTelegramNo } from '../actions'
import { Project } from '../types'
import { Badge, Button, Card, EmptyState, Field, IconButton, Input } from '@/app/components/ui'
import { ConfirmDialog, PromptDialog } from '@/app/components/confirm'
import { toast } from '@/app/components/toast'
import { IconBotNumber, IconClear, IconFolder, IconPencil, IconPlus, IconTrash } from '@/app/components/icons'

type EditKind = 'rename' | 'so' | 'telegram'

const EDIT_META: Record<EditKind, { title: string; label: string; submit: string }> = {
  rename: { title: 'Rename Project', label: 'Project name', submit: 'Rename' },
  so: { title: 'S.O. Number', label: 'S.O. number (empty to clear)', submit: 'Save' },
  telegram: { title: 'Telegram Bot Number', label: 'Bot number (empty to clear)', submit: 'Save' },
}

export default function ProjectManager({
  projects,
  onChanged,
}: {
  projects: Project[]
  onChanged: () => void
}) {
  const [newProjectName, setNewProjectName] = useState('')
  const [editTarget, setEditTarget] = useState<{ kind: EditKind; project: Project } | null>(null)
  const [deleteCandidate, setDeleteCandidate] = useState<Project | null>(null)

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    const { error } = await addProject(newProjectName)
    if (error) toast(error, 'error')
    else {
      setNewProjectName('')
      onChanged()
      toast('Project added.', 'success')
    }
  }

  const handleEditSubmit = async (kind: EditKind, project: Project, value: string) => {
    if (kind === 'rename') {
      if (value === project.name) return
      const { error } = await renameProject(project.id, value)
      if (error) toast(error, 'error')
      else {
        onChanged()
        toast('Project renamed.', 'success')
      }
      return
    }
    if (kind === 'so') {
      const { error } = await setProjectSO(project.id, value)
      if (error) toast(error, 'error')
      else {
        onChanged()
        toast(value ? 'S.O. number saved.' : 'S.O. number cleared.', 'success')
      }
      return
    }
    // telegram
    const numeric = value === '' ? null : Number(value)
    if (numeric !== null && (!Number.isInteger(numeric) || numeric <= 0)) {
      toast('Bot number must be a positive whole number.', 'error')
      return
    }
    const { error } = await setProjectTelegramNo(project.id, numeric)
    if (error) toast(error, 'error')
    else {
      onChanged()
      toast(numeric ? `Bot number ${numeric} saved.` : 'Bot number cleared.', 'success')
    }
  }

  const handleDelete = async (p: Project) => {
    const { error } = await deleteProject(p.id)
    if (error) toast(error, 'error')
    else {
      onChanged()
      toast('Project deleted.', 'success')
    }
  }

  const editInitialValue = () => {
    if (!editTarget) return ''
    const { kind, project } = editTarget
    if (kind === 'rename') return project.name
    if (kind === 'so') return project.so_number ?? ''
    return project.telegram_no != null ? String(project.telegram_no) : ''
  }

  return (
    <Card
      title="Project Management"
      subtitle={`${projects.length} project${projects.length === 1 ? '' : 's'}`}
      icon={<IconFolder className="h-4.5 w-4.5" />}
    >
      <form onSubmit={handleAdd} className="mb-5 flex flex-wrap items-end gap-3">
        <Field label="New Project Name" className="min-w-52 flex-1">
          <Input
            placeholder="e.g. Website Revamp"
            value={newProjectName}
            onChange={(e) => setNewProjectName(e.target.value)}
            required
          />
        </Field>
        <Button type="submit">
          <IconPlus className="h-4 w-4" /> Add Project
        </Button>
      </form>

      {projects.length === 0 ? (
        <EmptyState
          icon={<IconFolder className="h-5 w-5" />}
          title="No projects yet"
          description="Add your first project above to start logging time against it."
        />
      ) : (
        <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
          {projects.map(p => (
            <div
              key={p.id}
              className="flex flex-col items-start justify-between gap-3 rounded-xl border border-border bg-muted/60 px-4 py-3 transition hover:border-border hover:bg-card md:flex-row md:items-center"
            >
              <div className="min-w-0 max-w-full">
                <div className="truncate text-sm font-medium text-fg">{p.name}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                  {p.so_number ? (
                    <Badge tone="blue">S.O. {p.so_number}</Badge>
                  ) : (
                    <span className="text-xs text-fg-muted">No S.O. number</span>
                  )}
                  {p.telegram_no != null && <Badge tone="green">Bot #{p.telegram_no}</Badge>}
                </div>
              </div>
              <div className="flex max-w-full flex-wrap items-center gap-1 md:shrink-0">
                <IconButton label="Rename" size="sm" tone="primary" onClick={() => setEditTarget({ kind: 'rename', project: p })} className="min-h-11 min-w-11 md:min-h-9 md:min-w-9">
                  <IconPencil className="h-3.5 w-3.5" />
                </IconButton>
                <IconButton label={p.so_number ? 'Change S.O.' : 'Set S.O.'} size="sm" onClick={() => setEditTarget({ kind: 'so', project: p })} className="min-h-11 min-w-11 md:min-h-9 md:min-w-9">
                  <span className="text-xs font-semibold">SO</span>
                </IconButton>
                <IconButton label="Set Telegram bot number" title="Telegram bot number" size="sm" tone="primary" onClick={() => setEditTarget({ kind: 'telegram', project: p })} className="min-h-11 min-w-11 md:min-h-9 md:min-w-9">
                  <IconBotNumber className="h-3.5 w-3.5" />
                </IconButton>
                {p.so_number && (
                  <IconButton label="Clear S.O." size="sm" onClick={() => handleEditSubmit('so', p, '')} className="min-h-11 min-w-11 md:min-h-9 md:min-w-9">
                    <IconClear className="h-3.5 w-3.5" />
                  </IconButton>
                )}
                <IconButton label="Delete" size="sm" tone="danger" onClick={() => setDeleteCandidate(p)} className="min-h-11 min-w-11 md:min-h-9 md:min-w-9">
                  <IconTrash className="h-3.5 w-3.5" />
                </IconButton>
              </div>
            </div>
          ))}
        </div>
      )}

      <PromptDialog
        open={editTarget !== null}
        title={editTarget ? EDIT_META[editTarget.kind].title : ''}
        label={editTarget ? EDIT_META[editTarget.kind].label : ''}
        initialValue={editInitialValue()}
        placeholder={editTarget?.kind === 'rename' ? 'e.g. Website Revamp' : undefined}
        inputMode={editTarget?.kind === 'telegram' ? 'numeric' : undefined}
        required={editTarget?.kind !== 'so' && editTarget?.kind !== 'telegram'}
        submitLabel={editTarget ? EDIT_META[editTarget.kind].submit : 'Save'}
        onSubmit={(value) => {
          if (!editTarget) return
          void handleEditSubmit(editTarget.kind, editTarget.project, value)
        }}
        onClose={() => setEditTarget(null)}
      />

      <ConfirmDialog
        open={deleteCandidate !== null}
        title="Delete Project"
        message={`Delete project “${deleteCandidate?.name ?? ''}”?\n\nProjects with entries cannot be deleted until those entries are removed.`}
        confirmLabel="Delete"
        confirmValue={deleteCandidate?.name}
        onConfirm={() => {
          if (deleteCandidate) void handleDelete(deleteCandidate)
        }}
        onClose={() => setDeleteCandidate(null)}
      />
    </Card>
  )
}
