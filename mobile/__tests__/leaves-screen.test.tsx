import React from 'react';
import { ScreenTheme } from '../test-utils/theme-fixture';
import ReactTestRenderer from 'react-test-renderer';
import { LeavesScreen } from '../src/screens/LeavesScreen';
import { SessionProvider } from '../src/auth/SessionProvider';
import { MemoryTokenStore } from '../test-utils/memory-token-store';
import { ApiClient } from '../src/api/client';

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
        createLeave: mockCreateLeave,
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

    expect(mockCreateLeave).toHaveBeenCalledWith('access-123', expect.objectContaining({
      leaveDate: '2026-09-01',
      reason: 'Doctor appointment',
    }));

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

    // 2026-09-10, 2026-09-11, 2026-09-12 -> 3 calls
    expect(mockCreateLeave).toHaveBeenCalledWith('access-123', expect.objectContaining({
      leaveDate: '2026-09-10',
      reason: 'Conference',
    }));
    expect(mockCreateLeave).toHaveBeenCalledWith('access-123', expect.objectContaining({
      leaveDate: '2026-09-11',
      reason: 'Conference',
    }));
    expect(mockCreateLeave).toHaveBeenCalledWith('access-123', expect.objectContaining({
      leaveDate: '2026-09-12',
      reason: 'Conference',
    }));
  });
});
