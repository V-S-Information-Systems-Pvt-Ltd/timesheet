import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { SignInScreen } from '../src/screens/SignInScreen';
import { SettingsAdminScreen } from '../src/screens/SettingsAdminScreen';
import { SessionProvider } from '../src/auth/SessionProvider';
import { MemoryTokenStore } from '../src/platform/secure-storage';
import { ApiClient } from '../src/api/client';

jest.mock('../src/api/client');
jest.setTimeout(15000);

describe('Mobile workspace branding', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    ReactTestRenderer.act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  it('renders custom workspace branding when provided by server config', async () => {
    const customBranding = {
      appName: 'Apex Software',
      primaryColor: '#0D9488',
      logoUrl: 'https://cdn.example.com/logo.png',
    };

    (ApiClient as jest.MockedClass<typeof ApiClient>).mockImplementation(() => {
      return {
        getConfig: jest.fn().mockResolvedValue({
          apiVersion: 1,
          appVersion: '0.3.0',
          backend: 'native',
          capabilities: { bearerAuth: true, mobileApi: true },
          branding: customBranding,
        }),
      } as unknown as ApiClient;
    });

    const store = new MemoryTokenStore();
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <SessionProvider initialServerUrl="https://timesheet.example.com" tokenStore={store}>
          <SignInScreen isDarkMode={false} onBackToConnect={jest.fn()} />
        </SessionProvider>
      );
    });

    // Verify custom app name is rendered in uppercase
    const eyebrow = renderer!.root.findByProps({ children: 'APEX SOFTWARE' });
    expect(eyebrow).toBeDefined();

    // Verify logo image has the custom URI source
    const image = renderer!.root.findByProps({ accessibilityLabel: 'Apex Software' });
    expect(image.props.source).toEqual({ uri: 'https://cdn.example.com/logo.png' });
  });

  it('falls back to bundled VSIS branding on missing config or image error', async () => {
    (ApiClient as jest.MockedClass<typeof ApiClient>).mockImplementation(() => {
      return {
        getConfig: jest.fn().mockResolvedValue({
          apiVersion: 1,
          appVersion: '0.3.0',
          backend: 'native',
          capabilities: { bearerAuth: true, mobileApi: true },
        }),
      } as unknown as ApiClient;
    });

    const store = new MemoryTokenStore();
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <SessionProvider initialServerUrl="https://timesheet.example.com" tokenStore={store}>
          <SignInScreen isDarkMode={false} onBackToConnect={jest.fn()} />
        </SessionProvider>
      );
    });

    // Default branding is rendered
    const eyebrow = renderer!.root.findByProps({ children: 'VSIS TIMESHEET' });
    expect(eyebrow).toBeDefined();

    const image = renderer!.root.findByProps({ accessibilityLabel: 'VSIS Timesheet' });
    expect(image.props.source).toBeDefined();
  });

  it('allows admins to edit and reset workspace branding from settings', async () => {
    const updateBrandingMock = jest.fn().mockResolvedValue({
      appName: 'Acme Timesheet',
      primaryColor: '#2563EB',
      logoUrl: 'https://acme.org/logo.png',
    });
    const resetBrandingMock = jest.fn().mockResolvedValue({
      appName: 'VSIS Timesheet',
      primaryColor: '#1E73BE',
      logoUrl: null,
    });

    (ApiClient as jest.MockedClass<typeof ApiClient>).mockImplementation(() => {
      return {
        getConfig: jest.fn().mockResolvedValue({
          apiVersion: 1,
          appVersion: '0.3.0',
          backend: 'native',
          capabilities: { bearerAuth: true, mobileApi: true },
          branding: { appName: 'VSIS Timesheet', primaryColor: '#1E73BE', logoUrl: null },
        }),
        refresh: jest.fn().mockResolvedValue({
          accessToken: 'access-123',
          refreshToken: 'refresh-123',
          accessTokenExpiresAt: '',
          sessionId: 's1',
        }),
        getMe: jest.fn().mockResolvedValue({
          id: 'admin-1',
          email: 'admin@vsis.lk',
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
        getReference: jest.fn().mockResolvedValue({ projects: [], activityTypes: [] }),
        getBackfillSettings: jest.fn().mockResolvedValue({ mode: 'days', windowDays: 7, extraDays: 0 }),
        listAdminUsers: jest.fn().mockResolvedValue([]),
        updateBranding: updateBrandingMock,
        resetBranding: resetBrandingMock,
      } as unknown as ApiClient;
    });

    const store = new MemoryTokenStore();
    await store.write({ refreshToken: 'initial-refresh', sessionId: 's1' });

    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <SessionProvider initialServerUrl="https://timesheet.example.com" tokenStore={store}>
          <SettingsAdminScreen isDarkMode={false} onBack={jest.fn()} />
        </SessionProvider>
      );
    });

    // Verify Workspace Branding inputs exist
    const appNameInput = renderer!.root.findByProps({ accessibilityLabel: 'App Name' });
    const primaryColorInput = renderer!.root.findByProps({ accessibilityLabel: 'Primary Color' });
    const logoUrlInput = renderer!.root.findByProps({ accessibilityLabel: 'Logo URL' });

    expect(appNameInput).toBeDefined();
    expect(primaryColorInput).toBeDefined();
    expect(logoUrlInput).toBeDefined();

    // Edit fields
    await ReactTestRenderer.act(async () => {
      appNameInput.props.onChangeText('Acme Timesheet');
      primaryColorInput.props.onChangeText('#2563EB');
      logoUrlInput.props.onChangeText('https://acme.org/logo.png');
    });

    // Save branding
    const saveBtn = renderer!.root.findByProps({ accessibilityLabel: 'Save Branding' });
    await ReactTestRenderer.act(async () => {
      saveBtn.props.onPress();
    });

    expect(updateBrandingMock).toHaveBeenCalledWith(
      {
        appName: 'Acme Timesheet',
        primaryColor: '#2563EB',
        logoUrl: 'https://acme.org/logo.png',
      },
      'access-123'
    );

    // Reset branding
    const resetBtn = renderer!.root.findByProps({ accessibilityLabel: 'Reset Branding' });
    await ReactTestRenderer.act(async () => {
      resetBtn.props.onPress();
    });

    expect(resetBrandingMock).toHaveBeenCalledWith('access-123');
  });

  it('hides workspace branding customization from actors without canManageWorkspaceCustomization', async () => {
    (ApiClient as jest.MockedClass<typeof ApiClient>).mockImplementation(() => {
      return {
        getConfig: jest.fn().mockResolvedValue({
          apiVersion: 1,
          capabilities: { mobileApi: true },
        }),
        refresh: jest.fn().mockResolvedValue({
          accessToken: 'access-123',
          refreshToken: 'refresh-456',
          accessTokenExpiresAt: '',
          sessionId: 's1',
        }),
        getMe: jest.fn().mockResolvedValue({
          id: 'admin-ord',
          email: 'ord_admin@vsis.lk',
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
        getReference: jest.fn().mockResolvedValue({ projects: [], activityTypes: [] }),
        getBackfillSettings: jest.fn().mockResolvedValue({ mode: 'days', windowDays: 7, extraDays: 0 }),
        listAdminUsers: jest.fn().mockResolvedValue([]),
      } as unknown as ApiClient;
    });

    const store = new MemoryTokenStore();
    await store.write({ refreshToken: 'initial-refresh', sessionId: 's1' });

    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <SessionProvider initialServerUrl="https://timesheet.example.com" tokenStore={store}>
          <SettingsAdminScreen isDarkMode={false} onBack={jest.fn()} />
        </SessionProvider>
      );
    });

    const appNameInputs = renderer!.root.findAllByProps({ accessibilityLabel: 'App Name' });
    expect(appNameInputs).toHaveLength(0);
  });
});
