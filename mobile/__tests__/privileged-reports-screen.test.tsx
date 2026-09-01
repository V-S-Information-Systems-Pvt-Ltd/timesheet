import React from 'react';
import { ScreenTheme } from '../test-utils/theme-fixture';
import ReactTestRenderer from 'react-test-renderer';
import { PrivilegedReportsScreen } from '../src/screens/PrivilegedReportsScreen';
import { ReportsScreen } from '../src/screens/ReportsScreen';
import { SessionProvider } from '../src/auth/SessionProvider';
import { MemoryTokenStore } from '../src/platform/secure-storage';
import { ApiClient } from '../src/api/client';

jest.mock('../src/api/client');

describe('Privileged Reports Screen', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    ReactTestRenderer.act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  const mockUsers = [
    {
      id: 'u1',
      email: 'admin@vsis.lk',
      name: 'Admin User',
      department: 'Management',
      title: 'Director',
      role: 'admin',
      permissionRole: 'admin',
      hierarchyRole: 'manager',
      isActive: true,
    },
    {
      id: 'u2',
      email: 'alice@vsis.lk',
      name: 'Alice Dev',
      department: 'Engineering',
      title: 'Senior Engineer',
      role: 'user',
      permissionRole: 'user',
      hierarchyRole: 'engineer',
      isActive: true,
    },
  ];

  const mockReference = {
    projects: [{ id: 'p1', name: 'Alpha Core', is_active: true }],
    activityTypes: [{ id: 'a1', name: 'Software Architecture', is_active: true }],
  };

  const mockReportData = {
    totalHours: 40,
    totalEntries: 5,
    byGroup: [
      { label: 'alice@vsis.lk', hours: 32, entries: 4 },
      { label: 'admin@vsis.lk', hours: 8, entries: 1 },
    ],
  };

  it('loads privileged reports and renders aggregation buckets', async () => {
    const getReportsMock = jest.fn().mockResolvedValue(mockReportData);

    (ApiClient as jest.MockedClass<typeof ApiClient>).mockImplementation(() => {
      return {
        getConfig: jest.fn().mockResolvedValue({ apiVersion: 1, capabilities: { mobileApi: true } }),
        refresh: jest.fn().mockResolvedValue({
          accessToken: 'access-123',
          refreshToken: 'refresh-123',
          accessTokenExpiresAt: '',
          sessionId: 's1',
        }),
        getMe: jest.fn().mockResolvedValue({
          id: 'u1',
          email: 'admin@vsis.lk',
          role: 'admin',
          permissionRole: 'admin',
          hierarchyRole: 'manager',
          isActive: true,
          capabilities: { canManageSettings: true },
        }),
        getReference: jest.fn().mockResolvedValue(mockReference),
        listAdminUsers: jest.fn().mockResolvedValue(mockUsers),
        getReports: getReportsMock,
      } as unknown as ApiClient;
    });

    const store = new MemoryTokenStore();
    await store.write({ refreshToken: 'initial-refresh', sessionId: 's1' });
    const onBack = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <ScreenTheme>
        <SessionProvider initialServerUrl="https://timesheet.example.com" tokenStore={store}>
          <PrivilegedReportsScreen isDarkMode={false} onBack={onBack} />
        </SessionProvider>
        </ScreenTheme>
      );
    });

    // 1. Verify bucket rendering
    const bucket = renderer!.root.findByProps({ accessibilityLabel: 'Report bucket alice@vsis.lk: 32.0 hours' });
    expect(bucket).toBeDefined();

    // 2. Change group by to project
    const groupByProjectBtn = renderer!.root.findByProps({ accessibilityLabel: 'Group by By Project' });
    await ReactTestRenderer.act(async () => {
      groupByProjectBtn.props.onPress();
    });

    expect(getReportsMock).toHaveBeenCalledWith(
      'access-123',
      expect.objectContaining({
        groupBy: 'project',
      })
    );

  });

  it('renders standard ReportsScreen with member group tab for privileged actors', async () => {
    const getReportsMock = jest.fn().mockResolvedValue(mockReportData);

    (ApiClient as jest.MockedClass<typeof ApiClient>).mockImplementation(() => {
      return {
        getConfig: jest.fn().mockResolvedValue({ apiVersion: 1, capabilities: { mobileApi: true } }),
        refresh: jest.fn().mockResolvedValue({
          accessToken: 'access-123',
          refreshToken: 'refresh-123',
          accessTokenExpiresAt: '',
          sessionId: 's1',
        }),
        getMe: jest.fn().mockResolvedValue({
          id: 'u1',
          email: 'admin@vsis.lk',
          role: 'admin',
          permissionRole: 'admin',
          hierarchyRole: 'manager',
          isActive: true,
          capabilities: { canManageSettings: true },
        }),
        getReference: jest.fn().mockResolvedValue(mockReference),
        getReports: getReportsMock,
      } as unknown as ApiClient;
    });

    const store = new MemoryTokenStore();
    await store.write({ refreshToken: 'initial-refresh', sessionId: 's1' });
    const onBack = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <ScreenTheme>
        <SessionProvider initialServerUrl="https://timesheet.example.com" tokenStore={store}>
          <ReportsScreen isDarkMode={false} onBack={onBack} />
        </SessionProvider>
        </ScreenTheme>
      );
    });

    // 1. Verify Member tab exists
    const memberTab = renderer!.root.findByProps({ accessibilityLabel: 'Group by member' });
    expect(memberTab).toBeDefined();

    await ReactTestRenderer.act(async () => {
      memberTab.props.onPress();
    });

    expect(getReportsMock).toHaveBeenCalledWith(
      'access-123',
      expect.objectContaining({
        groupBy: 'user',
      })
    );

  });
});
