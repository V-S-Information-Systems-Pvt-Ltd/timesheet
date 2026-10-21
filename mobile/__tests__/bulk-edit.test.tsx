import React from 'react';
import { Alert } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { TimesheetListScreen } from '../src/screens/TimesheetListScreen';
import { SearchablePickerModal } from '../src/components/SearchablePickerModal';
import { buildBulkEditPayload, emptyBulkEditDraft } from '../src/components/BulkEditModal';
import { ScreenTheme } from '../test-utils/theme-fixture';
import type { TimesheetEntry } from '../src/api/contracts';
import { useSessionActions, useSessionActor, useSessionReference, useSessionSync } from '../src/auth/SessionProvider';

jest.mock('../src/auth/SessionProvider', () => ({
  useSessionActions: jest.fn(), useSessionActor: jest.fn(), useSessionReference: jest.fn(), useSessionSync: jest.fn(),
}));

const base = { user_id: 'u1', hours_worked: 4, work_done: 'Work', created_at: '' };
const legacyA = { ...base, id: 't1', project_id: 'p1', project_name: 'Alpha', activity_type_id: 'a1', log_date: '2026-08-26' } as TimesheetEntry;
const legacyB = { ...base, id: 't2', project_id: 'p1', project_name: 'Alpha', activity_type_id: 'a1', log_date: '2026-08-27' } as TimesheetEntry;
const support = {
  ...base, id: 't3', project_id: null, activity_type_id: null, log_date: '2026-08-28',
  entry_type: 'support', activity_code: 'customers', ticket_number: 'INC 00012345', customer: 'ACME',
} as TimesheetEntry;

describe('buildBulkEditPayload', () => {
  it('applies only changed legacy fields and keeps the rest of each row', () => {
    const { payload, error } = buildBulkEditPayload([legacyA, legacyB], { ...emptyBulkEditDraft, projectId: 'p2' });
    expect(error).toBeNull();
    expect(payload).toEqual([
      { id: 't1', projectId: 'p2', activityTypeId: 'a1', hoursWorked: 4, workDone: 'Work', logDate: '2026-08-26' },
      { id: 't2', projectId: 'p2', activityTypeId: 'a1', hoursWorked: 4, workDone: 'Work', logDate: '2026-08-27' },
    ]);
  });

  it('never reclassifies a new-format row from a legacy change', () => {
    const { payload } = buildBulkEditPayload([legacyA, support], { ...emptyBulkEditDraft, projectId: 'p2' });
    expect(payload[1]).toMatchObject({ id: 't3', entryType: 'support', activityCode: 'customers', ticketNumber: 'INC00012345', customer: 'ACME' });
    expect(payload[1].projectId ?? null).toBeNull();
  });

  it('reports a validation error for an incomplete reclassification', () => {
    const { payload, error } = buildBulkEditPayload([support], { ...emptyBulkEditDraft, replaceClassification: true, entryType: 'support' });
    expect(payload).toEqual([]);
    expect(error).toEqual(expect.any(String));
  });
});

describe('TimesheetListScreen bulk edit', () => {
  let batchUpdateTimesheets: jest.Mock;
  let listTimesheets: jest.Mock;
  let alert: jest.SpyInstance;
  let renderer: ReactTestRenderer.ReactTestRenderer;

  async function mount(isOffline = false) {
    batchUpdateTimesheets = jest.fn();
    listTimesheets = jest.fn().mockResolvedValue({ rows: [legacyA, legacyB], total: 2 });
    (useSessionActor as jest.Mock).mockReturnValue({ actor: { id: 'u1', role: 'user' }, effectiveActor: null });
    (useSessionSync as jest.Mock).mockReturnValue({ isOffline });
    (useSessionReference as jest.Mock).mockReturnValue({
      reference: { projects: [{ id: 'p1', name: 'Alpha' }, { id: 'p2', name: 'Beta' }], activityTypes: [{ id: 'a1', name: 'Dev' }] },
      loadReference: jest.fn(),
    });
    (useSessionActions as jest.Mock).mockReturnValue({
      listTimesheets, batchUpdateTimesheets, deleteTimesheet: jest.fn(), deleteTimesheets: jest.fn(),
      duplicateTimesheet: jest.fn(), duplicateTimesheets: jest.fn(),
    });
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <ScreenTheme><TimesheetListScreen isDarkMode={false} onBack={jest.fn()} onLogTime={jest.fn()} /></ScreenTheme>
      );
    });
  }
  const press = async (label: string) =>
    ReactTestRenderer.act(async () => { renderer.root.findAllByProps({ accessibilityLabel: label })[0].props.onPress(); });
  const save = async (projectId = 'p2') => {
    await press('Select multiple entries');
    await press('Select all');
    await press('Edit 2 selected entries');
    await press('Choose project');
    await ReactTestRenderer.act(async () => {
      renderer.root.findAllByType(SearchablePickerModal)[0].props.onSelect({ id: projectId, name: 'Beta' });
    });
    await press('Save changes');
  };

  beforeEach(() => { alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {}); });
  afterEach(async () => {
    await ReactTestRenderer.act(async () => { renderer.unmount(); });
    alert.mockRestore();
  });

  const reportText = () => renderer.root.findAllByProps({ accessibilityLiveRegion: 'polite' })[0]?.findAll((n) => typeof n.children[0] === 'string').map((n) => n.children[0]).join(' ');

  it('sends only the changed field and refreshes the list on success', async () => {
    await mount();
    batchUpdateTimesheets.mockResolvedValue({ updated: 2 });
    await save();
    expect(batchUpdateTimesheets).toHaveBeenCalledWith([
      expect.objectContaining({ id: 't1', projectId: 'p2', activityTypeId: 'a1' }),
      expect.objectContaining({ id: 't2', projectId: 'p2', activityTypeId: 'a1' }),
    ]);
    expect(listTimesheets).toHaveBeenCalledTimes(2);
    expect(reportText()).toBeUndefined();
  });

  it('reports a partial failure through the batch report', async () => {
    await mount();
    batchUpdateTimesheets.mockResolvedValue({ updated: 1, errors: ['Entry t2: date is locked'] });
    await save();
    expect(reportText()).toContain('Bulk edit finished with errors');
    expect(reportText()).toContain('1 of 2 entries edited');
    expect(reportText()).toContain('date is locked');
    expect(listTimesheets).toHaveBeenCalledTimes(2);
  });

  it('reports All edits failed. when nothing was updated', async () => {
    await mount();
    batchUpdateTimesheets.mockResolvedValue({ updated: 0, errors: ['nope', 'nope again'] });
    await save();
    expect(reportText()).toContain('All edits failed.');
    expect(listTimesheets).toHaveBeenCalledTimes(1);
  });

  it('blocks bulk edit while offline without writing', async () => {
    await mount(true);
    await press('Select multiple entries');
    await press('Select all');
    await press('Edit 2 selected entries');
    expect(alert).toHaveBeenCalledWith('You are offline', expect.stringContaining('not saved for later'));
    expect(renderer.root.findAllByProps({ accessibilityLabel: 'Save changes' })).toHaveLength(0);
    expect(batchUpdateTimesheets).not.toHaveBeenCalled();
  });
});
