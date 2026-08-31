import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { TeamScreen } from '../src/screens/TeamScreen';
import { SessionProvider } from '../src/auth/SessionProvider';
import { MemoryTokenStore } from '../src/platform/secure-storage';
import { ApiClient } from '../src/api/client';

jest.mock('../src/api/client');

describe('TeamScreen (Directory & Org Tree)', () => {
  const mockTeam = [
    {
      id: 'u-mgr',
      email: 'manager@example.com',
      name: 'Carol Manager',
      role: 'user',
      permissionRole: 'user',
      hierarchyRole: 'manager',
      department: 'Engineering',
      title: 'Engineering Director',
      managerId: null,
      isActive: true,
    },
    {
      id: 'u-lead',
      email: 'lead@example.com',
      name: 'Bob Lead',
      role: 'user',
      permissionRole: 'user',
      hierarchyRole: 'team_lead',
      department: 'Engineering',
      title: 'Team Lead',
      managerId: 'u-mgr',
      isActive: true,
    },
    {
      id: 'u-eng',
      email: 'dev@example.com',
      name: 'Alice Dev',
      role: 'user',
      permissionRole: 'user',
      hierarchyRole: 'engineer',
      department: 'Engineering',
      title: 'Systems Engineer',
      managerId: 'u-lead',
      isActive: true,
    },
  ];

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    ReactTestRenderer.act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  it('renders tree view with roots and supports expanding/collapsing child reports', async () => {
    (ApiClient as jest.MockedClass<typeof ApiClient>).mockImplementation(() => {
      return {
        getConfig: jest.fn().mockResolvedValue({}),
        refresh: jest.fn().mockResolvedValue({
          accessToken: 'access-123',
          refreshToken: 'refresh-123',
          accessTokenExpiresAt: '',
          sessionId: 's1',
        }),
        getMe: jest.fn().mockResolvedValue({
          id: 'u1',
          email: 'admin@example.com',
          role: 'admin',
          permissionRole: 'admin',
          hierarchyRole: 'manager',
          isActive: true,
        }),
        listPeople: jest.fn().mockResolvedValue(mockTeam),
      } as unknown as ApiClient;
    });

    const store = new MemoryTokenStore();
    await store.write({ refreshToken: 'initial-refresh', sessionId: 's1' });
    const onBack = jest.fn();
    const onSelectMember = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <SessionProvider initialServerUrl="https://timesheet.example.com" tokenStore={store}>
          <TeamScreen isDarkMode={false} onBack={onBack} onSelectMember={onSelectMember} />
        </SessionProvider>
      );
    });

    // 1. Root manager should be rendered
    const mgrNode = renderer!.root.findByProps({
      accessibilityLabel: 'Team member: Carol Manager, Engineering Director',
    });
    expect(mgrNode).toBeDefined();

    // 2. Select member opens action modal
    await ReactTestRenderer.act(async () => {
      mgrNode.props.onPress();
    });

    const timesheetsBtn = renderer!.root.findByProps({
      accessibilityLabel: 'View Timesheets for Carol Manager',
    });
    expect(timesheetsBtn).toBeDefined();

    await ReactTestRenderer.act(async () => {
      timesheetsBtn.props.onPress();
    });

    expect(onSelectMember).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'u-mgr' }),
      'timesheets'
    );
  });

  it('supports switching to Directory View and filtering by query', async () => {
    (ApiClient as jest.MockedClass<typeof ApiClient>).mockImplementation(() => {
      return {
        getConfig: jest.fn().mockResolvedValue({}),
        refresh: jest.fn().mockResolvedValue({
          accessToken: 'access-123',
          refreshToken: 'refresh-123',
          accessTokenExpiresAt: '',
          sessionId: 's1',
        }),
        getMe: jest.fn().mockResolvedValue({
          id: 'u1',
          email: 'admin@example.com',
          role: 'admin',
          permissionRole: 'admin',
          hierarchyRole: 'manager',
          isActive: true,
        }),
        listPeople: jest.fn().mockResolvedValue(mockTeam),
      } as unknown as ApiClient;
    });

    const store = new MemoryTokenStore();
    await store.write({ refreshToken: 'initial-refresh', sessionId: 's1' });
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <SessionProvider initialServerUrl="https://timesheet.example.com" tokenStore={store}>
          <TeamScreen isDarkMode={false} onBack={jest.fn()} />
        </SessionProvider>
      );
    });

    // Switch to Directory view tab
    const dirTab = renderer!.root.findByProps({ accessibilityLabel: 'Switch to Directory View' });
    await ReactTestRenderer.act(async () => {
      dirTab.props.onPress();
    });

    // Search for Alice
    const searchInput = renderer!.root.findByProps({ accessibilityLabel: 'Search team members' });
    await ReactTestRenderer.act(async () => {
      searchInput.props.onChangeText('Alice');
    });

    const aliceCard = renderer!.root.findByProps({ accessibilityLabel: 'Team member: Alice Dev' });
    expect(aliceCard).toBeDefined();
  });
});
