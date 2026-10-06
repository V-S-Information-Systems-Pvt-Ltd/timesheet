import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { ApiClient } from '../src/api/client';
import { SessionProvider, useSession } from '../src/auth/SessionProvider';
import { MemoryTokenStore } from '../test-utils/memory-token-store';
import { dashboardCache } from '../src/storage/dashboard-cache';
import { SettingsAdminScreen } from '../src/screens/SettingsAdminScreen';
import { ScreenTheme } from '../test-utils/theme-fixture';

jest.mock('../src/api/client', () => {
  const actual = jest.requireActual('../src/api/client');
  return { ...actual, ApiClient: jest.fn() };
});

const actor = {
  id: 'loading-user', email: 'loading@example.com', role: 'admin',
  permissionRole: 'admin', hierarchyRole: 'user', isActive: true,
};
const dashboard = {
  actor, today: { date: '2026-09-30', hours: 2 },
  week: { from: '2026-09-24', to: '2026-09-30', hours: 8 },
  recentEntries: [], quickActions: ['create-timesheet'],
};
const reference = { projects: [], activityTypes: [], titles: [] };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

describe('mobile loading through SessionProvider', () => {
  let renderer: ReactTestRenderer.ReactTestRenderer;
  let session: ReturnType<typeof useSession>;
  let showSettings: boolean;
  let renderTree: () => React.ReactElement;
  let api: {
    getConfig: jest.Mock; login: jest.Mock; logout: jest.Mock;
    getDashboard: jest.Mock; getReference: jest.Mock; createTimesheet: jest.Mock;
    createAdminProject: jest.Mock; getBackfillSettings: jest.Mock; listAdminUsers: jest.Mock;
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    dashboardCache.clear();
    showSettings = false;
    api = {
      getConfig: jest.fn().mockResolvedValue({ apiVersion: 1, capabilities: { mobileApi: true, bearerAuth: true } }),
      login: jest.fn().mockResolvedValue({ actor, accessToken: 'access', refreshToken: 'refresh', sessionId: 'session' }),
      logout: jest.fn().mockResolvedValue(undefined),
      getDashboard: jest.fn().mockResolvedValue(dashboard),
      getReference: jest.fn().mockResolvedValue(reference),
      createTimesheet: jest.fn().mockResolvedValue({ success: true }),
      createAdminProject: jest.fn().mockResolvedValue({ id: 'p-new', name: 'New project' }),
      getBackfillSettings: jest.fn().mockResolvedValue({ mode: 'days', windowDays: 7, extraDays: 0 }),
      listAdminUsers: jest.fn().mockResolvedValue([{ ...actor, name: 'First user' }, { ...actor, id: 'u2', name: 'Second user' }]),
    };
    (ApiClient as jest.MockedClass<typeof ApiClient>).mockImplementation((baseUrl) => ({ baseUrl, ...api } as unknown as ApiClient));
    function Consumer() {
      session = useSession();
      return showSettings ? <ScreenTheme><SettingsAdminScreen isDarkMode={false} onBack={jest.fn()} /></ScreenTheme> : null;
    }
    const store = new MemoryTokenStore();
    renderTree = () => <SessionProvider tokenStore={store}><Consumer /></SessionProvider>;
    await act(async () => {
      renderer = ReactTestRenderer.create(renderTree());
    });
    await act(async () => { await session.connectServer('https://loading.example.com'); });
    await act(async () => { await session.signIn({ email: actor.email, password: 'test' }); });
  });

  afterEach(() => { act(() => renderer.unmount()); dashboardCache.clear(); });

  it('coalesces dashboard consumers and reuses recent dashboard/reference data', async () => {
    const pending = deferred<typeof dashboard>();
    api.getDashboard.mockReturnValueOnce(pending.promise);
    await act(async () => {
      const first = session.loadDashboard();
      const second = session.loadDashboard();
      pending.resolve(dashboard);
      await Promise.all([first, second]);
      await session.loadDashboard();
      await session.loadReference();
      await session.loadReference();
    });
    expect(api.getDashboard).toHaveBeenCalledTimes(1);
    expect(api.getReference).toHaveBeenCalledTimes(1);
    expect(session.dashboard).toEqual(dashboard);
  });

  it('explicit refresh and reference mutations bypass cached results', async () => {
    await act(async () => { await session.loadDashboard(); await session.loadReference(); });
    await act(async () => { await session.loadDashboard(true); await session.loadReference(true); });
    expect(api.getDashboard).toHaveBeenCalledTimes(2);
    expect(api.getReference).toHaveBeenCalledTimes(2);
    await act(async () => { await session.createAdminProject({ name: 'New project' }); });
    expect(api.getReference).toHaveBeenCalledTimes(3);
  });

  it('a timesheet mutation fetches fresh dashboard data and ignores an older pending response', async () => {
    const old = deferred<typeof dashboard>();
    const updated = { ...dashboard, today: { ...dashboard.today, hours: 3 } };
    api.getDashboard.mockReturnValueOnce(old.promise).mockResolvedValueOnce(updated);
    let pending!: Promise<unknown>;
    await act(async () => { pending = session.loadDashboard(); });
    await act(async () => {
      await session.createTimesheet({ entryType: 'support', activityCode: 'internal_it', projectId: null, activityTypeId: null, ticketNumber: null, activityOther: null, logDate: '2026-09-30', hoursWorked: 1, workDone: 'Test loading' });
    });
    expect(api.getDashboard).toHaveBeenCalledTimes(2);
    await act(async () => { old.resolve(dashboard); await pending; });
    expect(session.dashboard).toEqual(updated);
  });

  it('does not restore data after logout when a read completes late', async () => {
    const old = deferred<typeof dashboard>();
    api.getDashboard.mockReturnValueOnce(old.promise);
    let pending!: Promise<unknown>;
    await act(async () => { pending = session.loadDashboard(); });
    await act(async () => { await session.signOut(); });
    await act(async () => { old.resolve(dashboard); await pending; });
    expect(session.status).toBe('signed-out');
    expect(session.dashboard).toBeNull();
    expect(dashboardCache.get('https://loading.example.com', actor.id)).toBeNull();
  });

  it('clears cached reference data when switching workspaces', async () => {
    await act(async () => { await session.loadReference(); });
    await act(async () => { await session.connectServer('https://other.example.com'); });
    await act(async () => { await session.signIn({ email: actor.email, password: 'test' }); });
    await act(async () => { await session.loadReference(); });
    expect(api.getReference).toHaveBeenCalledTimes(2);
  });

  it('loads settings once and changing user/project/activity selections does not refetch', async () => {
    api.getReference.mockResolvedValue({
      projects: [{ id: 'p1', name: 'First project' }, { id: 'p2', name: 'Second project' }],
      activityTypes: [{ id: 'a1', name: 'First activity' }, { id: 'a2', name: 'Second activity' }],
      titles: [],
    });
    await act(async () => { showSettings = true; renderer.update(renderTree()); });
    expect(api.getBackfillSettings).toHaveBeenCalledTimes(1);
    expect(api.listAdminUsers).toHaveBeenCalledTimes(1);
    expect(api.getReference).toHaveBeenCalledTimes(1);
    for (const label of ['Select user Second user']) {
      const button = renderer.root.findAllByProps({ accessibilityLabel: label }).find((node) => typeof node.props.onPress === 'function');
      expect(button).toBeDefined();
      await act(async () => { button!.props.onPress(); });
    }
    expect(api.getBackfillSettings).toHaveBeenCalledTimes(1);
    expect(api.listAdminUsers).toHaveBeenCalledTimes(1);
    expect(api.getReference).toHaveBeenCalledTimes(1);
  });
});
