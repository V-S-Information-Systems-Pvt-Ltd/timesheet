import React from 'react';
import { ScreenTheme } from '../test-utils/theme-fixture';
import ReactTestRenderer from 'react-test-renderer';
import { HomeScreen } from '../src/screens/HomeScreen';
import { SessionProvider } from '../src/auth/SessionProvider';
import { MemoryTokenStore } from '../src/platform/secure-storage';
import { ApiClient } from '../src/api/client';

jest.mock('../src/api/client');

describe('HomeScreen', () => {
  it('renders user details, metric summaries, and action buttons', async () => {
    (ApiClient as jest.MockedClass<typeof ApiClient>).mockImplementation(() => {
      return {
        getConfig: jest.fn().mockResolvedValue({}),
        getDashboard: jest.fn().mockResolvedValue({
          actor: {
            id: 'u1',
            email: 'employee@example.com',
            role: 'user',
            permissionRole: 'user',
            hierarchyRole: 'user',
            isActive: true,
          },
          today: { date: '2026-08-26', hours: 7.5 },
          week: { from: '2026-08-20', to: '2026-08-26', hours: 37.5 },
          recentEntries: [
            {
              id: 't1',
              user_id: 'u1',
              project_id: 'p1',
              project_name: 'Project Alpha',
              activity_type_id: 'a1',
              activity_name: 'Development',
              log_date: '2026-08-26',
              hours_worked: 7.5,
              work_done: 'Project work',
            },
          ],
          quickActions: ['create-timesheet'],
        }),
      } as unknown as ApiClient;
    });

    const store = new MemoryTokenStore();
    const onViewTimesheets = jest.fn();
    const onLogTime = jest.fn();
    const onViewProfile = jest.fn();
    const onViewReports = jest.fn();
    const onViewLeaves = jest.fn();
    const onViewReminders = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <ScreenTheme>
        <SessionProvider initialServerUrl="https://timesheet.example.com" tokenStore={store}>
          <HomeScreen
            isDarkMode={false}
            onLogTime={onLogTime}
            onViewLeaves={onViewLeaves}
            onViewProfile={onViewProfile}
            onViewReminders={onViewReminders}
            onViewReports={onViewReports}
            onViewTimesheets={onViewTimesheets}
          />
        </SessionProvider>
        </ScreenTheme>
      );
    });

    const viewAllBtn = renderer!.root.findByProps({ accessibilityLabel: 'View all timesheets' });
    expect(viewAllBtn).toBeDefined();

    await ReactTestRenderer.act(async () => {
      viewAllBtn.props.onPress();
    });
    expect(onViewTimesheets).toHaveBeenCalledTimes(1);

    const logTimeBtn = renderer!.root.findByProps({ accessibilityLabel: 'Log time' });
    expect(logTimeBtn).toBeDefined();

    await ReactTestRenderer.act(async () => {
      logTimeBtn.props.onPress();
    });
    expect(onLogTime).toHaveBeenCalledTimes(1);
  });

  it('hides Team button for PM without manager hierarchy, but shows for Manager', async () => {
    // 1. PM user without managerial role
    const pmActor = {
      id: 'pm-1',
      email: 'pm@example.com',
      role: 'pm',
      permissionRole: 'pm',
      hierarchyRole: 'user',
      isActive: true,
      capabilities: {
        canViewTeam: false,
        canManageProjects: true,
        canManageActivities: false,
        canManageUsers: false,
        canManageSettings: false,
      },
    };
    (ApiClient as jest.MockedClass<typeof ApiClient>).mockImplementation(() => {
      return {
        getConfig: jest.fn().mockResolvedValue({}),
        refresh: jest.fn().mockResolvedValue({
          accessToken: 'acc-pm',
          refreshToken: 'ref-pm-2',
          accessTokenExpiresAt: '',
          sessionId: 's-pm',
        }),
        getMe: jest.fn().mockResolvedValue(pmActor),
        getDashboard: jest.fn().mockResolvedValue({
          actor: pmActor,
          today: { date: '2026-08-26', hours: 0 },
          week: { from: '2026-08-20', to: '2026-08-26', hours: 0 },
          recentEntries: [],
          quickActions: [],
        }),
      } as unknown as ApiClient;
    });

    const store = new MemoryTokenStore();
    await store.write({ refreshToken: 'ref-pm-1', sessionId: 's-pm' });
    const onViewTeam = jest.fn();
    const dummyHandlers = {
      onViewTimesheets: jest.fn(),
      onLogTime: jest.fn(),
      onViewProfile: jest.fn(),
      onViewReports: jest.fn(),
      onViewLeaves: jest.fn(),
      onViewReminders: jest.fn(),
      onViewTeam,
    };
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <ScreenTheme>
        <SessionProvider initialServerUrl="https://timesheet.example.com" tokenStore={store}>
          <HomeScreen
            isDarkMode={false}
            {...dummyHandlers}
          />
        </SessionProvider>
        </ScreenTheme>
      );
    });

    expect(renderer!.root.findAllByProps({ accessibilityLabel: 'View team' })).toHaveLength(0);

    // 2. Manager user
    const mgrActor = {
      id: 'mgr-1',
      email: 'mgr@example.com',
      role: 'manager',
      permissionRole: 'user',
      hierarchyRole: 'manager',
      isActive: true,
      capabilities: {
        canViewTeam: true,
        canManageProjects: false,
        canManageActivities: false,
        canManageUsers: false,
        canManageSettings: false,
      },
    };
    (ApiClient as jest.MockedClass<typeof ApiClient>).mockImplementation(() => {
      return {
        getConfig: jest.fn().mockResolvedValue({}),
        refresh: jest.fn().mockResolvedValue({
          accessToken: 'acc-mgr',
          refreshToken: 'ref-mgr-2',
          accessTokenExpiresAt: '',
          sessionId: 's-mgr',
        }),
        getMe: jest.fn().mockResolvedValue(mgrActor),
        getDashboard: jest.fn().mockResolvedValue({
          actor: mgrActor,
          today: { date: '2026-08-26', hours: 0 },
          week: { from: '2026-08-20', to: '2026-08-26', hours: 0 },
          recentEntries: [],
          quickActions: [],
        }),
      } as unknown as ApiClient;
    });

    const store2 = new MemoryTokenStore();
    await store2.write({ refreshToken: 'ref-mgr-1', sessionId: 's-mgr' });
    let renderer2: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer2 = ReactTestRenderer.create(
        <ScreenTheme>
        <SessionProvider initialServerUrl="https://timesheet.example.com" tokenStore={store2}>
          <HomeScreen
            isDarkMode={false}
            {...dummyHandlers}
          />
        </SessionProvider>
        </ScreenTheme>
      );
    });

    expect(renderer2!.root.findByProps({ accessibilityLabel: 'View team' })).toBeDefined();
  });
});
