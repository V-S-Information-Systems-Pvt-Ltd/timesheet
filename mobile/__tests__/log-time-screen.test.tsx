import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { LogTimeScreen } from '../src/screens/LogTimeScreen';
import { SessionProvider } from '../src/auth/SessionProvider';
import { MemoryTokenStore } from '../src/platform/secure-storage';
import { ApiClient } from '../src/api/client';

jest.mock('../src/api/client');

describe('LogTimeScreen', () => {
  it('renders correctly and submits valid entry', async () => {
    const mockCreateTimesheet = jest.fn().mockResolvedValue({ success: true });
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
        createTimesheet: mockCreateTimesheet,
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
        <SessionProvider initialServerUrl="https://timesheet.example.com" tokenStore={store}>
          <LogTimeScreen isDarkMode={false} onBack={onBack} onSuccess={onSuccess} />
        </SessionProvider>
      );
    });

    const hoursInput = renderer!.root.findByProps({ accessibilityLabel: 'Hours Worked' });
    const workDoneInput = renderer!.root.findByProps({ accessibilityLabel: 'Work Done' });
    const saveBtn = renderer!.root.findByProps({ accessibilityLabel: 'Save timesheet entry' });

    expect(hoursInput).toBeDefined();
    expect(workDoneInput).toBeDefined();

    await ReactTestRenderer.act(async () => {
      hoursInput.props.onChangeText('8');
      workDoneInput.props.onChangeText('Developed mobile features');
    });

    await ReactTestRenderer.act(async () => {
      await saveBtn.props.onPress();
    });

    expect(mockCreateTimesheet).toHaveBeenCalledWith(
      'access-123',
      expect.objectContaining({
        projectId: 'p1',
        activityTypeId: 'a1',
        hoursWorked: 8,
        workDone: 'Developed mobile features',
      })
    );
    expect(onSuccess).toHaveBeenCalled();
  });
});
