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

  it('updates hours using quick increment chips', async () => {
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
        createTimesheet: jest.fn().mockResolvedValue({ success: true }),
        getDashboard: jest.fn().mockResolvedValue({}),
      } as unknown as ApiClient;
    });

    const store = new MemoryTokenStore();
    await store.write({ refreshToken: 'initial-refresh', sessionId: 's1' });
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <SessionProvider initialServerUrl="https://timesheet.example.com" tokenStore={store}>
          <LogTimeScreen isDarkMode={false} onBack={jest.fn()} onSuccess={jest.fn()} />
        </SessionProvider>
      );
    });

    const addHalfHourBtn = renderer!.root.findByProps({ accessibilityLabel: 'Add 0.5 hours' });
    expect(addHalfHourBtn).toBeDefined();

    await ReactTestRenderer.act(async () => {
      addHalfHourBtn.props.onPress();
    });

    const hoursInput = renderer!.root.findByProps({ accessibilityLabel: 'Hours Worked' });
    expect(hoursInput.props.value).toBe('0.5');

    const setFullDayBtn = renderer!.root.findByProps({ accessibilityLabel: 'Set to 8.0 hours (full day)' });
    await ReactTestRenderer.act(async () => {
      setFullDayBtn.props.onPress();
    });
    expect(hoursInput.props.value).toBe('8');
  });

  it('selects project via quick chips and searchable picker modal', async () => {
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
          projects: [
            { id: 'p1', name: 'Project Alpha', code: 'ALPHA' },
            { id: 'p2', name: 'Project Beta', code: 'BETA' },
            { id: 'p3', name: 'Project Gamma', code: 'GAMMA' },
          ],
          activityTypes: [{ id: 'a1', name: 'Development' }],
        }),
        createTimesheet: mockCreateTimesheet,
        getDashboard: jest.fn().mockResolvedValue({}),
      } as unknown as ApiClient;
    });

    const store = new MemoryTokenStore();
    await store.write({ refreshToken: 'initial-refresh', sessionId: 's1' });
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <SessionProvider initialServerUrl="https://timesheet.example.com" tokenStore={store}>
          <LogTimeScreen isDarkMode={false} onBack={jest.fn()} onSuccess={jest.fn()} />
        </SessionProvider>
      );
    });

    // 1. Select via Quick Chip
    const betaChip = renderer!.root.findByProps({ accessibilityLabel: 'Quick select project Project Beta' });
    expect(betaChip).toBeDefined();

    await ReactTestRenderer.act(async () => {
      betaChip.props.onPress();
    });

    // 2. Open Searchable Modal
    const triggerCard = renderer!.root.findByProps({
      accessibilityLabel: 'Selected project: Project Beta. Tap to search or change project',
    });
    expect(triggerCard).toBeDefined();

    await ReactTestRenderer.act(async () => {
      triggerCard.props.onPress();
    });

    // 3. Search and select Project Gamma in modal
    const searchInput = renderer!.root.findByProps({ accessibilityLabel: 'Search projects by name or code...' });
    expect(searchInput).toBeDefined();

    await ReactTestRenderer.act(async () => {
      searchInput.props.onChangeText('Gamma');
    });

    const gammaRow = renderer!.root.findByProps({ accessibilityLabel: 'Project Gamma' });
    expect(gammaRow).toBeDefined();

    await ReactTestRenderer.act(async () => {
      gammaRow.props.onPress();
    });

    // 4. Verify selected project is now Project Gamma
    const updatedTriggerCard = renderer!.root.findByProps({
      accessibilityLabel: 'Selected project: Project Gamma. Tap to search or change project',
    });
    expect(updatedTriggerCard).toBeDefined();
  });
});
