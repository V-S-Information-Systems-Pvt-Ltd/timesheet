import React from 'react';
import { Text } from 'react-native';
import { ScreenTheme } from '../test-utils/theme-fixture';
import ReactTestRenderer from 'react-test-renderer';
import { HomeScreen } from '../src/screens/HomeScreen';
import { SessionProvider } from '../src/auth/SessionProvider';
import { MemoryTokenStore } from '../test-utils/memory-token-store';
import { ApiClient } from '../src/api/client';
import { formatDateRangeShort } from '../src/utils/dates';

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

  const dashboardPayload = {
    actor: {
      id: 'u1',
      email: 'employee@example.com',
      role: 'user',
      permissionRole: 'user',
      hierarchyRole: 'user',
      isActive: true,
    },
    today: { date: '2026-08-26', hours: 7.5 },
    // Rolling 7-day window returned by lib/api/v1/services/dashboard.ts
    // (from = today - 6, to = today), NOT a calendar week.
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
  };

  function makeHandlers() {
    return {
      onViewTimesheets: jest.fn(),
      onLogTime: jest.fn(),
      onViewProfile: jest.fn(),
      onViewReports: jest.fn(),
      onViewLeaves: jest.fn(),
      onViewReminders: jest.fn(),
    };
  }

  async function renderHomeScreen(payload: unknown, handlers: ReturnType<typeof makeHandlers>) {
    (ApiClient as jest.MockedClass<typeof ApiClient>).mockImplementation(() => {
      return {
        getConfig: jest.fn().mockResolvedValue({}),
        refresh: jest.fn().mockResolvedValue({
          accessToken: 'acc-u1',
          refreshToken: 'ref-u1-2',
          accessTokenExpiresAt: '',
          sessionId: 's-u1',
        }),
        getMe: jest.fn().mockResolvedValue(dashboardPayload.actor),
        getDashboard: jest.fn().mockResolvedValue(payload),
      } as unknown as ApiClient;
    });

    // An authenticated session is required for SessionProvider to load the
    // dashboard; without it HomeScreen renders the offline/empty fallback.
    const store = new MemoryTokenStore();
    await store.write({ refreshToken: 'ref-u1-1', sessionId: 's-u1' });

    let renderer: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <ScreenTheme>
          <SessionProvider initialServerUrl="https://timesheet.example.com" tokenStore={store}>
            <HomeScreen isDarkMode={false} {...handlers} />
          </SessionProvider>
        </ScreenTheme>
      );
    });
    return renderer!;
  }

  it('exposes exactly one profile entry point and opens the profile from it', async () => {
    const handlers = makeHandlers();
    const renderer = await renderHomeScreen(dashboardPayload, handlers);

    // Exactly one tappable profile target, and the identity block is no longer a
    // second (duplicate) one. Host nodes are counted because findAllByProps also
    // matches the composite and host node of the same element.
    const profileHosts = renderer.root.findAll(
      (node) => typeof node.type === 'string' && node.props.accessibilityLabel === 'My profile'
    );
    expect(profileHosts).toHaveLength(1);
    expect(renderer.root.findAllByProps({ accessibilityLabel: 'View profile' })).toHaveLength(0);
    expect(
      renderer.root.findAll(
        (node) => typeof node.type === 'string' && node.props.accessibilityRole === 'button' &&
          node.props.accessibilityLabel === 'My profile'
      )
    ).toHaveLength(1);

    const profileButton = renderer.root.findByProps({ accessibilityLabel: 'My profile' });
    await ReactTestRenderer.act(async () => {
      profileButton.props.onPress();
    });
    expect(handlers.onViewProfile).toHaveBeenCalledTimes(1);

    // Loaded state still renders after removing the unreachable isLoading branch.
    expect(
      renderer.root.findAllByProps({ children: 'Recent Timesheet Entries' }).length
    ).toBeGreaterThan(0);
    expect(renderer.root.findAllByProps({ children: 'Loading dashboard...' })).toHaveLength(0);
  });

  it('labels the rolling 7-day metric with the dashboard window, not a calendar week', async () => {
    const handlers = makeHandlers();
    const renderer = await renderHomeScreen(dashboardPayload, handlers);

    const weekMetric = renderer.root.findAllByProps({ label: 'Last 7 Days' });
    expect(weekMetric.length).toBeGreaterThan(0);

    // Value and window both come from the payload: week.hours 37.5 over
    // week.from/week.to; a calendar-week label ("This Week") is not used.
    expect(
      renderer.root.findAllByProps({
        accessibilityLabel: 'Last 7 Days: 37.5 hrs. Tap to view reports.',
      }).length
    ).toBeGreaterThan(0);

    // Label and dateLabel both describe the payload's rolling window, in
    // readable copy: no machine-facing ISO date reaches the screen.
    expect(renderer.root.findAllByProps({ children: 'Last 7 Days' }).length).toBeGreaterThan(0);
    expect(
      renderer.root.findAllByProps({
        children: formatDateRangeShort('2026-08-20', '2026-08-26'),
      }).length
    ).toBeGreaterThan(0);
    expect(renderer.root.findAllByProps({ children: 'This Week' })).toHaveLength(0);

    const visibleText = renderer.root
      .findAllByType(Text)
      .flatMap((node) => node.props.children)
      .filter((child): child is string => typeof child === 'string');
    expect(visibleText).not.toContain('2026-08-20 – 2026-08-26');
    expect(visibleText.some((text) => text.includes(formatDateRangeShort('2026-08-20', '2026-08-26'))))
      .toBe(true);
  });

  it('renders the unauthenticated fallback without the removed loading branch', async () => {
    const getDashboard = jest.fn();
    (ApiClient as jest.MockedClass<typeof ApiClient>).mockImplementation(() => {
      return {
        getConfig: jest.fn().mockResolvedValue({}),
        getDashboard,
      } as unknown as ApiClient;
    });

    let renderer: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <ScreenTheme>
          <SessionProvider
            initialServerUrl="https://timesheet.example.com"
            tokenStore={new MemoryTokenStore()}
          >
            <HomeScreen isDarkMode={false} {...makeHandlers()} />
          </SessionProvider>
        </ScreenTheme>
      );
    });

    // Fallback metric labels still render, and the nested branch that could
    // never be reached is gone rather than lingering as dead code.
    expect(renderer!.root.findAllByProps({ label: "Today's Hours" }).length).toBeGreaterThan(0);
    expect(renderer!.root.findAllByProps({ label: 'Last 7 Days' }).length).toBeGreaterThan(0);
    expect(
      renderer!.root.findAllByProps({ children: 'Loading dashboard...' })
    ).toHaveLength(0);
  });
});
