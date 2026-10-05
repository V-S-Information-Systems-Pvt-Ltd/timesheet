// S1/S3 shell wiring: the discard guard and the save confirmation both live in
// MainNavigator, not in the entry form, because `onSuccess` unmounts the form
// immediately. These tests drive the real shell end to end.
//
// docs/plans/MOBILE_UI_USABILITY_IMPROVEMENT_PLAN.md (S1, S3).

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { MainNavigator } from '../App';
import { SessionProvider } from '../src/auth/SessionProvider';
import { ThemeProvider } from '../src/theme';
import { MemoryTokenStore } from '../test-utils/memory-token-store';
import { MemoryKvStore } from '../src/platform/kv-store';
import { OfflineQueue } from '../src/storage/offline-queue';
import { ApiClient, ApiClientError } from '../src/api/client';

jest.mock('../src/api/client', () => ({ ...jest.requireActual('../src/api/client'), ApiClient: jest.fn() }));
jest.setTimeout(20000);

let mockWidth = 375;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: mockWidth, height: 812, scale: 2, fontScale: 1 }),
}));

const ACTOR = {
  id: 'u1',
  email: 'emp@example.com',
  role: 'user',
  permissionRole: 'user',
  hierarchyRole: 'user',
  isActive: true,
  capabilities: {
    canViewTeam: false,
    canManageProjects: false,
    canManageActivities: false,
    canManageUsers: false,
    canManageSettings: false,
    canManageWorkspaceCustomization: false,
  },
};

const dashboard = {
  actor: ACTOR,
  today: { date: '2026-08-27', hours: 0 },
  week: { from: '2026-08-21', to: '2026-08-27', hours: 0 },
  recentEntries: [],
  quickActions: ['log-time'],
};

function mockApi(createTimesheet: jest.Mock) {
  (ApiClient as jest.MockedClass<typeof ApiClient>).mockImplementation(
    () =>
      ({
        baseUrl: 'https://timesheet.example.com',
        getConfig: jest.fn().mockResolvedValue({
          apiVersion: 1,
          appVersion: '1.0.0',
          backend: 'native',
          // The shell only queues offline writes against a server that can
          // deduplicate them; without this the enqueue refuses and the save
          // surfaces as an error instead of a queued confirmation.
          capabilities: { bearerAuth: true, mobileApi: true, durableIdempotency: true },
          branding: { appName: 'VSIS Timesheet', primaryColor: '#1E73BE', logoUrl: null },
        }),
        refresh: jest.fn().mockResolvedValue({
          accessToken: 'access-123',
          refreshToken: 'refresh-123',
          accessTokenExpiresAt: '',
          sessionId: 's1',
        }),
        getMe: jest.fn().mockResolvedValue(ACTOR),
        getReference: jest.fn().mockResolvedValue({
          projects: [{ id: 'p-internal', name: 'Internal' }],
          activityTypes: [{ id: 'a1', name: 'Development' }],
        }),
        getDashboard: jest.fn().mockResolvedValue(dashboard),
        listTimesheets: jest.fn().mockResolvedValue({ entries: [], totalCount: 0 }),
        createTimesheet,
      } as unknown as ApiClient)
  );
}

async function renderSignedInShell(
  createTimesheet: jest.Mock = jest.fn().mockResolvedValue({ success: true }),
  queue = new OfflineQueue(new MemoryKvStore())
) {
  mockApi(createTimesheet);
  const store = new MemoryTokenStore();
  await store.write({ refreshToken: 'initial-refresh', sessionId: 's1' });
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <SessionProvider
        initialServerUrl="https://timesheet.example.com"
        queue={queue}
        tokenStore={store}
      >
        <ThemeProvider primaryColor="#1E73BE">
          <MainNavigator />
        </ThemeProvider>
      </SessionProvider>
    );
  });
  return renderer;
}

function present(renderer: ReactTestRenderer.ReactTestRenderer, label: string): boolean {
  return renderer.root.findAllByProps({ accessibilityLabel: label }).length > 0;
}

async function press(
  renderer: ReactTestRenderer.ReactTestRenderer,
  label: string
): Promise<void> {
  const target = renderer.root.findAllByProps({ accessibilityLabel: label })[0];
  expect(target).toBeDefined();
  await ReactTestRenderer.act(async () => {
    await target.props.onPress();
  });
}

async function fillEntry(renderer: ReactTestRenderer.ReactTestRenderer): Promise<void> {
  await ReactTestRenderer.act(async () => {
    renderer.root.findAllByProps({ accessibilityLabel: 'Support' })[0].props.onPress();
  });
  await ReactTestRenderer.act(async () => {
    renderer.root.findAllByProps({ accessibilityLabel: 'Internal IT' })[0].props.onPress();
  });
  await ReactTestRenderer.act(async () => {
    renderer.root
      .findAllByProps({ accessibilityLabel: 'Hours Worked' })[0]
      .props.onChangeText('8');
    renderer.root
      .findAllByProps({ accessibilityLabel: 'Work Done' })[0]
      .props.onChangeText('Reviewed the offline queue');
  });
}

const isOnEntryForm = (renderer: ReactTestRenderer.ReactTestRenderer) =>
  present(renderer, 'Save timesheet entry');

// The save confirmation animates on a timer; keep it inside the test clock so
// nothing fires after the environment is torn down.
beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  ReactTestRenderer.act(() => {
    jest.runOnlyPendingTimers();
  });
  jest.useRealTimers();
});

describe('shell discard guard', () => {
  it.each(['CLASSIFICATION_REQUIRED', 'CLIENT_UPDATE_REQUIRED'])('shows a recovery block for uncertain %s without opening a replacement or losing same-key recovery', async code => {
    const serverUrl = 'https://timesheet.example.com';
    const store = new MemoryKvStore();
    const queue = new OfflineQueue(store);
    const input = { projectId: 'p1', activityTypeId: 'a1', hoursWorked: 4, workDone: 'Original draft', logDate: '2026-10-01' };
    await store.setItem(`vsis_offline_queue_${serverUrl}_u1`, JSON.stringify({ version: 2, tickets: {}, items: [{
      id: 'mut_uncertain', type: 'create_timesheet', payload: { input }, createdAt: '2026-10-01T08:00:00.000Z',
      retryCount: 0, status: 'manual_review', commitState: 'uncertain', origin: serverUrl,
    }] }));
    const createTimesheet = jest.fn().mockRejectedValue(new ApiClientError(409, { data: null, error: { code, message: 'Compatibility refusal' } }));
    const renderer = await renderSignedInShell(createTimesheet, queue);
    try {
      await press(renderer, 'Review and re-enter');
      expect(isOnEntryForm(renderer)).toBe(false);
      expect(renderer.root.findAll(node => node.props.children === 'Original request commit is uncertain. Draft retained; retry recovery before re-entering.').length).toBeGreaterThan(0);
      expect(await queue.list(serverUrl, 'u1')).toMatchObject([{ id: 'mut_uncertain', commitState: 'uncertain', payload: { input } }]);
      expect(present(renderer, 'Review and re-enter')).toBe(true);
      createTimesheet.mockResolvedValue({ success: true });
      await press(renderer, 'Review and re-enter');
      expect(createTimesheet).toHaveBeenCalledTimes(2);
      expect(createTimesheet.mock.calls.map(call => call[2])).toEqual([{ idempotencyKey: 'mut_uncertain' }, { idempotencyKey: 'mut_uncertain' }]);
      expect(await queue.size(serverUrl, 'u1')).toBe(0);
      expect(isOnEntryForm(renderer)).toBe(false);
    } finally {
      await ReactTestRenderer.act(async () => renderer.unmount());
    }
  });

  it('prompts before losing an unsaved entry and honours both answers', async () => {
    const renderer = await renderSignedInShell();

    await press(renderer, 'Log time');
    expect(isOnEntryForm(renderer)).toBe(true);
    await fillEntry(renderer);

    // Leaving for another tab is intercepted.
    await press(renderer, 'Timesheets Tab');
    expect(present(renderer, 'Keep editing')).toBe(true);
    expect(isOnEntryForm(renderer)).toBe(true);

    // Keeping editing returns to the untouched position.
    await press(renderer, 'Keep editing');
    expect(present(renderer, 'Keep editing')).toBe(false);
    expect(isOnEntryForm(renderer)).toBe(true);

    // Discarding leaves the form behind.
    await press(renderer, 'Timesheets Tab');
    await press(renderer, 'Discard');
    expect(present(renderer, 'Keep editing')).toBe(false);
    expect(isOnEntryForm(renderer)).toBe(false);
  });

  it('does not prompt when nothing was typed', async () => {
    const renderer = await renderSignedInShell();

    await press(renderer, 'Log time');
    await press(renderer, 'Timesheets Tab');

    expect(present(renderer, 'Keep editing')).toBe(false);
    expect(isOnEntryForm(renderer)).toBe(false);
  });

  it('discards a three-deep entry back to the list it came from', async () => {
    const renderer = await renderSignedInShell();

    // dashboard → timesheets → log-time. The exact frame shape this leaves is
    // pinned by navigation-reducer.test.ts; here the flow itself is covered.
    await press(renderer, 'View all timesheets');
    await press(renderer, 'Log time');
    await fillEntry(renderer);

    await press(renderer, 'Back');
    expect(present(renderer, 'Keep editing')).toBe(true);
    await press(renderer, 'Discard');

    expect(isOnEntryForm(renderer)).toBe(false);
    // The list the user came from, not a rebuilt dashboard.
    expect(present(renderer, 'Filter: All')).toBe(true);
  });
});

describe('shell save lifecycle', () => {
  it('ignores a save that finishes after its form was discarded and replaced', async () => {
    let resolveCreate: (value: unknown) => void = () => {};
    const createTimesheet = jest.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCreate = resolve;
        })
    );
    const renderer = await renderSignedInShell(createTimesheet);

    await press(renderer, 'Log time');
    await fillEntry(renderer);

    // The save is in flight and the user gives up on it.
    await ReactTestRenderer.act(async () => {
      renderer.root
        .findAllByProps({ accessibilityLabel: 'Save timesheet entry' })[0]
        .props.onPress();
    });
    expect(createTimesheet).toHaveBeenCalledTimes(1);

    await press(renderer, 'Back');
    expect(present(renderer, 'Keep editing')).toBe(true);
    await press(renderer, 'Discard');
    expect(isOnEntryForm(renderer)).toBe(false);

    // A new draft begins, then the abandoned write completes.
    await press(renderer, 'Log time');
    await fillEntry(renderer);

    await ReactTestRenderer.act(async () => {
      resolveCreate({ success: true });
    });

    // The stale completion must not clear the guard or navigate away from it.
    expect(isOnEntryForm(renderer)).toBe(true);
    expect(
      renderer.root.findAllByProps({ accessibilityLabel: 'Work Done' })[0].props.value
    ).toBe('Reviewed the offline queue');

    await press(renderer, 'Back');
    expect(present(renderer, 'Keep editing')).toBe(true);
  });

  it('gives a repeated confirmation its own full lifetime', async () => {
    const createTimesheet = jest.fn().mockResolvedValue({ success: true });
    const renderer = await renderSignedInShell(createTimesheet);

    await press(renderer, 'Log time');
    await fillEntry(renderer);
    await press(renderer, 'Save timesheet entry');
    expect(
      renderer.root.findAllByProps({ children: 'Entry saved.' }).length
    ).toBeGreaterThan(0);

    // Most of the first confirmation's lifetime elapses...
    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(2500);
    });
    expect(
      renderer.root.findAllByProps({ children: 'Entry saved.' }).length
    ).toBeGreaterThan(0);

    // ...and a second save produces the same copy.
    await press(renderer, 'Log time');
    await fillEntry(renderer);
    await press(renderer, 'Save timesheet entry');

    // The second confirmation must outlive the first one's remaining 500ms.
    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(
      renderer.root.findAllByProps({ children: 'Entry saved.' }).length
    ).toBeGreaterThan(0);
  });
});

describe('shell save confirmation', () => {
  it('confirms a committed save and leaves the form without prompting', async () => {
    const createTimesheet = jest.fn().mockResolvedValue({ success: true });
    const renderer = await renderSignedInShell(createTimesheet);

    await press(renderer, 'Log time');
    await fillEntry(renderer);
    await press(renderer, 'Save timesheet entry');

    expect(createTimesheet).toHaveBeenCalledTimes(1);
    expect(
      renderer.root.findAllByProps({ children: 'Entry saved.' }).length
    ).toBeGreaterThan(0);
    // A still-dirty flag would have raised the discard prompt here.
    expect(present(renderer, 'Keep editing')).toBe(false);
    expect(isOnEntryForm(renderer)).toBe(false);
  });

  it('says the entry is queued when the write never reached the server', async () => {
    const createTimesheet = jest
      .fn()
      .mockRejectedValue(new TypeError('Network request failed'));
    const renderer = await renderSignedInShell(createTimesheet);

    await press(renderer, 'Log time');
    await fillEntry(renderer);
    await press(renderer, 'Save timesheet entry');

    expect(
      renderer.root.findAllByProps({
        children: 'Saved offline — will sync when you reconnect.',
      }).length
    ).toBeGreaterThan(0);
    expect(isOnEntryForm(renderer)).toBe(false);
  });
});
