import React from 'react';
import { ScreenTheme } from '../test-utils/theme-fixture';
import ReactTestRenderer from 'react-test-renderer';
import { EditTimeScreen } from '../src/screens/EditTimeScreen';
import { SessionProvider } from '../src/auth/SessionProvider';
import { MemoryTokenStore } from '../src/platform/secure-storage';
import { ApiClient } from '../src/api/client';
import type { TimesheetEntry } from '../src/api/contracts';

jest.mock('../src/api/client');

describe('EditTimeScreen (WP-05A)', () => {
  const initialEntry: TimesheetEntry = {
    id: 'ts-101',
    user_id: 'u1',
    project_id: 'p1',
    project_name: 'Project Alpha',
    activity_type_id: 'a1',
    activity_name: 'Development',
    log_date: '2026-08-26',
    hours_worked: 6.5,
    work_done: 'Initial development implementation',
  };

  it('renders pre-populated values and submits update', async () => {
    const mockUpdateTimesheet = jest.fn().mockResolvedValue({ success: true });
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
        getReference: jest.fn().mockResolvedValue({
          projects: [{ id: 'p1', name: 'Project Alpha' }],
          activityTypes: [{ id: 'a1', name: 'Development' }],
        }),
        updateTimesheet: mockUpdateTimesheet,
        getDashboard: jest.fn().mockResolvedValue({}),
      } as unknown as ApiClient;
    });

    const store = new MemoryTokenStore();
    await store.write({ refreshToken: 'initial-refresh', sessionId: 's1' });
    const onSuccess = jest.fn();
    const onBack = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <ScreenTheme>
        <SessionProvider initialServerUrl="https://timesheet.example.com" tokenStore={store}>
          <EditTimeScreen
            entry={initialEntry}
            isDarkMode={false}
            onBack={onBack}
            onSuccess={onSuccess}
          />
        </SessionProvider>
        </ScreenTheme>
      );
    });

    const hoursInput = renderer!.root.findByProps({ accessibilityLabel: 'Hours Worked' });
    const workDoneInput = renderer!.root.findByProps({ accessibilityLabel: 'Work Done' });
    const saveBtn = renderer!.root.findByProps({ accessibilityLabel: 'Update timesheet entry' });

    expect(hoursInput.props.value).toBe('6.5');
    expect(workDoneInput.props.value).toBe('Initial development implementation');

    // Modify work done and hours
    await ReactTestRenderer.act(async () => {
      hoursInput.props.onChangeText('7.5');
      workDoneInput.props.onChangeText('Updated development with test coverage');
    });

    await ReactTestRenderer.act(async () => {
      await saveBtn.props.onPress();
    });

    expect(mockUpdateTimesheet).toHaveBeenCalledWith(
      'access-123',
      'ts-101',
      expect.objectContaining({
        projectId: 'p1',
        activityTypeId: 'a1',
        hoursWorked: 7.5,
        workDone: 'Updated development with test coverage',
        logDate: '2026-08-26',
      })
    );
    expect(onSuccess).toHaveBeenCalled();
  });
});
