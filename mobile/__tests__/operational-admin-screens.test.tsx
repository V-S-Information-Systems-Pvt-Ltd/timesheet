import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { SettingsAdminScreen } from '../src/screens/SettingsAdminScreen';
import { LeaveAdminScreen } from '../src/screens/LeaveAdminScreen';
import { GlobalReminderAdminScreen } from '../src/screens/GlobalReminderAdminScreen';
import { SessionProvider } from '../src/auth/SessionProvider';
import { MemoryTokenStore } from '../src/platform/secure-storage';
import { ApiClient } from '../src/api/client';

jest.mock('../src/api/client');

describe('Slice 11: Operational Administration Screens', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    ReactTestRenderer.act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  const mockUsers = [
    {
      id: 'u1',
      email: 'admin@vsis.lk',
      name: 'Admin User',
      department: 'Engineering',
      title: 'VP',
      role: 'admin',
      permissionRole: 'admin',
      hierarchyRole: 'manager',
      isActive: true,
    },
    {
      id: 'u2',
      email: 'dev@vsis.lk',
      name: 'Dev User',
      department: 'Engineering',
      title: 'Software Engineer',
      role: 'user',
      permissionRole: 'user',
      hierarchyRole: 'engineer',
      isActive: true,
    },
  ];

  const mockReference = {
    projects: [{ id: 'p1', name: 'Project Titan', is_active: true }],
    activityTypes: [{ id: 'a1', name: 'Software Development', is_active: true }],
  };

  describe('SettingsAdminScreen', () => {
    it('loads backfill policy, updates window setting, and supports admin time logging for user', async () => {
      const getBackfillMock = jest.fn().mockResolvedValue({ mode: 'days', windowDays: 7, extraDays: 0 });
      const updateBackfillMock = jest.fn().mockResolvedValue({ mode: 'days', windowDays: 14, extraDays: 0 });
      const createTimesheetMock = jest.fn().mockResolvedValue({ success: true });

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
            email: 'admin@vsis.lk',
            role: 'admin',
            permissionRole: 'admin',
            hierarchyRole: 'manager',
            isActive: true,
          }),
          getReference: jest.fn().mockResolvedValue(mockReference),
          getBackfillSettings: getBackfillMock,
          updateBackfillSettings: updateBackfillMock,
          listAdminUsers: jest.fn().mockResolvedValue(mockUsers),
          createTimesheet: createTimesheetMock,
        } as unknown as ApiClient;
      });

      const store = new MemoryTokenStore();
      await store.write({ refreshToken: 'initial-refresh', sessionId: 's1' });
      const onBack = jest.fn();
      let renderer: ReactTestRenderer.ReactTestRenderer;

      await ReactTestRenderer.act(async () => {
        renderer = ReactTestRenderer.create(
          <SessionProvider initialServerUrl="https://timesheet.example.com" tokenStore={store}>
            <SettingsAdminScreen isDarkMode={false} onBack={onBack} />
          </SessionProvider>
        );
      });

      // 1. Edit backfill days window and save
      const daysInput = renderer!.root.findByProps({ accessibilityLabel: 'Days Window' });
      await ReactTestRenderer.act(async () => {
        daysInput.props.onChangeText('14');
      });

      const savePolicyBtn = renderer!.root.findByProps({ accessibilityLabel: 'Save Backfill Policy' });
      await ReactTestRenderer.act(async () => {
        savePolicyBtn.props.onPress();
      });

      expect(updateBackfillMock).toHaveBeenCalledWith(
        { mode: 'days', windowDays: 14, extraDays: 0 },
        expect.any(String)
      );

      // 2. Admin logs time for another user
      const descInput = renderer!.root.findByProps({ accessibilityLabel: 'Work Description' });
      await ReactTestRenderer.act(async () => {
        descInput.props.onChangeText('Investigated core server performance');
      });

      const logBtn = renderer!.root.findByProps({ accessibilityLabel: 'Submit User Timesheet' });
      await ReactTestRenderer.act(async () => {
        logBtn.props.onPress();
      });

      expect(createTimesheetMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          userId: 'u1',
          projectId: 'p1',
          activityTypeId: 'a1',
          hoursWorked: 8,
          workDone: 'Investigated core server performance',
        })
      );
    });
  });

  describe('LeaveAdminScreen', () => {
    it('renders team leave records and creates new leave marker', async () => {
      const mockLeaves = [
        { id: 'l1', user_id: 'u2', leave_date: '2026-09-10', reason: 'Medical Leave' },
      ];
      const listLeavesMock = jest.fn().mockResolvedValue(mockLeaves);
      const createLeaveMock = jest.fn().mockResolvedValue({ success: true });

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
            email: 'admin@vsis.lk',
            role: 'admin',
            permissionRole: 'admin',
            hierarchyRole: 'manager',
            isActive: true,
          }),
          getReference: jest.fn().mockResolvedValue(mockReference),
          listAdminLeaves: listLeavesMock,
          createAdminLeave: createLeaveMock,
          listAdminUsers: jest.fn().mockResolvedValue(mockUsers),
        } as unknown as ApiClient;
      });

      const store = new MemoryTokenStore();
      await store.write({ refreshToken: 'initial-refresh', sessionId: 's1' });
      const onBack = jest.fn();
      let renderer: ReactTestRenderer.ReactTestRenderer;

      await ReactTestRenderer.act(async () => {
        renderer = ReactTestRenderer.create(
          <SessionProvider initialServerUrl="https://timesheet.example.com" tokenStore={store}>
            <LeaveAdminScreen isDarkMode={false} onBack={onBack} />
          </SessionProvider>
        );
      });

      // 1. Verify existing leave item rendered
      const itemNode = renderer!.root.findByProps({ accessibilityLabel: 'Leave for Dev User on 2026-09-10' });
      expect(itemNode).toBeDefined();

      // 2. Open record leave modal and submit
      const addBtn = renderer!.root.findByProps({ accessibilityLabel: 'Add Leave Marker' });
      await ReactTestRenderer.act(async () => {
        addBtn.props.onPress();
      });

      const reasonInput = renderer!.root.findByProps({ accessibilityLabel: 'Leave Reason' });
      await ReactTestRenderer.act(async () => {
        reasonInput.props.onChangeText('Vacation');
      });

      const saveBtn = renderer!.root.findByProps({ accessibilityLabel: 'Save Leave' });
      await ReactTestRenderer.act(async () => {
        saveBtn.props.onPress();
      });

      expect(createLeaveMock).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'u1',
          reason: 'Vacation',
        }),
        expect.any(String)
      );
    });
  });

  describe('GlobalReminderAdminScreen', () => {
    it('renders global reminders and broadcasts a new alert', async () => {
      const mockReminders = [
        { id: 'gr1', message: 'All hands meeting at 3 PM', remind_at: '2026-09-15T15:00:00.000Z' },
      ];
      const listRemindersMock = jest.fn().mockResolvedValue(mockReminders);
      const createReminderMock = jest.fn().mockResolvedValue({
        id: 'gr2',
        message: 'Sprint review tomorrow',
        remind_at: '2026-09-16T10:00:00.000Z',
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
            email: 'admin@vsis.lk',
            role: 'admin',
            permissionRole: 'admin',
            hierarchyRole: 'manager',
            isActive: true,
          }),
          getReference: jest.fn().mockResolvedValue(mockReference),
          listAllGlobalReminders: listRemindersMock,
          createAdminGlobalReminder: createReminderMock,
        } as unknown as ApiClient;
      });

      const store = new MemoryTokenStore();
      await store.write({ refreshToken: 'initial-refresh', sessionId: 's1' });
      const onBack = jest.fn();
      let renderer: ReactTestRenderer.ReactTestRenderer;

      await ReactTestRenderer.act(async () => {
        renderer = ReactTestRenderer.create(
          <SessionProvider initialServerUrl="https://timesheet.example.com" tokenStore={store}>
            <GlobalReminderAdminScreen isDarkMode={false} onBack={onBack} />
          </SessionProvider>
        );
      });

      // 1. Verify reminder rendered
      const itemNode = renderer!.root.findByProps({
        accessibilityLabel: 'Global Reminder: All hands meeting at 3 PM',
      });
      expect(itemNode).toBeDefined();

      // 2. Open broadcast modal and submit
      const createBtn = renderer!.root.findByProps({ accessibilityLabel: 'Create Global Reminder' });
      await ReactTestRenderer.act(async () => {
        createBtn.props.onPress();
      });

      const messageInput = renderer!.root.findByProps({ accessibilityLabel: 'Reminder Message' });
      await ReactTestRenderer.act(async () => {
        messageInput.props.onChangeText('Sprint review tomorrow');
      });

      const publishBtn = renderer!.root.findByProps({ accessibilityLabel: 'Publish Reminder' });
      await ReactTestRenderer.act(async () => {
        publishBtn.props.onPress();
      });

      expect(createReminderMock).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Sprint review tomorrow',
        }),
        expect.any(String)
      );
    });

    it('supports editing an existing global reminder', async () => {
      const mockReminders = [
        { id: 'gr1', message: 'All hands meeting at 3 PM', remind_at: '2026-09-15T15:00:00.000Z' },
      ];
      const updateReminderMock = jest.fn().mockResolvedValue({ success: true, id: 'gr1' });

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
            email: 'admin@vsis.lk',
            role: 'admin',
            permissionRole: 'admin',
            hierarchyRole: 'manager',
            isActive: true,
          }),
          getReference: jest.fn().mockResolvedValue(mockReference),
          listAllGlobalReminders: jest.fn().mockResolvedValue(mockReminders),
          updateAdminGlobalReminder: updateReminderMock,
        } as unknown as ApiClient;
      });

      const store = new MemoryTokenStore();
      await store.write({ refreshToken: 'initial-refresh', sessionId: 's1' });
      const onBack = jest.fn();
      let renderer: ReactTestRenderer.ReactTestRenderer;

      await ReactTestRenderer.act(async () => {
        renderer = ReactTestRenderer.create(
          <SessionProvider initialServerUrl="https://timesheet.example.com" tokenStore={store}>
            <GlobalReminderAdminScreen isDarkMode={false} onBack={onBack} />
          </SessionProvider>
        );
      });

      // 1. Open edit modal
      const editBtn = renderer!.root.findByProps({ accessibilityLabel: 'Edit reminder: All hands meeting at 3 PM' });
      await ReactTestRenderer.act(async () => {
        editBtn.props.onPress();
      });

      const messageInput = renderer!.root.findByProps({ accessibilityLabel: 'Reminder Message' });
      await ReactTestRenderer.act(async () => {
        messageInput.props.onChangeText('All hands meeting rescheduled to 4 PM');
      });

      const saveBtn = renderer!.root.findByProps({ accessibilityLabel: 'Save Reminder Changes' });
      await ReactTestRenderer.act(async () => {
        saveBtn.props.onPress();
      });

      expect(updateReminderMock).toHaveBeenCalledWith(
        'gr1',
        expect.objectContaining({
          message: 'All hands meeting rescheduled to 4 PM',
        }),
        expect.any(String)
      );
    });
  });
});
