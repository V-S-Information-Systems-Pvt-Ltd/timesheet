import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { LeaveAdminScreen } from '../src/screens/LeaveAdminScreen';
import { GlobalReminderAdminScreen } from '../src/screens/GlobalReminderAdminScreen';
import { RemindersScreen } from '../src/screens/RemindersScreen';
import { SessionProvider } from '../src/auth/SessionProvider';
import { MemoryTokenStore } from '../test-utils/memory-token-store';
import { ApiClient } from '../src/api/client';
import { todayISO } from '../src/utils/dates';
import { ScreenTheme } from '../test-utils/theme-fixture';

jest.mock('../src/api/client');

/**
 * R2: local time, everywhere a human reads or picks it. The device timezone
 * in Jest is the runner's local zone; every assertion here derives the
 * expectation from the same Date APIs the production code should use, so the
 * tests hold in any zone — including the UTC+5:30-style offsets where
 * `toISOString().slice(0, 10)` disagrees with the local calendar day.
 */

function useTimers() {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    ReactTestRenderer.act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });
}

const adminActor = {
  id: 'u1',
  email: 'admin@vsis.lk',
  name: 'Admin',
  role: 'admin',
  permissionRole: 'admin',
  hierarchyRole: 'manager',
  isActive: true,
};

describe('local-time defaults (R2)', () => {
  useTimers();

  it('LeaveAdminScreen prefills the local calendar day, not the UTC day', async () => {
    (ApiClient as jest.MockedClass<typeof ApiClient>).mockImplementation(() => {
      return {
        getConfig: jest.fn().mockResolvedValue({}),
        refresh: jest.fn().mockResolvedValue({
          accessToken: 'access-123', refreshToken: 'refresh-123', accessTokenExpiresAt: '', sessionId: 's1',
        }),
        getMe: jest.fn().mockResolvedValue(adminActor),
        getReference: jest.fn().mockResolvedValue({ projects: [], activityTypes: [] }),
        listAdminUsers: jest.fn().mockResolvedValue([
          { id: 'u2', email: 'dev@vsis.lk', name: 'Dev', role: 'user', permissionRole: 'user', hierarchyRole: 'engineer', isActive: true },
        ]),
        listAdminLeaves: jest.fn().mockResolvedValue([]),
      } as unknown as ApiClient;
    });

    const store = new MemoryTokenStore();
    await store.write({ refreshToken: 'ref-1', sessionId: 's1' });
    let renderer: ReactTestRenderer.ReactTestRenderer = undefined as never;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <ScreenTheme>
        <SessionProvider initialServerUrl="https://timesheet.example.com" tokenStore={store}>
          <LeaveAdminScreen isDarkMode={false} onBack={jest.fn()} />
        </SessionProvider>
        </ScreenTheme>
      );
    });

    // Open the create modal.
    await ReactTestRenderer.act(async () => {
      renderer.root.findAllByProps({ accessibilityLabel: 'Add Leave Marker' })[0].props.onPress();
    });

    const dateInput = renderer.root.findByProps({ accessibilityLabel: 'Leave Date' });
    expect(dateInput.props.value).toBe(todayISO());
  });

  it('GlobalReminderAdminScreen seeds the create form with the local wall clock and round-trips edits', async () => {
    const storedIso = '2026-03-05T14:30:00.000Z';
    const updateAdminMock = jest.fn().mockResolvedValue({});
    (ApiClient as jest.MockedClass<typeof ApiClient>).mockImplementation(() => {
      return {
        getConfig: jest.fn().mockResolvedValue({}),
        refresh: jest.fn().mockResolvedValue({
          accessToken: 'access-123', refreshToken: 'refresh-123', accessTokenExpiresAt: '', sessionId: 's1',
        }),
        getMe: jest.fn().mockResolvedValue(adminActor),
        listAllGlobalReminders: jest.fn().mockResolvedValue([
          { id: 'g1', message: 'Maintenance', remind_at: storedIso },
        ]),
        createAdminGlobalReminder: jest.fn().mockResolvedValue({}),
        updateAdminGlobalReminder: updateAdminMock,
      } as unknown as ApiClient;
    });

    const store = new MemoryTokenStore();
    await store.write({ refreshToken: 'ref-1', sessionId: 's1' });
    let renderer: ReactTestRenderer.ReactTestRenderer = undefined as never;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <ScreenTheme>
        <SessionProvider initialServerUrl="https://timesheet.example.com" tokenStore={store}>
          <GlobalReminderAdminScreen isDarkMode={false} onBack={jest.fn()} />
        </SessionProvider>
        </ScreenTheme>
      );
    });

    // Edit seeds the field with the stored instant's LOCAL wall clock.
    await ReactTestRenderer.act(async () => {
      renderer.root.findAllByProps({ accessibilityLabel: 'Edit reminder: Maintenance' })[0].props.onPress();
    });
    const field = renderer.root.findByProps({ accessibilityLabel: 'Scheduled Time' });
    const expectedLocal = new Date(storedIso);
    const pad = (n: number) => String(n).padStart(2, '0');
    const expected = `${expectedLocal.getFullYear()}-${pad(expectedLocal.getMonth() + 1)}-${pad(expectedLocal.getDate())}T${pad(expectedLocal.getHours())}:${pad(expectedLocal.getMinutes())}`;
    expect(field.props.value).toBe(expected);

    // Submitting without touching the field round-trips the same instant.
    await ReactTestRenderer.act(async () => {
      await renderer.root.findByProps({ accessibilityLabel: 'Save Reminder Changes' }).props.onPress();
    });
    expect(updateAdminMock).toHaveBeenCalledWith('g1', { message: 'Maintenance', remindAt: storedIso }, 'access-123');
  });

  it('RemindersScreen renders reminder times in local time, not sliced UTC', async () => {
    (ApiClient as jest.MockedClass<typeof ApiClient>).mockImplementation(() => {
      return {
        getConfig: jest.fn().mockResolvedValue({}),
        refresh: jest.fn().mockResolvedValue({
          accessToken: 'access-123', refreshToken: 'refresh-123', accessTokenExpiresAt: '', sessionId: 's1',
        }),
        getMe: jest.fn().mockResolvedValue({
          id: 'u1', email: 'u@x.com', role: 'user', permissionRole: 'user', hierarchyRole: 'user', isActive: true,
        }),
        listReminders: jest.fn().mockResolvedValue([
          { id: 'r1', user_id: 'u1', message: 'Submit hours', remind_at: '2026-08-30T10:00:00Z', done: false },
        ]),
        listGlobalReminders: jest.fn().mockResolvedValue([]),
      } as unknown as ApiClient;
    });

    const store = new MemoryTokenStore();
    await store.write({ refreshToken: 'ref-1', sessionId: 's1' });
    let renderer: ReactTestRenderer.ReactTestRenderer = undefined as never;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <ScreenTheme>
        <SessionProvider initialServerUrl="https://timesheet.example.com" tokenStore={store}>
          <RemindersScreen isDarkMode={false} onBack={jest.fn()} />
        </SessionProvider>
        </ScreenTheme>
      );
    });

    const renderedTexts = renderer.root
      .findAllByType(require('react-native').Text)
      .flatMap((node) => (node.props as { children?: unknown }).children)
      .filter((child): child is string => typeof child === 'string');

    // The stored instant 2026-08-30T10:00Z must render as the LOCAL wall
    // clock. The old slice() printed the UTC fields; assert they are absent
    // whenever they differ from local.
    const utcRender = '2026-08-30 10:00';
    const localRender = (() => {
      const d = new Date('2026-08-30T10:00:00Z');
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    })();
    if (localRender !== utcRender) {
      expect(renderedTexts).not.toContain(utcRender);
    }
    expect(renderedTexts.some((t: string) => t.includes(localRender))).toBe(true);
  });
});
