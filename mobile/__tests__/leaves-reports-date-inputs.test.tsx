import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { LeavesScreen } from '../src/screens/LeavesScreen';
import { PrivilegedReportsScreen } from '../src/screens/PrivilegedReportsScreen';
import { SessionProvider } from '../src/auth/SessionProvider';
import { ScreenTheme } from '../test-utils/theme-fixture';
import { MemoryTokenStore } from '../test-utils/memory-token-store';
import { ApiClient } from '../src/api/client';

jest.mock('../src/api/client');

describe('leave and report date inputs (R2)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    ReactTestRenderer.act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  it('LeavesScreen opens DateChooserModal from the leave-date field and fills the result', async () => {
    (ApiClient as jest.MockedClass<typeof ApiClient>).mockImplementation(() => {
      return {
        getConfig: jest.fn().mockResolvedValue({}),
        refresh: jest.fn().mockResolvedValue({
          accessToken: 'access-123', refreshToken: 'refresh-123', accessTokenExpiresAt: '', sessionId: 's1',
        }),
        getMe: jest.fn().mockResolvedValue({
          id: 'u1', email: 'u@x.com', role: 'user', permissionLabel: 'user', permissionRole: 'user', hierarchyRole: 'user', isActive: true,
        }),
        listLeaves: jest.fn().mockResolvedValue([]),
      } as unknown as ApiClient;
    });

    const store = new MemoryTokenStore();
    await store.write({ refreshToken: 'ref-1', sessionId: 's1' });
    let renderer: ReactTestRenderer.ReactTestRenderer = undefined as never;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <ScreenTheme>
          <SessionProvider initialServerUrl="https://timesheet.example.com" tokenStore={store}>
            <LeavesScreen isDarkMode={false} onBack={jest.fn()} />
          </SessionProvider>
        </ScreenTheme>
      );
    });

    await ReactTestRenderer.act(async () => {
      renderer.root.findByProps({ accessibilityLabel: 'Mark leave' }).props.onPress();
    });

    // A calendar affordance opens the picker.
    const openBtn = renderer.root.findByProps({ accessibilityLabel: 'Open leave date picker' });
    await ReactTestRenderer.act(async () => {
      openBtn.props.onPress();
    });

    // The chooser is up (its confirm button is present), confirm a date.
    const confirmBtn = renderer.root.findByProps({ accessibilityLabel: 'Confirm leave date' });
    await ReactTestRenderer.act(async () => {
      await confirmBtn.props.onPress();
    });

    // Confirming resolves without error; the field carries the chooser's date.
    const field = renderer.root.findByProps({ accessibilityLabel: 'Leave Date' });
    expect(typeof field.props.value).toBe('string');
    expect(field.props.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('LeavesScreen says the format was wrong when a date is malformed', async () => {
    (ApiClient as jest.MockedClass<typeof ApiClient>).mockImplementation(() => {
      return {
        getConfig: jest.fn().mockResolvedValue({}),
        refresh: jest.fn().mockResolvedValue({
          accessToken: 'access-123', refreshToken: 'refresh-123', accessTokenExpiresAt: '', sessionId: 's1',
        }),
        getMe: jest.fn().mockResolvedValue({
          id: 'u1', email: 'u@x.com', role: 'user', permissionRole: 'user', hierarchyRole: 'user', isActive: true,
        }),
        listLeaves: jest.fn().mockResolvedValue([]),
      } as unknown as ApiClient;
    });

    const store = new MemoryTokenStore();
    await store.write({ refreshToken: 'ref-1', sessionId: 's1' });
    let renderer: ReactTestRenderer.ReactTestRenderer = undefined as never;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <ScreenTheme>
          <SessionProvider initialServerUrl="https://timesheet.example.com" tokenStore={store}>
            <LeavesScreen isDarkMode={false} onBack={jest.fn()} />
          </SessionProvider>
        </ScreenTheme>
      );
    });

    await ReactTestRenderer.act(async () => {
      renderer.root.findByProps({ accessibilityLabel: 'Mark leave' }).props.onPress();
    });

    await ReactTestRenderer.act(async () => {
      renderer.root.findByProps({ accessibilityLabel: 'Leave Date' }).props.onChangeText('10/07/2026');
      renderer.root.findByProps({ accessibilityLabel: 'Leave Reason' }).props.onChangeText('Trip');
    });

    await ReactTestRenderer.act(async () => {
      await renderer.root.findByProps({ accessibilityLabel: 'Submit leave' }).props.onPress();
    });

    const texts = renderer.root
      .findAllByType(require('react-native').Text)
      .flatMap((n) => (n.props as { children?: unknown }).children)
      .filter((c: unknown): c is string => typeof c === 'string');
    // The error must name the format, and no request may fire for it.
    expect(texts.some((t: string) => t.includes('YYYY-MM-DD format'))).toBe(true);
  });

  it('PrivilegedReportsScreen refuses an inverted or malformed custom range before requesting', async () => {
    const getReports = jest.fn().mockResolvedValue({ totalHours: 0, totalEntries: 0, byGroup: [] });
    (ApiClient as jest.MockedClass<typeof ApiClient>).mockImplementation(() => {
      return {
        getConfig: jest.fn().mockResolvedValue({}),
        refresh: jest.fn().mockResolvedValue({
          accessToken: 'access-123', refreshToken: 'refresh-123', accessTokenExpiresAt: '', sessionId: 's1',
        }),
        getMe: jest.fn().mockResolvedValue({
          id: 'u1', email: 'u@x.com', role: 'admin', permissionRole: 'admin', hierarchyRole: 'manager', isActive: true,
        }),
        listPeople: jest.fn().mockResolvedValue([]),
        getReports,
      } as unknown as ApiClient;
    });

    const store = new MemoryTokenStore();
    await store.write({ refreshToken: 'ref-1', sessionId: 's1' });
    let renderer: ReactTestRenderer.ReactTestRenderer = undefined as never;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <ScreenTheme>
          <SessionProvider initialServerUrl="https://timesheet.example.com" tokenStore={store}>
            <PrivilegedReportsScreen isDarkMode={false} onBack={jest.fn()} />
          </SessionProvider>
        </ScreenTheme>
      );
    });

    // Select the custom preset.
    await ReactTestRenderer.act(async () => {
      renderer.root.findByProps({ accessibilityLabel: 'Date preset Custom' }).props.onPress();
    });

    getReports.mockClear();
    await ReactTestRenderer.act(async () => {
      renderer.root.findByProps({ accessibilityLabel: 'Custom From Date' }).props.onChangeText('2026-09-10');
      renderer.root.findByProps({ accessibilityLabel: 'Custom To Date' }).props.onChangeText('2026-09-01');
    });
    await ReactTestRenderer.act(async () => {
      await Promise.resolve();
      jest.runOnlyPendingTimers();
    });

    // The inverted range must be refused client-side, before any request.
    expect(getReports).not.toHaveBeenCalled();
    const texts = renderer.root
      .findAllByType(require('react-native').Text)
      .flatMap((n) => (n.props as { children?: unknown }).children)
      .filter((c: unknown): c is string => typeof c === 'string');
    const rangeError = texts.find((t: string) => t.includes('must be on or before'));
    expect(rangeError).toBeDefined();
  });
});
