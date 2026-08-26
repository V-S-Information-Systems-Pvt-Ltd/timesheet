import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import { HomeScreen } from '../src/screens/HomeScreen';
import { DashboardCache, MemoryCachePersistence } from '../src/cache/dashboard-cache';
import { fakeClient, fakeController, signedInState, withSession } from '../src/test-support';
import type { MobileDashboardData } from '../src/api/contracts';

const dashboard: MobileDashboardData = {
  actor: {
    id: 'u1',
    email: 'user@example.com',
    role: 'user',
    permissionRole: 'user',
    hierarchyRole: 'user',
    isActive: true,
  },
  today: { date: '2026-08-26', hours: 7.5 },
  week: { from: '2026-08-24', to: '2026-08-30', hours: 32 },
  recentEntries: [
    {
      id: 't1',
      user_id: 'u1',
      project_id: 'p1',
      activity_type_id: null,
      log_date: '2026-08-26',
      hours_worked: 7.5,
      work_done: 'Shipped the mobile dashboard',
      created_at: '2026-08-26T07:00:00Z',
      projects: { name: 'Apollo' },
      profiles: { email: 'user@example.com' },
      activity_types: null,
    },
  ],
  quickActions: ['create-timesheet'],
};

function strings(renderer: ReactTestRenderer.ReactTestRenderer) {
  return renderer.root
    .findAll((node) => typeof node.props.children === 'string')
    .map((node) => node.props.children as string)
    .join('\n');
}

async function renderHome(getDashboard: jest.Mock, cached?: MobileDashboardData | null) {
  const cache = new DashboardCache(new MemoryCachePersistence());
  if (cached) await cache.save(cached);
  const client = fakeClient({ getDashboard });
  const controller = fakeController(signedInState());
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      withSession(controller, client, <HomeScreen cache={cache} />),
    );
  });
  // Drain the mount-time dashboard fetch so no updates land after the test.
  await ReactTestRenderer.act(async () => {
    await new Promise((resolve) => setTimeout(() => resolve(undefined), 0));
  });
  return { renderer, client };
}

describe('HomeScreen', () => {
  afterEach(async () => {
    // Flush any trailing list updates so nothing logs after the test ends.
    await ReactTestRenderer.act(async () => {
      await new Promise((resolve) => setTimeout(() => resolve(undefined), 0));
    });
  });

  it('renders totals and recent entries after loading', async () => {
    const { renderer } = await renderHome(jest.fn().mockResolvedValue(dashboard));

    const text = strings(renderer);
    expect(text).toContain('7.5 h');
    expect(text).toContain('32 h');
    expect(text).toContain('Apollo');
    expect(text).toContain('Shipped the mobile dashboard');
  });

  it('shows an empty state when there are no entries', async () => {
    const empty = { ...dashboard, recentEntries: [] };
    const { renderer } = await renderHome(jest.fn().mockResolvedValue(empty));

    expect(strings(renderer)).toContain('No timesheet entries yet.');
  });

  it('falls back to the read-only cache while offline and flags it', async () => {
    const networkError = new Error('offline');
    (networkError as Error & { code?: string }).code = 'NETWORK_ERROR';
    const { renderer } = await renderHome(jest.fn().mockRejectedValue(networkError), dashboard);

    const text = strings(renderer);
    expect(text).toContain('Offline — showing your last saved dashboard. Pull to retry.');
    // Cached data stays visible.
    expect(text).toContain('Apollo');
    expect(text).toContain('7.5 h');
  });

  it('fetches the dashboard exactly once when no cache prop is provided', async () => {
    const getDashboard = jest.fn().mockResolvedValue(dashboard);
    const client = fakeClient({ getDashboard });
    const controller = fakeController(signedInState());
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(withSession(controller, client, <HomeScreen />));
    });
    // Drain several frames: a stable `load` effect must not re-fire loops.
    for (let i = 0; i < 3; i += 1) {
      await ReactTestRenderer.act(async () => {
        await new Promise((resolve) => setTimeout(() => resolve(undefined), 0));
      });
    }
    expect(getDashboard).toHaveBeenCalledTimes(1);
    expect(strings(renderer)).toContain('7.5 h');
  });

  it('offers a retry when offline with no cached data', async () => {
    const networkError = new Error('offline');
    (networkError as Error & { code?: string }).code = 'NETWORK_ERROR';
    const { renderer } = await renderHome(
      jest.fn().mockRejectedValueOnce(networkError).mockResolvedValueOnce(dashboard),
    );

    expect(strings(renderer)).toContain('no saved dashboard yet');

    const retry = renderer.root.find(
      (node) => node.props.accessibilityRole === 'button' && node.props.accessibilityLabel === 'Try again',
    );
    await ReactTestRenderer.act(async () => {
      retry.props.onPress();
      await new Promise((resolve) => setTimeout(() => resolve(undefined), 0));
    });
    await ReactTestRenderer.act(async () => {
      await new Promise((resolve) => setTimeout(() => resolve(undefined), 0));
    });

    expect(strings(renderer)).toContain('7.5 h');
  });
});
