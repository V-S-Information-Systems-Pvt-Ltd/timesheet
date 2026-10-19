'use client'

import { useEffect, useState } from 'react'
import {
  ENTRY_TYPES, ENTRY_TYPE_LABELS, ACTIVITIES_BY_TYPE, ACTIVITY_LABELS,
  TICKET_NUMBER_MAX, ACTIVITY_OTHER_MAX, CUSTOMER_MAX, newEntrySchema, logEntrySchema,
  normalizeClassification, requiresTicketNumber, type EntryType, type ActivityCode, type CreateTimesheetInput,
} from '@vsis/contracts'
import type { ActivityType, Project, Timesheet } from '@/app/types'
import { dataClient } from '@/lib/data/client'
import { Field, IconButton, Input, Select } from '@/app/components/ui'
import { IconPlus, IconX } from '@/app/components/icons'
import ProjectPicker from './project-picker'

export interface ClassificationDraft {
  entryType: EntryType | ''
  activityCode: ActivityCode | ''
  projectId: string
  ticketNumber: string
  /** Extra tickets (Log Time only): one entry is created per ticket. */
  extraTickets?: string[]
  customer: string
  activityOther: string
}
export const emptyClassification: ClassificationDraft = {
  entryType: '', activityCode: '', projectId: '', ticketNumber: '', extraTickets: [], customer: '', activityOther: '',
}

export function classificationFromEntry(entry: Timesheet): ClassificationDraft {
  // Legacy copies are new drafts, never inferred from project/activity names.
  return entry.entry_type ? {
    entryType: entry.entry_type, activityCode: entry.activity_code ?? '',
    projectId: entry.project_id ?? '', ticketNumber: entry.ticket_number ?? '', extraTickets: [],
    customer: entry.customer ?? '', activityOther: entry.activity_other ?? '',
  } : { ...emptyClassification }
}

export function changeClassification(draft: ClassificationDraft, field: keyof ClassificationDraft, value: string): ClassificationDraft {
  if (field === 'entryType') return { ...emptyClassification, entryType: value as EntryType | '' }
  if (field === 'activityCode') return { ...draft, activityCode: value as ActivityCode | '', ticketNumber: '', extraTickets: [], customer: '', activityOther: '' }
  return { ...draft, [field]: value }
}

/** All tickets of a draft, first field first, blanks dropped. */
export function draftTickets(draft: ClassificationDraft): string[] {
  return [draft.ticketNumber, ...(draft.extraTickets ?? [])].map(t => t.trim()).filter(Boolean)
}

export function validateWebEntry(input: CreateTimesheetInput, legacy = false): { fieldErrors: Record<string, string[]>; input: CreateTimesheetInput | null } {
  const parsed = (legacy ? logEntrySchema : newEntrySchema).safeParse(input)
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {}
    for (const issue of parsed.error.issues) {
      const field = String(issue.path[0])
      ;(fieldErrors[field] ??= []).push(issue.message)
    }
    // Enum errors should ask for a selection rather than list internal wire values.
    if (!legacy && !input.entryType) fieldErrors.entryType = ['Type is required.']
    if (!legacy && !input.activityCode) fieldErrors.activityCode = ['Activity is required.']
    return { fieldErrors, input: null }
  }
  return { fieldErrors: {}, input: legacy ? input : {
    ...input, ...normalizeClassification(parsed.data as Parameters<typeof normalizeClassification>[0]), activityTypeId: null,
  } }
}

export function classificationInput(draft: ClassificationDraft) {
  return {
    entryType: draft.entryType || null, activityCode: draft.activityCode || null,
    projectId: draft.projectId || null, activityTypeId: null,
    ticketNumber: draft.ticketNumber || null, customer: draft.customer || null,
    activityOther: draft.activityOther || null,
  }
}

/** Active catalogue activities (admin-managed), loaded once per page. */
function useCatalogueActivities(): ActivityType[] {
  const [rows, setRows] = useState<ActivityType[]>([])
  useEffect(() => {
    let live = true
    void dataClient.getActivityTypes().then(({ data }) => { if (live && data) setRows(data.filter(a => a.entry_type && a.code)) })
    return () => { live = false }
  }, [])
  return rows
}

/** Options for a type: the catalogue when loaded, else the built-in defaults.
 * A stored code no longer offered stays selectable while editing. */
export function activityOptions(type: EntryType, catalogue: ActivityType[], current?: string): Array<{ code: string; label: string }> {
  const fromCatalogue = catalogue.filter(a => a.entry_type === type && a.is_active).map(a => ({ code: a.code!, label: a.name }))
  const options = fromCatalogue.length ? fromCatalogue : ACTIVITIES_BY_TYPE[type].map(code => ({ code, label: ACTIVITY_LABELS[code] }))
  if (current && !options.some(o => o.code === current)) options.push({ code: current, label: catalogue.find(a => a.entry_type === type && a.code === current)?.name ?? current })
  return options
}

export default function ClassificationFields({ value, onChange, projects, fieldErrors = {}, idPrefix = 'classification', multiTicket = false }: {
  value: ClassificationDraft
  onChange: (value: ClassificationDraft) => void
  projects: Project[]
  fieldErrors?: Record<string, string[]>
  idPrefix?: string
  /** Allow several tickets (Log Time); edits keep one ticket per entry. */
  multiTicket?: boolean
}) {
  const catalogue = useCatalogueActivities()
  const change = (field: keyof ClassificationDraft, next: string) => onChange(changeClassification(value, field, next))
  const extra = value.extraTickets ?? []
  const setExtra = (next: string[]) => onChange({ ...value, extraTickets: next })
  const ticketBranch = value.entryType && value.activityCode && requiresTicketNumber(value.entryType, value.activityCode)
  return <>
    <Field label="Type" id={`${idPrefix}-type`} error={fieldErrors.entryType?.[0]}>
      <Select id={`${idPrefix}-type`} value={value.entryType} onChange={e => change('entryType', e.target.value)} required>
        <option value="">Select Type…</option>
        {ENTRY_TYPES.map(type => <option key={type} value={type}>{ENTRY_TYPE_LABELS[type]}</option>)}
      </Select>
    </Field>
    {value.entryType === 'project' && <Field label="Project" id={`${idPrefix}-project`} error={fieldErrors.projectId?.[0]}>
      <ProjectPicker inputId={`${idPrefix}-project`} projects={projects.filter(p => p.is_timesheet_project !== false)} value={value.projectId} onChange={next => change('projectId', next)} required />
    </Field>}
    {value.entryType && <Field label="Activity" id={`${idPrefix}-activity`} error={fieldErrors.activityCode?.[0]}>
      <Select id={`${idPrefix}-activity`} value={value.activityCode} onChange={e => change('activityCode', e.target.value)} required>
        <option value="">Select Activity…</option>
        {activityOptions(value.entryType, catalogue, value.activityCode || undefined).map(o => <option key={o.code} value={o.code}>{o.label}</option>)}
      </Select>
    </Field>}
    {ticketBranch && <>
      <Field label="Customer" id={`${idPrefix}-customer`} error={fieldErrors.customer?.[0]}>
        <Input id={`${idPrefix}-customer`} value={value.customer} onChange={e => change('customer', e.target.value)} placeholder="Customer name" maxLength={CUSTOMER_MAX} required />
      </Field>
      <Field label={multiTicket && extra.length ? 'Ticket Numbers' : 'Ticket Number'} id={`${idPrefix}-ticket`} error={fieldErrors.ticketNumber?.[0]}>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Input id={`${idPrefix}-ticket`} value={value.ticketNumber} onChange={e => change('ticketNumber', e.target.value)} placeholder="INC 00089159 or SVR 00089156" maxLength={TICKET_NUMBER_MAX} required />
            {multiTicket && <IconButton label="Add another ticket" size="sm" onClick={() => setExtra([...extra, ''])}><IconPlus className="h-4 w-4" /></IconButton>}
          </div>
          {multiTicket && extra.map((ticket, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input aria-label={`Ticket Number ${i + 2}`} value={ticket} onChange={e => setExtra(extra.map((t, j) => (j === i ? e.target.value : t)))} placeholder="INC 00089159 or SVR 00089156" maxLength={TICKET_NUMBER_MAX} required />
              <IconButton label={`Remove ticket ${i + 2}`} size="sm" onClick={() => setExtra(extra.filter((_, j) => j !== i))}><IconX className="h-4 w-4" /></IconButton>
            </div>
          ))}
          {multiTicket && extra.length > 0 && <p className="text-xs text-fg-muted">Hours are split across {extra.length + 1} entries, one per ticket (0.25h steps).</p>}
        </div>
      </Field>
    </>}
    {value.entryType === 'internal' && value.activityCode === 'other' && <Field label="Other Activity" id={`${idPrefix}-other`} error={fieldErrors.activityOther?.[0]}>
      <Input id={`${idPrefix}-other`} value={value.activityOther} onChange={e => change('activityOther', e.target.value)} placeholder="Describe the activity" maxLength={ACTIVITY_OTHER_MAX} required />
    </Field>}
  </>
}
