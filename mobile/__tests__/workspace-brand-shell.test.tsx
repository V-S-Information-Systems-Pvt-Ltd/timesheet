// R3 regression tests — authenticated workspace branding across adaptive
// layouts (docs/plans/MOBILE_ADMIN_CUSTOMIZATION_REVIEW_FINDINGS_FIX_PLAN.md).
// Covers: narrow and wide layouts render name/logo, remote failure falls back
// to the bundled asset, a corrected URL retries in the same mounted session,
// save/reset update the mounted shell, and long names truncate without hiding
// navigation.

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Pressable, Text } from 'react-native';
import { MainNavigator } from '../App';
import { WorkspaceBrand } from '../src/components/WorkspaceBrand';
import { SessionProvider, useSessionActions } from '../src/auth/SessionProvider';
import { ThemeProvider, getPalette } from '../src/theme';
import { MemoryTokenStore } from '../src/platform/secure-storage';
import { ApiClient } from '../src/api/client';
import type { WorkspaceBranding } from '../src/api/contracts';

jest.mock('../src/api/client');
jest.setTimeout(15000);

// The RN preset gives Dimensions a phone-like default width (~750), which would
// render the wide rail in every test. Mock the underlying hook module so every
// consumer (App, AdaptiveNavigation) sees the width under test.
let mockWidth = 375;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: mockWidth, height: 812, scale: 2, fontScale: 1 }),
}));

function setWidth(width: number) {
  mockWidth = width;
}

const DEFAULT_BRANDING: WorkspaceBranding = {
  appName: 'VSIS Timesheet',
  primaryColor: '#1E73BE',
  logoUrl: null,
};

const CUSTOM_BRANDING: WorkspaceBranding = {
  appName: 'Apex Software',
  primaryColor: '#0D9488',
  logoUrl: 'https://cdn.example.com/logo.png',
};

const ACTOR = {
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
};

const dashboard = {
  actor: ACTOR,
  today: { date: '2026-09-01', hours: 4 },
  week: { from: '2026-08-31', to: '2026-09-06', hours: 24 },
  recentEntries: [],
  quickActions: ['log-time'],
};

function mockApi(branding: WorkspaceBranding) {
  (ApiClient as jest.MockedClass<typeof ApiClient>).mockImplementation(() => {
    return {
      baseUrl: 'https://timesheet.example.com',
      getConfig: jest.fn().mockResolvedValue({
        apiVersion: 1,
        appVersion: '0.3.0',
        backend: 'native',
        capabilities: { bearerAuth: true, mobileApi: true },
        branding,
      }),
      refresh: jest.fn().mockResolvedValue({
        accessToken: 'access-123',
        refreshToken: 'refresh-123',
        accessTokenExpiresAt: '',
        sessionId: 's1',
      }),
      getMe: jest.fn().mockResolvedValue(ACTOR),
      getReference: jest.fn().mockResolvedValue({ projects: [], activityTypes: [] }),
      getBackfillSettings: jest.fn().mockResolvedValue({ mode: 'days', windowDays: 7, extraDays: 0 }),
      getDashboard: jest.fn().mockResolvedValue(dashboard),
      listTimesheets: jest.fn().mockResolvedValue([]),
      updateBranding: jest.fn().mockResolvedValue(CUSTOM_BRANDING),
      resetBranding: jest.fn().mockResolvedValue(DEFAULT_BRANDING),
      logout: jest.fn().mockResolvedValue(undefined),
      logoutAll: jest.fn().mockResolvedValue(undefined),
    } as unknown as ApiClient;
  });
}

function ShellHarness() {
  const { updateBranding, resetBranding } = useSessionActions();
  return (
    <>
      <MainNavigator />
      <Pressable testID="save-branding" onPress={() => updateBranding(CUSTOM_BRANDING)} />
      <Pressable testID="reset-branding" onPress={() => resetBranding()} />
    </>
  );
}

async function renderSignedInShell(branding: WorkspaceBranding): Promise<ReactTestRenderer.ReactTestRenderer> {
  mockApi(branding);
  const store = new MemoryTokenStore();
  await store.write({ refreshToken: 'initial-refresh', sessionId: 's1' });
  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <SessionProvider initialServerUrl="https://timesheet.example.com" tokenStore={store}>
        <ThemeProvider primaryColor={branding.primaryColor}>
          <ShellHarness />
        </ThemeProvider>
      </SessionProvider>
    );
  });
  return renderer!;
}

describe('WorkspaceBrand component', () => {
  const palette = getPalette(false, DEFAULT_BRANDING.primaryColor);

  it('renders the configured name and remote logo (rail variant)', async () => {
    let renderer: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <WorkspaceBrand branding={CUSTOM_BRANDING} palette={palette} />
      );
    });
    const image = renderer!.root.findByProps({ accessibilityLabel: 'Apex Software logo' });
    expect(image.props.source).toEqual({ uri: 'https://cdn.example.com/logo.png' });
    expect(renderer!.root.findByProps({ children: 'Apex Software' })).toBeDefined();
  });

  it('renders the configured name and remote logo (compact variant)', async () => {
    let renderer: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <WorkspaceBrand branding={CUSTOM_BRANDING} palette={palette} compact />
      );
    });
    const image = renderer!.root.findByProps({ accessibilityLabel: 'Apex Software logo' });
    expect(image.props.source).toEqual({ uri: 'https://cdn.example.com/logo.png' });
    expect(renderer!.root.findByProps({ children: 'Apex Software' })).toBeDefined();
  });

  it('falls back to the bundled logo when the remote logo fails', async () => {
    let renderer: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <WorkspaceBrand branding={CUSTOM_BRANDING} palette={palette} compact />
      );
    });

    await ReactTestRenderer.act(async () => {
      renderer!.root.findByProps({ accessibilityLabel: 'Apex Software logo' }).props.onError();
    });
    const afterFailure = renderer!.root.findByProps({ accessibilityLabel: 'Apex Software logo' });
    expect(afterFailure.props.source).not.toEqual({ uri: 'https://cdn.example.com/logo.png' });
  });

  it('retries a corrected logo URL in the same session without remount', async () => {
    const corrected: WorkspaceBranding = { ...CUSTOM_BRANDING, logoUrl: 'https://cdn.example.com/fixed.png' };
    let renderer: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <WorkspaceBrand branding={CUSTOM_BRANDING} palette={palette} compact />
      );
    });
    // Simulate the first URL failing.
    await ReactTestRenderer.act(async () => {
      renderer!.root.findByProps({ accessibilityLabel: 'Apex Software logo' }).props.onError();
    });
    expect(renderer!.root.findByProps({ accessibilityLabel: 'Apex Software logo' }).props.source).not.toEqual({
      uri: 'https://cdn.example.com/logo.png',
    });

    // The mounted component receives the corrected URL — must retry immediately.
    await ReactTestRenderer.act(async () => {
      renderer!.update(<WorkspaceBrand branding={corrected} palette={palette} compact />);
    });
    expect(renderer!.root.findByProps({ accessibilityLabel: 'Apex Software logo' }).props.source).toEqual({
      uri: 'https://cdn.example.com/fixed.png',
    });
  });

  it('shows the bundled logo immediately after branding reset (logoUrl null)', async () => {
    let renderer: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <WorkspaceBrand branding={CUSTOM_BRANDING} palette={palette} compact />
      );
    });
    await ReactTestRenderer.act(async () => {
      renderer!.update(<WorkspaceBrand branding={DEFAULT_BRANDING} palette={palette} compact />);
    });
    expect(renderer!.root.findByProps({ children: 'VSIS Timesheet' })).toBeDefined();
    const image = renderer!.root.findByProps({ accessibilityLabel: 'VSIS Timesheet logo' });
    expect(image.props.source).not.toEqual({ uri: 'https://cdn.example.com/logo.png' });
  });

  it('truncates long app names in compact mode without hiding navigation', async () => {
    const longName: WorkspaceBranding = {
      appName: 'A Very Long Workspace Name That Must Not Wrap Or Push The Navigation Controls Out Of View',
      primaryColor: '#0D9488',
      logoUrl: null,
    };
    let renderer: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <WorkspaceBrand branding={longName} palette={palette} compact />
      );
    });
    const nameNode = renderer!.root.findByType(Text);
    expect(nameNode.props.numberOfLines).toBe(1);
  });
});

describe('Authenticated shell branding (R3)', () => {
  beforeEach(() => {
    setWidth(375); // narrow phone
  });

  it('renders branding in the compact header on narrow layouts', async () => {
    const renderer = await renderSignedInShell(CUSTOM_BRANDING);
    const logo = renderer.root.findByProps({ accessibilityLabel: 'Apex Software logo' });
    expect(logo.props.source).toEqual({ uri: 'https://cdn.example.com/logo.png' });
    // Exactly one brand instance on narrow: the compact header. The bottom tab
    // bar is not used to carry the logo. (findAllByProps matches both the
    // composite and host View nodes, so count by component type.)
    expect(renderer.root.findAll((n) => n.type === WorkspaceBrand)).toHaveLength(1);
  });

  it('mounted UI uses the custom semantic primary (R4)', async () => {
    const renderer = await renderSignedInShell(CUSTOM_BRANDING);
    // The bottom-bar Log Time action button must use the branded primary, not
    // the fixed default blue.
    const actionTab = renderer.root.findByProps({ accessibilityLabel: 'Log Time Action Tab' });
    const styleArray = Array.isArray(actionTab.props.style) ? actionTab.props.style : [actionTab.props.style];
    expect(styleArray.some((s: unknown) => (s as { backgroundColor?: string })?.backgroundColor === '#0D9488')).toBe(true);
    // Rail brand name/logo also resolve to the configured values.
    expect(renderer.root.findByProps({ children: 'Apex Software' })).toBeDefined();
  });

  it('renders branding in the wide rail on layouts at or above 600px', async () => {
    setWidth(1200);
    const renderer = await renderSignedInShell(CUSTOM_BRANDING);
    const image = renderer.root.findByProps({ accessibilityLabel: 'Apex Software logo' });
    expect(image.props.source).toEqual({ uri: 'https://cdn.example.com/logo.png' });
    expect(renderer.root.findByProps({ children: 'Apex Software' })).toBeDefined();
    expect(renderer.root.findAll((n) => n.type === WorkspaceBrand)).toHaveLength(1);
  });

  it('save and reset update a mounted authenticated shell live', async () => {
    const renderer = await renderSignedInShell(DEFAULT_BRANDING);
    expect(renderer.root.findByProps({ accessibilityLabel: 'VSIS Timesheet logo' })).toBeDefined();

    // Save a new branding — the mounted header must switch immediately.
    await ReactTestRenderer.act(async () => {
      renderer.root.findByProps({ testID: 'save-branding' }).props.onPress();
    });
    expect(renderer.root.findByProps({ accessibilityLabel: 'Apex Software logo' })).toBeDefined();
    expect(renderer.root.findAllByProps({ accessibilityLabel: 'VSIS Timesheet logo' })).toHaveLength(0);
    expect(renderer.root.findByProps({ children: 'Apex Software' })).toBeDefined();

    // Reset — default name/logo return at once.
    await ReactTestRenderer.act(async () => {
      renderer.root.findByProps({ testID: 'reset-branding' }).props.onPress();
    });
    expect(renderer.root.findByProps({ accessibilityLabel: 'VSIS Timesheet logo' })).toBeDefined();
    expect(renderer.root.findAllByProps({ accessibilityLabel: 'Apex Software logo' })).toHaveLength(0);
  });
});