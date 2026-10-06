import React from 'react';
import { ScreenTheme } from '../test-utils/theme-fixture';
import ReactTestRenderer from 'react-test-renderer';
import { SettingsAdminScreen } from '../src/screens/SettingsAdminScreen';
import { UserAdminScreen } from '../src/screens/UserAdminScreen';
import { SessionProvider } from '../src/auth/SessionProvider';
import { MemoryTokenStore } from '../test-utils/memory-token-store';
import { ApiClient } from '../src/api/client';

jest.mock('../src/api/client');

describe('Destructive admin actions require confirmation', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    ReactTestRenderer.act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  const adminActor = {
    id: 'u1',
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
  };

  async function mount(ui: React.ReactElement) {
    const store = new MemoryTokenStore();
    await store.write({ refreshToken: 'ref-1', sessionId: 's1' });
    let renderer: ReactTestRenderer.ReactTestRenderer = undefined as never;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <ScreenTheme>
          <SessionProvider initialServerUrl="https://timesheet.example.com" tokenStore={store}>
            {ui}
          </SessionProvider>
        </ScreenTheme>
      );
    });
    return renderer;
  }

  it('reset branding fires only after the confirm dialog', async () => {
    const resetBrandingMock = jest.fn();
    (ApiClient as jest.MockedClass<typeof ApiClient>).mockImplementation(() => {
      return {
        getConfig: jest.fn().mockResolvedValue({
          apiVersion: 1,
          appVersion: 'test',
          backend: 'native',
          branding: { appName: 'Custom Name', primaryColor: '#112233', logoUrl: '' },
          capabilities: { mobileApi: true, bearerAuth: true, durableIdempotency: true },
        }),
        refresh: jest.fn().mockResolvedValue({
          accessToken: 'access-123', refreshToken: 'refresh-123', accessTokenExpiresAt: '', sessionId: 's1',
        }),
        getMe: jest.fn().mockResolvedValue(adminActor),
        getReference: jest.fn().mockResolvedValue({ projects: [], activityTypes: [] }),
        listAdminUsers: jest.fn().mockResolvedValue([]),
        getDashboard: jest.fn().mockResolvedValue({ actor: { id: 'u1' }, today: { date: '2026-01-01', totalHours: 0 }, week: { totalHours: 0 } }),
        getBackfillSettings: jest.fn().mockResolvedValue({ mode: 'days', windowDays: 7, extraDays: 0 }),
        resetBranding: resetBrandingMock,
      } as unknown as ApiClient;
    });

    const renderer = await mount(<SettingsAdminScreen isDarkMode={false} onBack={jest.fn()} />);

    // No dialog before the tap.
    expect(renderer.root.findAllByProps({ accessibilityLabel: 'Restore defaults' })).toHaveLength(0);

    const resetBtn = renderer.root.findByProps({ accessibilityLabel: 'Reset Branding' });
    await ReactTestRenderer.act(async () => {
      resetBtn.props.onPress();
    });

    // First tap opens the dialog without resetting.
    const confirmBtn = renderer.root.findByProps({ accessibilityLabel: 'Restore defaults' });
    expect(confirmBtn).toBeDefined();
    expect(resetBrandingMock).not.toHaveBeenCalled();

    // Cancel leaves branding untouched.
    const cancelBtn = renderer.root.findByProps({ accessibilityLabel: 'Cancel' });
    await ReactTestRenderer.act(async () => {
      cancelBtn.props.onPress();
    });
    expect(resetBrandingMock).not.toHaveBeenCalled();

    // Confirm performs the reset.
    await ReactTestRenderer.act(async () => {
      resetBtn.props.onPress();
    });
    const confirmAgain = renderer.root.findByProps({ accessibilityLabel: 'Restore defaults' });
    await ReactTestRenderer.act(async () => {
      confirmAgain.props.onPress();
    });
    expect(resetBrandingMock).toHaveBeenCalledTimes(1);
  });

  it('reclassification of a synced title fires only after the confirm dialog', async () => {
    const reclassifyMock = jest.fn().mockResolvedValue({ name: 'Software Engineer', hierarchyRole: 'manager', affectedCount: 5 });
    (ApiClient as jest.MockedClass<typeof ApiClient>).mockImplementation(() => {
      return {
        getConfig: jest.fn().mockResolvedValue({}),
        refresh: jest.fn().mockResolvedValue({
          accessToken: 'access-123', refreshToken: 'refresh-123', accessTokenExpiresAt: '', sessionId: 's1',
        }),
        getMe: jest.fn().mockResolvedValue(adminActor),
        getReference: jest.fn().mockResolvedValue({ projects: [], activityTypes: [] }),
        listAdminUsers: jest.fn().mockResolvedValue([
          { id: 'u2', email: 'dev@vsis.lk', name: 'Dev User', title: 'Software Engineer', role: 'user', permissionRole: 'user', hierarchyRole: 'engineer', isActive: true },
        ]),
        listAdminTitles: jest.fn().mockResolvedValue([
          { name: 'Software Engineer', hierarchyRole: 'user', isCustom: false },
        ]),
        getAdminTitleImpact: jest.fn().mockResolvedValue({ affectedCount: 5, syncRequired: true }),
        reclassifyAdminTitle: reclassifyMock,
      } as unknown as ApiClient;
    });

    const renderer = await mount(<UserAdminScreen isDarkMode={false} onBack={jest.fn()} />);

    // Titles tab first.
    await ReactTestRenderer.act(async () => {
      renderer.root.findByProps({ accessibilityLabel: 'Titles Tab' }).props.onPress();
    });

    // Open the reclassify modal for the title.
    await ReactTestRenderer.act(async () => {
      renderer.root.findAllByProps({ accessibilityLabel: 'Reclassify Software Engineer' })[0].props.onPress();
    });

    expect(
      renderer.root.findAllByProps({ accessibilityLabel: 'Apply reclassification' })
    ).toHaveLength(0);

    const saveBtn = renderer.root.findByProps({ accessibilityLabel: 'Save Reclassification' });
    await ReactTestRenderer.act(async () => {
      saveBtn.props.onPress();
    });

    // First tap opens the confirm dialog without applying.
    const confirmBtn = renderer.root.findByProps({ accessibilityLabel: 'Apply reclassification' });
    expect(confirmBtn).toBeDefined();
    expect(reclassifyMock).not.toHaveBeenCalled();

    // Cancel keeps the modal and does not apply.
    const cancelBtn = renderer.root.findByProps({ accessibilityLabel: 'Cancel' });
    await ReactTestRenderer.act(async () => {
      cancelBtn.props.onPress();
    });
    expect(reclassifyMock).not.toHaveBeenCalled();

    // Confirm applies.
    await ReactTestRenderer.act(async () => {
      saveBtn.props.onPress();
    });
    const confirmAgain = renderer.root.findByProps({ accessibilityLabel: 'Apply reclassification' });
    await ReactTestRenderer.act(async () => {
      confirmAgain.props.onPress();
    });
    expect(reclassifyMock).toHaveBeenCalledTimes(1);
  });
});
