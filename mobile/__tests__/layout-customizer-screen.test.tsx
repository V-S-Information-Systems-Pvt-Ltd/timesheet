import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { LayoutCustomizerScreen } from '../src/screens/LayoutCustomizerScreen';
import { SessionProvider } from '../src/auth/SessionProvider';
import { MemoryTokenStore } from '../src/platform/secure-storage';
import { ApiClient } from '../src/api/client';
import { DEFAULT_MOBILE_LAYOUT } from '../src/navigation/modules';

jest.mock('../src/api/client');
jest.setTimeout(15000);

describe('LayoutCustomizerScreen', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    ReactTestRenderer.act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  it('renders modules list and allows toggling non-essential modules', async () => {
    (ApiClient as jest.MockedClass<typeof ApiClient>).mockImplementation(() => {
      return {
        getConfig: jest.fn().mockResolvedValue({ apiVersion: 1, capabilities: { mobileApi: true } }),
        getLayout: jest.fn().mockResolvedValue({
          layout: DEFAULT_MOBILE_LAYOUT,
          savedLayout: null,
          defaultLayout: DEFAULT_MOBILE_LAYOUT,
          capabilities: {
            canViewTeam: true,
            canManageProjects: true,
            canManageActivities: true,
            canManageUsers: true,
            canManageSettings: true,
          },
        }),
        updateLayout: jest.fn().mockResolvedValue({
          layout: DEFAULT_MOBILE_LAYOUT,
          savedLayout: DEFAULT_MOBILE_LAYOUT,
        }),
        resetLayout: jest.fn().mockResolvedValue({
          layout: DEFAULT_MOBILE_LAYOUT,
          savedLayout: null,
        }),
      } as unknown as ApiClient;
    });

    const store = new MemoryTokenStore();
    const onGoBack = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <SessionProvider initialServerUrl="https://timesheet.example.com" tokenStore={store}>
          <LayoutCustomizerScreen isDarkMode={false} onGoBack={onGoBack} />
        </SessionProvider>
      );
    });

    // Verify back button is accessible
    const backBtn = renderer!.root.findByProps({ accessibilityLabel: 'Back to more' });
    expect(backBtn).toBeDefined();

    await ReactTestRenderer.act(async () => {
      backBtn.props.onPress();
    });
    expect(onGoBack).toHaveBeenCalledTimes(1);

    // Verify essential module switch is disabled
    const logTimeSwitch = renderer!.root.findByProps({ accessibilityLabel: 'Toggle Log Time' });
    expect(logTimeSwitch.props.disabled).toBe(true);

    // Verify non-essential module switch is enabled
    const leavesSwitch = renderer!.root.findByProps({ accessibilityLabel: 'Toggle Mark Leave' });
    expect(leavesSwitch.props.disabled).toBe(false);
  });

  it('allows admins to toggle between personal layout and workspace default scope', async () => {
    const mockUpdateAdminDefault = jest.fn().mockResolvedValue({ layout: DEFAULT_MOBILE_LAYOUT });
    const mockResetAdminDefault = jest.fn().mockResolvedValue({ layout: DEFAULT_MOBILE_LAYOUT });

    (ApiClient as jest.MockedClass<typeof ApiClient>).mockImplementation(() => {
      return {
        getConfig: jest.fn().mockResolvedValue({ apiVersion: 1, capabilities: { mobileApi: true } }),
        refresh: jest.fn().mockResolvedValue({
          accessToken: 'admin-access-token',
          refreshToken: 'admin-refresh-token',
          accessTokenExpiresAt: '',
          sessionId: 's1',
        }),
        getMe: jest.fn().mockResolvedValue({
          id: 'admin-1',
          email: 'admin@vsis.lk',
          name: 'Admin User',
          role: 'admin',
          permissionRole: 'admin',
          hierarchyRole: 'manager',
          isActive: true,
          capabilities: {
            canViewTeam: true,
            canManageProjects: true,
            canManageActivities: true,
            canManageUsers: true,
            canManageSettings: true,
            canManageWorkspaceCustomization: true,
          },
        }),
        getLayout: jest.fn().mockResolvedValue({
          layout: DEFAULT_MOBILE_LAYOUT,
          savedLayout: null,
          defaultLayout: DEFAULT_MOBILE_LAYOUT,
          capabilities: {
            canViewTeam: true,
            canManageProjects: true,
            canManageActivities: true,
            canManageUsers: true,
            canManageSettings: true,
            canManageWorkspaceCustomization: true,
          },
        }),
        getAdminDefaultLayout: jest.fn().mockResolvedValue({ layout: DEFAULT_MOBILE_LAYOUT }),
        updateLayout: jest.fn().mockResolvedValue({
          layout: DEFAULT_MOBILE_LAYOUT,
          savedLayout: DEFAULT_MOBILE_LAYOUT,
        }),
        resetLayout: jest.fn().mockResolvedValue({
          layout: DEFAULT_MOBILE_LAYOUT,
          savedLayout: null,
        }),
        updateAdminDefaultLayout: mockUpdateAdminDefault,
        resetAdminDefaultLayout: mockResetAdminDefault,
      } as unknown as ApiClient;
    });

    const store = new MemoryTokenStore();
    await store.write({ refreshToken: 'initial-refresh', sessionId: 's1' });

    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <SessionProvider initialServerUrl="https://timesheet.example.com" tokenStore={store}>
          <LayoutCustomizerScreen isDarkMode={false} onGoBack={jest.fn()} />
        </SessionProvider>
      );
    });

    // Check scope selector buttons
    const workspaceDefaultBtn = renderer!.root.findByProps({ accessibilityLabel: 'Workspace Default Layout' });
    expect(workspaceDefaultBtn).toBeDefined();

    await ReactTestRenderer.act(async () => {
      workspaceDefaultBtn.props.onPress();
    });

    const saveBtn = renderer!.root.findByProps({ accessibilityLabel: 'Save Layout' });
    await ReactTestRenderer.act(async () => {
      saveBtn.props.onPress();
    });

    expect(mockUpdateAdminDefault).toHaveBeenCalled();
  });

  it('hides workspace default scope selector from non-superadmin actors', async () => {
    (ApiClient as jest.MockedClass<typeof ApiClient>).mockImplementation(() => {
      return {
        getConfig: jest.fn().mockResolvedValue({ apiVersion: 1, capabilities: { mobileApi: true } }),
        refresh: jest.fn().mockResolvedValue({
          accessToken: 'admin-access-token',
          refreshToken: 'admin-refresh-token',
          accessTokenExpiresAt: '',
          sessionId: 's1',
        }),
        getMe: jest.fn().mockResolvedValue({
          id: 'admin-ord',
          email: 'ord_admin@vsis.lk',
          name: 'Ordinary Admin',
          role: 'admin',
          permissionRole: 'admin',
          hierarchyRole: 'manager',
          isActive: true,
          capabilities: {
            canViewTeam: true,
            canManageProjects: true,
            canManageActivities: true,
            canManageUsers: true,
            canManageSettings: true,
            canManageWorkspaceCustomization: false,
          },
        }),
        getLayout: jest.fn().mockResolvedValue({
          layout: DEFAULT_MOBILE_LAYOUT,
          savedLayout: null,
          defaultLayout: DEFAULT_MOBILE_LAYOUT,
          capabilities: {
            canViewTeam: true,
            canManageProjects: true,
            canManageActivities: true,
            canManageUsers: true,
            canManageSettings: true,
            canManageWorkspaceCustomization: false,
          },
        }),
      } as unknown as ApiClient;
    });

    const store = new MemoryTokenStore();
    await store.write({ refreshToken: 'initial-refresh', sessionId: 's1' });

    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <SessionProvider initialServerUrl="https://timesheet.example.com" tokenStore={store}>
          <LayoutCustomizerScreen isDarkMode={false} onGoBack={jest.fn()} />
        </SessionProvider>
      );
    });

    const scopeSelector = renderer!.root.findAllByProps({ accessibilityLabel: 'Workspace Default Layout' });
    expect(scopeSelector).toHaveLength(0);
  });
});
