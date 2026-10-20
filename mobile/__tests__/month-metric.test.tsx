import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { useSessionActions, useSessionActor, useSessionDashboard, useSessionSync } from '../src/auth/SessionProvider';
import { HomeScreen } from '../src/screens/HomeScreen';
import { ScreenTheme } from '../test-utils/theme-fixture';
import { treeText } from '../test-utils/tree-text';

jest.mock('../src/auth/SessionProvider', () => ({
  useSessionActions: jest.fn(), useSessionActor: jest.fn(), useSessionDashboard: jest.fn(), useSessionSync: jest.fn(),
}));

const actor = { id: 'u1', email: 'a@example.com', role: 'user', permissionRole: 'user', hierarchyRole: 'user' };
const dashboard = {
  actor, today: { date: '2026-02-06', hours: 0 }, week: { from: '2026-01-31', to: '2026-02-06', hours: 0 }, recentEntries: [],
};

async function mount(listTimesheets: jest.Mock) {
  jest.mocked(useSessionActor).mockReturnValue({ actor } as unknown as ReturnType<typeof useSessionActor>);
  jest.mocked(useSessionSync).mockReturnValue({ isOffline: false } as ReturnType<typeof useSessionSync>);
  jest.mocked(useSessionDashboard).mockReturnValue({ dashboard, loadDashboard: jest.fn() } as unknown as ReturnType<typeof useSessionDashboard>);
  jest.mocked(useSessionActions).mockReturnValue({
    deleteTimesheet: jest.fn(), listTimesheets, listLeaves: jest.fn().mockResolvedValue([]), getBackfillWindow: jest.fn().mockResolvedValue(null),
  } as unknown as ReturnType<typeof useSessionActions>);
  let r!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    r = ReactTestRenderer.create(
      <ScreenTheme>
        <HomeScreen isDarkMode={false} onLogTime={jest.fn()} onViewTimesheets={jest.fn()} onViewProfile={jest.fn()}
          onViewReports={jest.fn()} onViewLeaves={jest.fn()} onViewReminders={jest.fn()} onLogTimeForDate={jest.fn()} />
      </ScreenTheme>
    );
  });
  return treeText(r);
}

describe('Home This Month metric', () => {
  it('shows month hours and entry count from the strip read', async () => {
    const texts = await mount(jest.fn().mockResolvedValue({ rows: [
      { id: 't1', user_id: 'u1', log_date: '2026-02-02', hours_worked: 8 },
      { id: 't2', user_id: 'u1', log_date: '2026-02-03', hours_worked: 4.5 },
    ] }));
    expect(texts).toContain('This month');
    expect(texts).toContain('12.5 hrs2 entries');
  });

  it('shows a dash, not zero, when the month read fails', async () => {
    const texts = await mount(jest.fn().mockRejectedValue(new Error('boom')));
    expect(texts).toContain('This month—');
  });
});
