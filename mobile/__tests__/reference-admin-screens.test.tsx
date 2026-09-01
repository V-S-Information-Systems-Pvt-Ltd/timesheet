import React from 'react';
import { ScreenTheme } from '../test-utils/theme-fixture';
import ReactTestRenderer from 'react-test-renderer';
import { ProjectAdminScreen } from '../src/screens/ProjectAdminScreen';
import { ActivityTypeAdminScreen } from '../src/screens/ActivityTypeAdminScreen';
import { SessionProvider } from '../src/auth/SessionProvider';
import { MemoryTokenStore } from '../src/platform/secure-storage';
import { ApiClient } from '../src/api/client';

jest.mock('../src/api/client');

describe('Slice 09: Reference Data Administration Screens', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    ReactTestRenderer.act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  describe('ProjectAdminScreen', () => {
    const mockProjects = [
      { id: 'p1', name: 'Internal Project', so_number: 'SO-100', telegram_no: 1, created_at: '' },
      { id: 'p2', name: 'Client Portal', so_number: 'SO-200', telegram_no: null, created_at: '' },
    ];

    it('renders project list and supports search filtering and creation flow', async () => {
      const listProjectsMock = jest.fn().mockResolvedValue(mockProjects);
      const createProjectMock = jest.fn().mockResolvedValue({
        id: 'p3',
        name: 'New Mobile App',
        so_number: 'SO-300',
        telegram_no: 2,
      });

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
            email: 'pm@example.com',
            role: 'pm',
            permissionRole: 'pm',
            hierarchyRole: 'user',
            isActive: true,
          }),
          getReference: jest.fn().mockResolvedValue({ projects: [], activityTypes: [] }),
          listAdminProjects: listProjectsMock,
          createAdminProject: createProjectMock,
        } as unknown as ApiClient;
      });

      const store = new MemoryTokenStore();
      await store.write({ refreshToken: 'initial-refresh', sessionId: 's1' });
      const onBack = jest.fn();
      let renderer: ReactTestRenderer.ReactTestRenderer;

      await ReactTestRenderer.act(async () => {
        renderer = ReactTestRenderer.create(
          <ScreenTheme>
          <SessionProvider initialServerUrl="https://timesheet.example.com" tokenStore={store}>
            <ProjectAdminScreen isDarkMode={false} onBack={onBack} />
          </SessionProvider>
          </ScreenTheme>
        );
      });

      // 1. Check projects rendered
      const p1Node = renderer!.root.findByProps({ accessibilityLabel: 'Project: Internal Project' });
      expect(p1Node).toBeDefined();

      // 2. Filter search query
      const searchInput = renderer!.root.findByProps({ accessibilityLabel: 'Search projects' });
      await ReactTestRenderer.act(async () => {
        searchInput.props.onChangeText('Portal');
      });

      const p2Node = renderer!.root.findByProps({ accessibilityLabel: 'Project: Client Portal' });
      expect(p2Node).toBeDefined();

      // 3. Open Create Project Modal
      const newBtn = renderer!.root.findByProps({ accessibilityLabel: 'Create Project' });
      await ReactTestRenderer.act(async () => {
        newBtn.props.onPress();
      });

      const nameInput = renderer!.root.findByProps({ accessibilityLabel: 'Project Name' });
      const soInput = renderer!.root.findByProps({ accessibilityLabel: 'SO Number' });
      const botInput = renderer!.root.findByProps({ accessibilityLabel: 'Telegram Bot Number' });

      await ReactTestRenderer.act(async () => {
        nameInput.props.onChangeText('New Mobile App');
        soInput.props.onChangeText('SO-300');
        botInput.props.onChangeText('2');
      });

      const saveBtn = renderer!.root.findByProps({ accessibilityLabel: 'Save Project' });
      await ReactTestRenderer.act(async () => {
        saveBtn.props.onPress();
      });

      expect(createProjectMock).toHaveBeenCalledWith(
        { name: 'New Mobile App', soNumber: 'SO-300', telegramNo: 2 },
        expect.any(String)
      );
    });
  });

  describe('ActivityTypeAdminScreen', () => {
    const mockActivities = [
      { id: 'a1', name: 'Software Development', is_active: true, telegram_no: 1 },
      { id: 'a2', name: 'Bug Investigation', is_active: false, telegram_no: null },
    ];

    it('renders activity types with status badges and supports active toggle and creation', async () => {
      const listActivitiesMock = jest.fn().mockResolvedValue(mockActivities);
      const updateActivityMock = jest.fn().mockResolvedValue({
        id: 'a1',
        name: 'Software Development',
        is_active: false,
      });
      const createActivityMock = jest.fn().mockResolvedValue({
        id: 'a3',
        name: 'Deployment',
        is_active: true,
        telegram_no: 4,
      });

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
            email: 'admin@example.com',
            role: 'admin',
            permissionRole: 'admin',
            hierarchyRole: 'manager',
            isActive: true,
          }),
          getReference: jest.fn().mockResolvedValue({ projects: [], activityTypes: [] }),
          listAdminActivityTypes: listActivitiesMock,
          updateAdminActivityType: updateActivityMock,
          createAdminActivityType: createActivityMock,
        } as unknown as ApiClient;
      });

      const store = new MemoryTokenStore();
      await store.write({ refreshToken: 'initial-refresh', sessionId: 's1' });
      const onBack = jest.fn();
      let renderer: ReactTestRenderer.ReactTestRenderer;

      await ReactTestRenderer.act(async () => {
        renderer = ReactTestRenderer.create(
          <ScreenTheme>
          <SessionProvider initialServerUrl="https://timesheet.example.com" tokenStore={store}>
            <ActivityTypeAdminScreen isDarkMode={false} onBack={onBack} />
          </SessionProvider>
          </ScreenTheme>
        );
      });

      // 1. Check activity item rendered
      const a1Node = renderer!.root.findByProps({
        accessibilityLabel: 'Activity Type: Software Development',
      });
      expect(a1Node).toBeDefined();

      // 2. Toggle active state
      const toggleBtn = renderer!.root.findByProps({
        accessibilityLabel: 'Deactivate Software Development',
      });
      await ReactTestRenderer.act(async () => {
        toggleBtn.props.onPress();
      });

      expect(updateActivityMock).toHaveBeenCalledWith(
        'a1',
        { isActive: false },
        expect.any(String)
      );

      // 3. Open Create Activity Type Modal
      const createBtn = renderer!.root.findByProps({ accessibilityLabel: 'Create Activity Type' });
      await ReactTestRenderer.act(async () => {
        createBtn.props.onPress();
      });

      const nameInput = renderer!.root.findByProps({ accessibilityLabel: 'Activity Type Name' });
      const botInput = renderer!.root.findByProps({ accessibilityLabel: 'Telegram Bot Number' });

      await ReactTestRenderer.act(async () => {
        nameInput.props.onChangeText('Deployment');
        botInput.props.onChangeText('4');
      });

      const saveBtn = renderer!.root.findByProps({ accessibilityLabel: 'Save Activity Type' });
      await ReactTestRenderer.act(async () => {
        saveBtn.props.onPress();
      });

      expect(createActivityMock).toHaveBeenCalledWith(
        { name: 'Deployment', telegramNo: 4 },
        expect.any(String)
      );
    });
  });
});
