import React from 'react';
import { ScreenTheme } from '../test-utils/theme-fixture';
import ReactTestRenderer from 'react-test-renderer';
import { RemindersScreen } from '../src/screens/RemindersScreen';
import { SessionProvider } from '../src/auth/SessionProvider';
import { MemoryTokenStore } from '../test-utils/memory-token-store';
import { ApiClient } from '../src/api/client';

jest.mock('../src/api/client');

describe('RemindersScreen', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    ReactTestRenderer.act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  it('renders reminder list and handles back action', async () => {
    (ApiClient as jest.MockedClass<typeof ApiClient>).mockImplementation(() => {
      return {
        getConfig: jest.fn().mockResolvedValue({}),
        listReminders: jest.fn().mockResolvedValue([
          { id: 'r1', user_id: 'u1', message: 'Submit hours', remind_at: '2026-08-30T10:00:00Z', done: false },
        ]),
        listGlobalReminders: jest.fn().mockResolvedValue([]),
      } as unknown as ApiClient;
    });

    const store = new MemoryTokenStore();
    const onBack = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <ScreenTheme>
        <SessionProvider initialServerUrl="https://timesheet.example.com" tokenStore={store}>
          <RemindersScreen isDarkMode={false} onBack={onBack} />
        </SessionProvider>
        </ScreenTheme>
      );
    });

    const backBtn = renderer!.root.findByProps({ accessibilityLabel: 'Back to dashboard' });
    expect(backBtn).toBeDefined();

    await ReactTestRenderer.act(async () => {
      backBtn.props.onPress();
    });
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('renders global reminders banner and handles dismissal', async () => {
    const mockDismissGlobal = jest.fn().mockResolvedValue({ success: true });
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
          email: 'u@example.com',
          role: 'user',
          permissionRole: 'user',
          hierarchyRole: 'user',
          isActive: true,
        }),
        listReminders: jest.fn().mockResolvedValue([]),
        listGlobalReminders: jest.fn().mockResolvedValue([
          { id: 'g1', message: 'System maintenance at midnight', remind_at: '2026-08-30T00:00:00Z' },
        ]),
        dismissGlobalReminder: mockDismissGlobal,
      } as unknown as ApiClient;
    });

    const store = new MemoryTokenStore();
    await store.write({ refreshToken: 'ref-1', sessionId: 's1' });
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <ScreenTheme>
        <SessionProvider initialServerUrl="https://timesheet.example.com" tokenStore={store}>
          <RemindersScreen isDarkMode={false} onBack={jest.fn()} />
        </SessionProvider>
        </ScreenTheme>
      );
    });

    const dismissBtn = renderer!.root.findByProps({
      accessibilityLabel: 'Dismiss global reminder: System maintenance at midnight',
    });
    expect(dismissBtn).toBeDefined();

    await ReactTestRenderer.act(async () => {
      await dismissBtn.props.onPress();
    });

    expect(mockDismissGlobal).toHaveBeenCalledWith('access-123', 'g1');
  });

  it('opens add form, selects preset, validates, and creates reminder with ISO date', async () => {
    const mockCreateReminder = jest.fn().mockResolvedValue({ id: 'r2', user_id: 'u1', message: 'Test reminder', remind_at: '2026-08-30T10:00:00.000Z', done: false });
    const mockListReminders = jest.fn().mockResolvedValue([]);

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
          email: 'u@example.com',
          role: 'user',
          permissionRole: 'user',
          hierarchyRole: 'user',
          isActive: true,
        }),
        listReminders: mockListReminders,
        listGlobalReminders: jest.fn().mockResolvedValue([]),
        createReminder: mockCreateReminder,
      } as unknown as ApiClient;
    });

    const store = new MemoryTokenStore();
    await store.write({ refreshToken: 'ref-1', sessionId: 's1' });
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <ScreenTheme>
        <SessionProvider initialServerUrl="https://timesheet.example.com" tokenStore={store}>
          <RemindersScreen isDarkMode={false} onBack={jest.fn()} />
        </SessionProvider>
        </ScreenTheme>
      );
    });

    // 1. Open form
    const newBtn = renderer!.root.findByProps({ accessibilityLabel: 'New reminder' });
    await ReactTestRenderer.act(async () => {
      newBtn.props.onPress();
    });

    const messageInput = renderer!.root.findByProps({ accessibilityLabel: 'Reminder message' });
    const dateInput = renderer!.root.findByProps({ accessibilityLabel: 'Remind date time' });
    const saveBtn = renderer!.root.findByProps({ accessibilityLabel: 'Save reminder' });

    // 2. Validate invalid date string
    await ReactTestRenderer.act(async () => {
      messageInput.props.onChangeText('Check team progress');
      dateInput.props.onChangeText('invalid-date-format');
    });

    await ReactTestRenderer.act(async () => {
      await saveBtn.props.onPress();
    });

    expect(mockCreateReminder).not.toHaveBeenCalled();
    const errorBox = renderer!.root.findByProps({ accessibilityRole: 'alert' });
    expect(errorBox).toBeDefined();

    // 3. Select preset "+1 Hour"
    const plusOneHourBtn = renderer!.root.findByProps({ accessibilityLabel: 'Remind in 1 hour' });
    await ReactTestRenderer.act(async () => {
      plusOneHourBtn.props.onPress();
    });

    // 4. Save with valid local time formatted by preset
    await ReactTestRenderer.act(async () => {
      await saveBtn.props.onPress();
    });

    expect(mockCreateReminder).toHaveBeenCalledWith(
      'access-123',
      expect.objectContaining({
        message: 'Check team progress',
        remindAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
      })
    );
  });
});
