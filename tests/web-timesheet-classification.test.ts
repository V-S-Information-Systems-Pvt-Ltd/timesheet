import { describe, expect, it, vi, afterEach } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ACTIVITIES_BY_TYPE } from '@vsis/contracts'
import type { Project, Timesheet } from '@/app/types'
import ClassificationFields, { changeClassification, classificationFromEntry, classificationInput, emptyClassification, validateWebEntry } from '@/app/dashboard/classification-fields'
import TimeEntryForm from '@/app/dashboard/time-entry-form'
import BackfillForm from '@/app/dashboard/backfill-form'
import EntriesTable from '@/app/dashboard/entries-table'
import { buildBulkEditPayload } from '@/app/dashboard/bulk-edit-modal'
import { projectDashboardEntry, projectDashboardProject } from '@/lib/dashboard-seed'
import { getRecentWorkDetailed, saveRecentWorkDetailed } from '@/lib/cache'
import { mergePendingTimesheets } from '@/lib/optimistic-timesheets'

const common = { hoursWorked: 2, workDone: 'Work description', logDate: '2026-10-05' }
const legacy: Timesheet = { id: 'old', user_id: 'u', project_id: 'reserved', activity_type_id: 'old-activity', log_date: common.logDate, hours_worked: 2, work_done: common.workDone, created_at: '', projects: { name: 'Internal' }, activity_types: { name: 'Old R&D' } }
const support: Timesheet = { ...legacy, id: 'new', entry_type: 'support', activity_code: 'customers', project_id: null, activity_type_id: null, ticket_number: '00-A/b#', activity_other: null, projects: null, activity_types: null }
const projects: Project[] = [
  { id: 'reserved', name: 'Internal', is_timesheet_project: false, so_number: null, telegram_no: null, created_at: '' },
  { id: 'real', name: 'Real project', is_timesheet_project: true, so_number: null, telegram_no: null, created_at: '' },
]
afterEach(() => vi.unstubAllGlobals())

describe('web classification forms and payloads', () => {
  it('starts both fresh create surfaces with Type unselected and no project or activity picker', () => {
    const form = renderToStaticMarkup(createElement(TimeEntryForm, { today: common.logDate, projects, activityTypes: [], minLogDate: common.logDate, onLogged: () => {} }))
    const backfill = renderToStaticMarkup(createElement(BackfillForm, { allUsers: [], projects, activityTypes: [], onChanged: () => {} }))
    for (const html of [form, backfill]) {
      expect(html).toContain('value="" selected=""')
      expect(html).toContain('Select Type')
      expect(html).not.toContain('Search projects')
      expect(html).not.toContain('Select Activity')
      expect(html).not.toContain('value="reserved"')
    }
  })
  it.each(Object.entries(ACTIVITIES_BY_TYPE).flatMap(([type, codes]) => codes.map(code => [type, code])))('accepts %s / %s with shared validation', (entryType, activityCode) => {
    const result = validateWebEntry({ ...common, entryType: entryType as typeof support.entry_type, activityCode: activityCode as typeof support.activity_code, projectId: entryType === 'project' ? 'real' : null, ticketNumber: activityCode === 'customers' ? ' 00-Ab/12# ' : null, activityOther: activityCode === 'other' ? ' Research ' : null })
    expect(result.fieldErrors).toEqual({})
    expect(result.input?.ticketNumber).toBe(activityCode === 'customers' ? '00-Ab/12#' : null)
    expect(result.input?.activityOther).toBe(activityCode === 'other' ? 'Research' : null)
    expect(result.input?.activityTypeId).toBeNull()
  })
  it('rejects missing classification, blank details, incompatible activity and stale project without mutating the draft', () => {
    expect(validateWebEntry({ ...common, ...classificationInput(emptyClassification) }).fieldErrors).toMatchObject({ entryType: ['Type is required.'], activityCode: ['Activity is required.'] })
    const draft = { ...classificationFromEntry(support), ticketNumber: '  ' }
    expect(validateWebEntry({ ...common, ...classificationInput(draft) }).fieldErrors.ticketNumber).toEqual(['Ticket Number is required.'])
    expect(draft.ticketNumber).toBe('  ')
    expect(validateWebEntry({ ...common, entryType: 'internal', activityCode: 'customers' }).fieldErrors.activityCode).toBeDefined()
    expect(validateWebEntry({ ...common, entryType: 'support', activityCode: 'internal_it', projectId: 'reserved' }).fieldErrors.projectId).toBeDefined()
    expect(validateWebEntry({ ...common, entryType: 'internal', activityCode: 'other', activityOther: ' '.repeat(2) }).fieldErrors.activityOther).toBeDefined()
    expect(validateWebEntry({ ...common, entryType: 'project', activityCode: 'planning' }).fieldErrors.projectId).toBeDefined()
    expect(validateWebEntry({ ...common, entryType: 'support', activityCode: 'customers', ticketNumber: 'x'.repeat(101) }).fieldErrors.ticketNumber).toBeDefined()
    expect(validateWebEntry({ ...common, entryType: 'internal', activityCode: 'other', activityOther: 'x'.repeat(201) }).fieldErrors.activityOther).toBeDefined()
  })
  it('clears classification-only fields on Type and Activity changes, retaining unrelated fields', () => {
    const work = { ...common, ...classificationFromEntry(support), projectId: 'stale', activityOther: 'stale' }
    const typeChanged = { ...work, ...changeClassification(work, 'entryType', 'project') }
    expect(typeChanged).toMatchObject({ ...common, entryType: 'project', activityCode: '', projectId: '', ticketNumber: '', activityOther: '' })
    expect(changeClassification(work, 'activityCode', 'internal_it')).toMatchObject({ entryType: 'support', activityCode: 'internal_it', ticketNumber: '', activityOther: '' })
  })
  it('renders only compatible activities, conditional text limits and eligible projects', () => {
    const html = (value: ReturnType<typeof classificationFromEntry>) => renderToStaticMarkup(createElement(ClassificationFields, { value, projects, onChange: () => {} }))
    const customer = html(classificationFromEntry(support))
    expect(customer).toContain('Ticket Number'); expect(customer).toContain('maxLength="100"'); expect(customer).toContain('Enter Ticket Number')
    expect(customer).not.toContain('role="combobox"'); expect(customer).not.toContain('Implementation')
    const other = html({ ...emptyClassification, entryType: 'internal', activityCode: 'other' })
    expect(other).toContain('Other Activity'); expect(other).toContain('maxLength="200"'); expect(other).toContain('Describe the activity')
    const ineligible = html({ ...emptyClassification, entryType: 'project', projectId: 'reserved' })
    expect(ineligible).not.toContain('value="Internal"')
    expect(html({ ...emptyClassification, entryType: 'project', projectId: 'real' })).toContain('value="Real project"')
  })
  it('legacy copy drafts require classification; v2 copy and mixed bulk preserve details and stored formats', () => {
    expect(classificationFromEntry(legacy)).toEqual(emptyClassification)
    expect(classificationFromEntry(support)).toMatchObject({ entryType: 'support', activityCode: 'customers', projectId: '', ticketNumber: '00-A/b#' })
    const payload = buildBulkEditPayload([legacy, support], { projectId: 'real', activityTypeId: '' }, null)
    expect(payload[0]).toEqual({ id: 'old', projectId: 'real', activityTypeId: 'old-activity', ...common })
    expect(payload[1]).toMatchObject({ id: 'new', entryType: 'support', activityCode: 'customers', projectId: null, activityTypeId: null, ticketNumber: '00-A/b#' })
    const changed = buildBulkEditPayload([legacy, support], { projectId: '', activityTypeId: '' }, { ...emptyClassification, entryType: 'internal', activityCode: 'other', activityOther: 'POC notes' })
    expect(changed[0]).not.toHaveProperty('entryType')
    expect(changed[1]).toMatchObject({ entryType: 'internal', activityCode: 'other', activityOther: 'POC notes', ticketNumber: null, projectId: null })
    expect(validateWebEntry({ ...common, projectId: 'reserved', activityTypeId: 'old-activity' }, true).input).toBeTruthy()
  })
  it('renders type-qualified activities and details while leaving historical values visible', () => {
    const html = renderToStaticMarkup(createElement(EntriesTable, { timesheets: [legacy, support, { ...support, id: 'rd', entry_type: 'internal', activity_code: 'research_development', ticket_number: null }], projects, activityTypes: [], today: common.logDate, minLogDate: common.logDate, pagination: { user: '', page: 1, size: 50 }, totalCount: 3, loading: false, readError: null, scope: 'u', isSessionCurrent: () => true, isAdmin: true, canFilterByUser: false, onChanged: () => {} }))
    expect(html).toContain('Legacy · Old R&amp;D'); expect(html).toContain('Support · Customers'); expect(html).toContain('Ticket Number: 00-A/b#'); expect(html).toContain('Internal · R&amp;D')
  })
  it('preserves classification through sanitized seeds, optimism and current/old cache shapes', () => {
    expect(projectDashboardEntry(support)).toMatchObject({ project_id: null, entry_type: 'support', ticket_number: '00-A/b#' })
    expect(projectDashboardProject(projects[0]).is_timesheet_project).toBe(false)
    expect(mergePendingTimesheets([], new Map([[support.id, support]]))[0]).toBe(support)
    const storage = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) })
    storage.set('vsis-recent-work', JSON.stringify([{ text: 'Old cache', project: 'Internal', date: '' }]))
    expect(getRecentWorkDetailed()[0].entryType).toBeUndefined()
    const entry = { text: 'New cache', date: common.logDate, entryType: 'support' as const, activityCode: 'customers' as const, projectId: null, ticketNumber: '00-A/b#', activityOther: null }
    saveRecentWorkDetailed(entry)
    expect(getRecentWorkDetailed()[0]).toEqual(entry)
  })
})
