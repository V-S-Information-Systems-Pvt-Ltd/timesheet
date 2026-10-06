import React from 'react';
import { Alert, Text } from 'react-native';
import { ScreenTheme } from '../test-utils/theme-fixture';
import ReactTestRenderer from 'react-test-renderer';
import { LeavesScreen } from '../src/screens/LeavesScreen';
import { SessionProvider } from '../src/auth/SessionProvider';
import { MemoryTokenStore } from '../test-utils/memory-token-store';
import { ApiClient } from '../src/api/client';
import { formatDatePreview, formatDateShort } from '../src/utils/dates';

jest.mock('../src/api/client');

describe('LeavesScreen', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    ReactTestRenderer.act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  it('renders leave records and submits single and range leaves', async () => {
    const mockCreateLeave = jest.fn().mockResolvedValue(undefined);
    (ApiClient as jest.MockedClass<typeof ApiClient>).mockImplementation(() => {
      return {
        getConfig: jest.fn().mockResolvedValue({
          apiVersion: 1,
          appVersion: 'test',
          backend: 'native',
          capabilities: { mobileApi: true, bearerAuth: true, durableIdempotency: true },
        }),
        refresh: jest.fn().mockResolvedValue({
          accessToken: 'access-123',
          refreshToken: 'refresh-123',
          accessTokenExpiresAt: '',
          sessionId: 's1',
        }),
        getMe: jest.fn().mockResolvedValue({
          id: 'u1',
          email: 'emp@example.com',
          role: 'user',
          permissionRole: 'user',
          hierarchyRole: 'user',
          isActive: true,
        }),
        listLeaves: jest.fn().mockResolvedValue([
          { id: 'l1', user_id: 'u1', leave_date: '2026-08-28', reason: 'Vacation' },
        ]),
        createLeave: mockCreateLeave,
        issueIdempotencyTickets: jest.fn().mockResolvedValue({
          tickets: Array.from({ length: 10 }, (_, index) => ({
            key: `mf_test_leave_${index}`,
            expiresAt: new Date(Date.now() + 97 * 86400000).toISOString(),
          })),
        }),
      } as unknown as ApiClient;
    });

    const store = new MemoryTokenStore();
    await store.write({ refreshToken: 'ref-1', sessionId: 's1' });
    const onBack = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <ScreenTheme>
        <SessionProvider initialServerUrl="https://timesheet.example.com" tokenStore={store}>
          <LeavesScreen isDarkMode={false} onBack={onBack} />
        </SessionProvider>
        </ScreenTheme>
      );
    });

    const backBtn = renderer!.root.findByProps({ accessibilityLabel: 'Back to dashboard' });
    expect(backBtn).toBeDefined();

    // Open add leave form
    let markLeaveBtn = renderer!.root.findByProps({ accessibilityLabel: 'Mark leave' });
    await ReactTestRenderer.act(async () => {
      markLeaveBtn.props.onPress();
    });

    // Single mode submit
    const leaveDateInput = renderer!.root.findByProps({ accessibilityLabel: 'Leave Date' });
    const reasonInput = renderer!.root.findByProps({ accessibilityLabel: 'Leave Reason' });

    await ReactTestRenderer.act(async () => {
      leaveDateInput.props.onChangeText('2026-09-01');
      reasonInput.props.onChangeText('Doctor appointment');
    });

    let submitBtn = renderer!.root.findByProps({ accessibilityLabel: 'Submit leave' });
    await ReactTestRenderer.act(async () => {
      await submitBtn.props.onPress();
    });

    expect(mockCreateLeave).toHaveBeenCalledWith('access-123', [expect.objectContaining({
      leaveDate: '2026-09-01',
      reason: 'Doctor appointment',
    })]);

    // Reopen form and switch to Range mode
    markLeaveBtn = renderer!.root.findByProps({ accessibilityLabel: 'Mark leave' });
    await ReactTestRenderer.act(async () => {
      markLeaveBtn.props.onPress();
    });
    const rangeModeBtn = renderer!.root.findByProps({ accessibilityLabel: 'Date range mode' });
    await ReactTestRenderer.act(async () => {
      rangeModeBtn.props.onPress();
    });

    const startDateInput = renderer!.root.findByProps({ accessibilityLabel: 'Start Date' });
    const endDateInput = renderer!.root.findByProps({ accessibilityLabel: 'End Date' });
    const rangeReasonInput = renderer!.root.findByProps({ accessibilityLabel: 'Leave Reason' });

    await ReactTestRenderer.act(async () => {
      startDateInput.props.onChangeText('2026-09-10');
      endDateInput.props.onChangeText('2026-09-12');
      rangeReasonInput.props.onChangeText('Conference');
    });

    submitBtn = renderer!.root.findByProps({ accessibilityLabel: 'Submit leave' });
    await ReactTestRenderer.act(async () => {
      await submitBtn.props.onPress();
    });

    // 2026-09-10, 2026-09-11, 2026-09-12 -> one batch carrying all three rows
    expect(mockCreateLeave).toHaveBeenCalledWith('access-123', [
      expect.objectContaining({ leaveDate: '2026-09-10', reason: 'Conference' }),
      expect.objectContaining({ leaveDate: '2026-09-11', reason: 'Conference' }),
      expect.objectContaining({ leaveDate: '2026-09-12', reason: 'Conference' }),
    ]);
  });

  it('shows each leave with a readable date and confirms deletion with it', async () => {
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
          email: 'emp@example.com',
          role: 'user',
          permissionRole: 'user',
          hierarchyRole: 'user',
          isActive: true,
        }),
        listLeaves: jest.fn().mockResolvedValue([
          { id: 'l1', user_id: 'u1', leave_date: '2026-08-28', reason: 'Vacation' },
        ]),
      } as unknown as ApiClient;
    });

    const store = new MemoryTokenStore();
    await store.write({ refreshToken: 'ref-1', sessionId: 's1' });
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

    try {
      let renderer: ReactTestRenderer.ReactTestRenderer;
      await ReactTestRenderer.act(async () => {
        renderer = ReactTestRenderer.create(
          <ScreenTheme>
            <SessionProvider initialServerUrl="https://timesheet.example.com" tokenStore={store}>
              <LeavesScreen isDarkMode={false} onBack={jest.fn()} />
            </SessionProvider>
          </ScreenTheme>
        );
      });

      const readable = formatDateShort('2026-08-28');
      expect(readable).not.toBe('2026-08-28');
      expect(
        renderer!.root.findAllByProps({ accessibilityLabel: `Delete leave on ${readable}` }).length
      ).toBeGreaterThan(0);

      const visibleText = renderer!.root
        .findAllByType(Text)
        .flatMap((node) => node.props.children)
        .filter((child): child is string => typeof child === 'string');
      expect(visibleText).toContain(readable);
      expect(visibleText).not.toContain('2026-08-28');

      await ReactTestRenderer.act(async () => {
        renderer!.root
          .findAllByProps({ accessibilityLabel: `Delete leave on ${readable}` })[0]
          .props.onPress();
      });

      const body = String(alertSpy.mock.calls[0]?.[1] ?? '');
      expect(body).toContain(formatDatePreview('2026-08-28'));
      expect(body).not.toContain('2026-08-28');
    } finally {
      alertSpy.mockRestore();
    }
  });

  it('submits a range leave as one atomic batch request, and a batch failure is not reported as success', async () => {
    let callCount = 0;
    const failSecondBatch = jest.fn().mockImplementation(() => {
      callCount += 1;
      if (callCount === 1) return Promise.resolve({ success: true });
      return Promise.reject(new Error('leave overlap rejected'));
    });
    (ApiClient as jest.MockedClass<typeof ApiClient>).mockImplementation(() => {
      return {
        getConfig: jest.fn().mockResolvedValue({
          apiVersion: 1,
          appVersion: 'test',
          backend: 'native',
          capabilities: { mobileApi: true, bearerAuth: true, durableIdempotency: true },
        }),
        refresh: jest.fn().mockResolvedValue({
          accessToken: 'access-123', refreshToken: 'refresh-123', accessTokenExpiresAt: '', sessionId: 's1',
        }),
        getMe: jest.fn().mockResolvedValue({
          id: 'u1', email: 'emp@example.com', role: 'user', permissionRole: 'user', hierarchyRole: 'user', isActive: true,
        }),
        listLeaves: jest.fn().mockResolvedValue([]),
        createLeave: failSecondBatch,
        issueIdempotencyTickets: jest.fn().mockResolvedValue({
          tickets: Array.from({ length: 10 }, (_, index) => ({
            key: `mf_test_leave_${index}`,
            expiresAt: new Date(Date.now() + 97 * 86400000).toISOString(),
          })),
        }),
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

    const markLeaveBtn = renderer.root.findByProps({ accessibilityLabel: 'Mark leave' });
    await ReactTestRenderer.act(async () => {
      markLeaveBtn.props.onPress();
    });
    const rangeModeBtn = renderer.root.findByProps({ accessibilityLabel: 'Date range mode' });
    await ReactTestRenderer.act(async () => {
      rangeModeBtn.props.onPress();
    });

    await ReactTestRenderer.act(async () => {
      renderer.root.findByProps({ accessibilityLabel: 'Start Date' }).props.onChangeText('2026-09-10');
      renderer.root.findByProps({ accessibilityLabel: 'End Date' }).props.onChangeText('2026-09-12');
      renderer.root.findByProps({ accessibilityLabel: 'Leave Reason' }).props.onChangeText('Conference');
    });

    const submitBtn = renderer.root.findByProps({ accessibilityLabel: 'Submit leave' });
    await ReactTestRenderer.act(async () => {
      await submitBtn.props.onPress();
    });

    // Atomic batch: exactly ONE request carrying all three rows. The previous
    // behavior was one request per day (three calls), so a mid-batch failure
    // left earlier days committed with no report.
    expect(failSecondBatch).toHaveBeenCalledTimes(1);
    const batchRows = failSecondBatch.mock.calls[0][1];
    expect(batchRows).toHaveLength(3);
    expect(batchRows[0]).toEqual(
      expect.objectContaining({ userId: 'u1', reason: 'Conference' })
    );
  });
});
