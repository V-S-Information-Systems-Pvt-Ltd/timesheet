// app/dashboard/activity-types-panel.tsx
'use client'

import { useMemo, useState } from 'react'
import { ENTRY_TYPE_LABELS } from '@vsis/contracts'
import { ActivityType } from '../types'
import { useAsyncData } from '../hooks'
import { dataClient } from '@/lib/data/client'
import { AsyncSection, Badge, Button, Card, Checkbox, EmptyState, Field, Input, Select } from '@/app/components/ui'
import { toast } from '@/app/components/toast'
import { IconPlus, IconTag } from '@/app/components/icons'
import { EditorEmpty, EditorForm, EditorSection, ListToolbar, Monogram, PickList, PickRow, SplitPane } from '@/app/components/workspace'

const ORDER = ['project', 'internal', 'support', 'legacy'] as const
type Scope = (typeof ORDER)[number]
type NewScope = Exclude<Scope, 'support'>
const NEW = '__new__'

const scopeOf = (t: ActivityType): Scope => t.entry_type ?? 'legacy'
const SCOPE_LABEL: Record<Scope, string> = {
  project: ENTRY_TYPE_LABELS.project,
  internal: ENTRY_TYPE_LABELS.internal,
  support: ENTRY_TYPE_LABELS.support,
  legacy: 'Legacy (historical)',
}

export default function ActivityTypesPanel() {
  const [search, setSearch] = useState('')
  const [scopeFilter, setScopeFilter] = useState<Scope | ''>('')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const { data: types, error: loadError, loading, reload } = useAsyncData<ActivityType[]>(
    async () => {
      const { data, error } = await dataClient.getAllActivityTypes()
      return { data, error: error ? { message: error } : null }
    },
    []
  )
  const all = useMemo(() => [...(types ?? [])].sort((a, b) =>
    ORDER.indexOf(scopeOf(a)) - ORDER.indexOf(scopeOf(b)) || a.name.localeCompare(b.name)), [types])
  const query = search.trim().toLowerCase()
  const visible = all.filter(t => (!scopeFilter || scopeOf(t) === scopeFilter) && (!query || t.name.toLowerCase().includes(query)))
  const creating = selectedId === NEW
  const selected = creating ? null : all.find(t => t.id === selectedId) ?? visible[0] ?? null

  return (
    <Card
      title="Activity Types"
      subtitle="Activities people pick for each Type in Log Time. Support activities are fixed."
      icon={<IconTag className="h-4.5 w-4.5" />}
      bodyClassName="p-0"
      actions={<Button variant="secondary" size="sm" onClick={() => setSelectedId(NEW)}><IconPlus className="h-4 w-4" /> Add activity</Button>}
    >
      <AsyncSection loading={loading} error={loadError} reload={reload}>
        <SplitPane
          list={<>
            <ListToolbar
              search={search}
              onSearch={setSearch}
              placeholder="Search activities"
              shown={visible.length}
              total={all.length}
              noun="activities"
              filters={
                <Select value={scopeFilter} onChange={e => setScopeFilter(e.target.value as Scope | '')} aria-label="Filter by type" className="w-auto">
                  <option value="">All types</option>
                  {ORDER.map(s => <option key={s} value={s}>{SCOPE_LABEL[s]}</option>)}
                </Select>
              }
            />
            {visible.length === 0 ? (
              <EmptyState icon={<IconTag className="h-5 w-5" />} title="No activity matches" description="Clear the search or pick another type." className="py-8" />
            ) : (
              <PickList label="Activities">
                {visible.map(t => (
                  <PickRow
                    key={t.id}
                    selected={!creating && selected?.id === t.id}
                    onSelect={() => setSelectedId(t.id)}
                    leading={<Monogram name={t.name} dot={t.is_active} />}
                    title={t.name}
                    subtitle={SCOPE_LABEL[scopeOf(t)]}
                    trailing={t.is_active ? undefined : <Badge>Inactive</Badge>}
                  />
                ))}
              </PickList>
            )}
          </>}
          detail={creating ? (
            <ActivityEditor key="new" defaultScope={scopeFilter && scopeFilter !== 'support' ? scopeFilter : 'project'} onSaved={() => { reload(); setSelectedId(null) }} onCancel={() => setSelectedId(null)} />
          ) : selected ? (
            <ActivityEditor key={`${selected.id}:${selected.name}:${selected.is_active}`} activity={selected} onSaved={reload} />
          ) : (
            <EditorEmpty>Pick an activity to rename it or switch it off.</EditorEmpty>
          )}
        />
      </AsyncSection>
    </Card>
  )
}

/** Edits one activity, or adds one when `activity` is absent. */
function ActivityEditor({ activity, defaultScope = 'project', onSaved, onCancel }: {
  activity?: ActivityType
  defaultScope?: NewScope
  onSaved: () => void
  onCancel?: () => void
}) {
  const initial = { name: activity?.name ?? '', active: activity?.is_active ?? true, scope: defaultScope }
  const [draft, setDraft] = useState(initial)
  const [saving, setSaving] = useState(false)
  const fixed = activity ? scopeOf(activity) === 'support' : false
  const dirty = !activity || draft.name !== initial.name || draft.active !== initial.active

  const save = async () => {
    const name = draft.name.trim()
    if (!name) return toast('Enter an activity name.', 'error')
    setSaving(true)
    try {
      if (!activity) {
        const { error } = await dataClient.addActivityType(name, draft.scope === 'legacy' ? undefined : draft.scope)
        if (error) return toast(error, 'error')
        toast('Activity added.', 'success')
        return onSaved()
      }
      if (name !== activity.name) {
        const { error } = await dataClient.renameActivityType(activity.id, name)
        if (error) return toast(error, 'error')
      }
      if (draft.active !== activity.is_active) {
        const { error } = await dataClient.setActivityTypeActive(activity.id, draft.active)
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
      label={activity ? `Details for ${activity.name}` : 'New activity'}
      leading={<Monogram name={draft.name || '+'} tone="primary" size="lg" />}
      title={activity ? activity.name : 'New activity'}
      subtitle={activity ? SCOPE_LABEL[scopeOf(activity)] : 'Shown under its Type in Log Time.'}
      dirty={dirty}
      saving={saving}
      onSubmit={() => void save()}
      onDiscard={() => (activity ? setDraft(initial) : onCancel?.())}
      saveLabel={activity ? 'Save changes' : 'Add activity'}
    >
      <EditorSection title="Activity" disabled={fixed} note={fixed ? 'Support activities are fixed and cannot be changed.' : undefined}>
        {!activity && (
          <Field label="Type">
            <Select value={draft.scope} onChange={e => setDraft(d => ({ ...d, scope: e.target.value as NewScope }))}>
              <option value="project">{SCOPE_LABEL.project}</option>
              <option value="internal">{SCOPE_LABEL.internal}</option>
              <option value="legacy">{SCOPE_LABEL.legacy}</option>
            </Select>
          </Field>
        )}
        <Field label="Activity name">
          <Input value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} placeholder="e.g. Code review" required autoFocus={!activity} />
        </Field>
        {activity && (
          <Checkbox
            label="Offered in Log Time"
            checked={draft.active}
            onChange={e => setDraft(d => ({ ...d, active: e.target.checked }))}
          />
        )}
      </EditorSection>
    </EditorForm>
  )
}
