'use client'

import {
  ENTRY_TYPES, ENTRY_TYPE_LABELS, ACTIVITIES_BY_TYPE, ACTIVITY_LABELS,
  TICKET_NUMBER_MAX, ACTIVITY_OTHER_MAX, newEntrySchema, logEntrySchema,
  normalizeClassification, type EntryType, type ActivityCode, type CreateTimesheetInput,
} from '@vsis/contracts'
import type { Project, Timesheet } from '@/app/types'
import { Field, Input, Select } from '@/app/components/ui'
import ProjectPicker from './project-picker'

export interface ClassificationDraft {
  entryType: EntryType | ''
  activityCode: ActivityCode | ''
  projectId: string
  ticketNumber: string
  activityOther: string
}
export const emptyClassification: ClassificationDraft = {
  entryType: '', activityCode: '', projectId: '', ticketNumber: '', activityOther: '',
}

export function classificationFromEntry(entry: Timesheet): ClassificationDraft {
  // Legacy copies are new drafts, never inferred from project/activity names.
  return entry.entry_type ? {
    entryType: entry.entry_type, activityCode: entry.activity_code ?? '',
    projectId: entry.project_id ?? '', ticketNumber: entry.ticket_number ?? '', activityOther: entry.activity_other ?? '',
  } : { ...emptyClassification }
}

export function changeClassification(draft: ClassificationDraft, field: keyof ClassificationDraft, value: string): ClassificationDraft {
  if (field === 'entryType') return { ...emptyClassification, entryType: value as EntryType | '' }
  if (field === 'activityCode') return { ...draft, activityCode: value as ActivityCode | '', ticketNumber: '', activityOther: '' }
  return { ...draft, [field]: value }
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
    ticketNumber: draft.ticketNumber || null, activityOther: draft.activityOther || null,
  }
}

export default function ClassificationFields({ value, onChange, projects, fieldErrors = {}, idPrefix = 'classification' }: {
  value: ClassificationDraft
  onChange: (value: ClassificationDraft) => void
  projects: Project[]
  fieldErrors?: Record<string, string[]>
  idPrefix?: string
}) {
  const change = (field: keyof ClassificationDraft, next: string) => onChange(changeClassification(value, field, next))
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
        {ACTIVITIES_BY_TYPE[value.entryType].map(code => <option key={code} value={code}>{ACTIVITY_LABELS[code]}</option>)}
      </Select>
    </Field>}
    {value.entryType === 'support' && value.activityCode === 'customers' && <Field label="Ticket Number" id={`${idPrefix}-ticket`} error={fieldErrors.ticketNumber?.[0]}>
      <Input id={`${idPrefix}-ticket`} value={value.ticketNumber} onChange={e => change('ticketNumber', e.target.value)} placeholder="Enter Ticket Number" maxLength={TICKET_NUMBER_MAX} required />
    </Field>}
    {value.entryType === 'internal' && value.activityCode === 'other' && <Field label="Other Activity" id={`${idPrefix}-other`} error={fieldErrors.activityOther?.[0]}>
      <Input id={`${idPrefix}-other`} value={value.activityOther} onChange={e => change('activityOther', e.target.value)} placeholder="Describe the activity" maxLength={ACTIVITY_OTHER_MAX} required />
    </Field>}
  </>
}
