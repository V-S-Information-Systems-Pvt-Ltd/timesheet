import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {
  useSessionActions,
  useSessionActor,
  useSessionDashboard,
  useSessionData,
  useSessionReference,
  useSessionStatus,
  useSessionSync,
} from '../src/auth/SessionProvider';
import { HomeScreen } from '../src/screens/HomeScreen';
import { SettingsAdminScreen } from '../src/screens/SettingsAdminScreen';
import { formatDatePreview } from '../src/utils/dates';
import { ScreenTheme } from '../test-utils/theme-fixture';

jest.mock('../src/auth/SessionProvider', () => ({
  useSessionActions: jest.fn(),
  useSessionActor: jest.fn(),
  useSessionDashboard: jest.fn(),
  useSessionData: jest.fn(),
  useSessionReference: jest.fn(),
  useSessionStatus: jest.fn(),
  useSessionSync: jest.fn(),
}));

const actor = {
  id: 'u1', email: 'admin@example.com', role: 'admin',
  permissionRole: 'admin', hierarchyRole: 'manager', isActive: true,
} as const;
const reference = {
  projects: [{ id: 'p1', name: 'Project', is_active: true }],
  activityTypes: [{ id: 'a1', name: 'Development', is_active: true }],
};
const entry = {
  id: 't1', user_id: actor.id, project_id: 'p1', activity_type_id: 'a1',
  log_date: '2026-10-03', hours_worked: 8, work_done: 'Reviewed work',
};
const createTimesheet = jest.fn();
const actions = {
  createTimesheet,
  deleteTimesheet: jest.fn(),
  getBackfillSettings: jest.fn().mockResolvedValue({ mode: 'days', windowDays: 7, extraDays: 0 }),
  listAdminUsers: jest.fn().mockResolvedValue([{ ...actor, name: 'Admin User' }]),
};
const data = { reference, loadReference: jest.fn().mockResolvedValue(reference) };
const referenceSlice = { reference, loadReference: jest.fn().mockResolvedValue(reference) };
const dashboard = {
  actor, today: { date: entry.log_date, hours: 8 },
  week: { from: '2026-09-27', to: entry.log_date, hours: 8 },
  recentEntries: [entry, { ...entry, id: 't2', user_id: 'u2', log_date: '2026-10-02' }], quickActions: [],
};
let renderer: ReactTestRenderer.ReactTestRenderer;

beforeEach(() => {
  jest.clearAllMocks();
  createTimesheet.mockReset();
  jest.mocked(useSessionActor).mockReturnValue({ actor, effectiveActor: actor } as ReturnType<typeof useSessionActor>);
  jest.mocked(useSessionActions).mockReturnValue(actions as unknown as ReturnType<typeof useSessionActions>);
  jest.mocked(useSessionData).mockReturnValue(data as unknown as ReturnType<typeof useSessionData>);
  jest.mocked(useSessionReference).mockReturnValue(referenceSlice as unknown as ReturnType<typeof useSessionReference>);
  jest.mocked(useSessionStatus).mockReturnValue({ branding: null } as unknown as ReturnType<typeof useSessionStatus>);
  jest.mocked(useSessionSync).mockReturnValue({ isOffline: false } as ReturnType<typeof useSessionSync>);
  jest.mocked(useSessionDashboard).mockReturnValue({
    dashboard, loadDashboard: jest.fn(),
  } as unknown as ReturnType<typeof useSessionDashboard>);
});

afterEach(() => {
  ReactTestRenderer.act(() => renderer?.unmount());
});

async function mount(screen: React.ReactElement) {
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(<ScreenTheme>{screen}</ScreenTheme>);
  });
}

async function submitAdminTime() {
  await mount(<SettingsAdminScreen isDarkMode={false} onBack={jest.fn()} />);
  await ReactTestRenderer.act(async () => {
    renderer.root.findAllByProps({ accessibilityLabel: 'Support' })[0].props.onPress();
  });
  await ReactTestRenderer.act(async () => {
    renderer.root.findAllByProps({ accessibilityLabel: 'Internal IT' })[0].props.onPress();
  });
  await ReactTestRenderer.act(async () => {
    renderer.root.findByProps({ accessibilityLabel: 'Hours Worked' }).props.onChangeText('8');
    renderer.root.findByProps({ accessibilityLabel: 'Work Done' }).props.onChangeText('Reviewed work');
  });
  await ReactTestRenderer.act(async () => {
    await renderer.root.findByProps({ accessibilityLabel: 'Save timesheet entry' }).props.onPress();
  });
}

describe('admin timesheet outcome copy', () => {
  it.each([
    [false, 'Timesheet logged successfully for user.', 'Saved offline for user — will sync when you reconnect.'],
    [true, 'Saved offline for user — will sync when you reconnect.', 'Timesheet logged successfully for user.'],
  ])('distinguishes queued=%s from committed success', async (queued, expected, absent) => {
    createTimesheet.mockResolvedValue({ queued });
    await submitAdminTime();

    expect(createTimesheet).toHaveBeenCalledWith(expect.objectContaining({ userId: actor.id, workDone: 'Reviewed work' }));
    expect(renderer.root.findAllByProps({ children: expected }).length).toBeGreaterThan(0);
    expect(renderer.root.findAllByProps({ children: absent })).toHaveLength(0);
    expect(renderer.root.findByProps({ accessibilityLabel: 'Work Done' }).props.value).toBe('');
  });

  it('retains the draft and reports rejection without claiming success', async () => {
    createTimesheet.mockRejectedValue(new Error('Could not save entry.'));
    await submitAdminTime();

    expect(renderer.root.findAllByProps({ children: 'Could not save entry.' }).length).toBeGreaterThan(0);
    expect(renderer.root.findAllByProps({ children: 'Timesheet logged successfully for user.' })).toHaveLength(0);
    expect(renderer.root.findAllByProps({ children: 'Saved offline for user — will sync when you reconnect.' })).toHaveLength(0);
    expect(renderer.root.findByProps({ accessibilityLabel: 'Work Done' }).props.value).toBe('Reviewed work');
  });
});

describe('HomeScreen own-entry delete identity', () => {
  it.each([
    ['dashboard fallback', null, actor, [true, false]],
    ['session actor precedence', { ...actor, id: 'u2' }, actor, [false, true]],
    ['no resolved identity', null, undefined, [false, false]],
  ])('uses %s without exposing another owner\'s delete affordance', async (_label, sessionActor, dashboardActor, expected) => {
    jest.mocked(useSessionActor).mockReturnValue({ actor: sessionActor } as ReturnType<typeof useSessionActor>);
    jest.mocked(useSessionDashboard).mockReturnValue({
      dashboard: { ...dashboard, actor: dashboardActor }, loadDashboard: jest.fn(),
    } as unknown as ReturnType<typeof useSessionDashboard>);
    await mount(
      <HomeScreen
        isDarkMode={false} onLogTime={jest.fn()} onViewTimesheets={jest.fn()}
        onViewProfile={jest.fn()} onViewReports={jest.fn()}
        onViewLeaves={jest.fn()} onViewReminders={jest.fn()}
      />
    );

    const deleteButtons = dashboard.recentEntries.map((recentEntry) =>
      renderer.root.findAll((node) => typeof node.type === 'string' &&
        node.props.accessibilityLabel === `Delete entry on ${formatDatePreview(recentEntry.log_date)}`
      ).length > 0
    );
    expect(deleteButtons).toEqual(expected);
  });
});
