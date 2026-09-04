import React from 'react';
import { ScreenTheme } from '../test-utils/theme-fixture';
import ReactTestRenderer from 'react-test-renderer';
import { DateChooserModal } from '../src/components/DateChooserModal';
import { TimesheetListScreen } from '../src/screens/TimesheetListScreen';
import { SessionProvider } from '../src/auth/SessionProvider';
import { MemoryTokenStore } from '../test-utils/memory-token-store';
import { ApiClient } from '../src/api/client';
import { getPalette } from '../src/theme';
import { todayISO, addDaysISO } from '../src/utils/dates';

jest.mock('../src/api/client');

describe('Slice 05: Date-aware timesheet duplication', () => {
  const palette = getPalette(false);

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    ReactTestRenderer.act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  describe('DateChooserModal Component', () => {
    it('renders with initial date and handles quick options', async () => {
      const onConfirm = jest.fn();
      const onCancel = jest.fn();
      const today = todayISO();
      const yesterday = addDaysISO(today, -1);

      let renderer: ReactTestRenderer.ReactTestRenderer;
      await ReactTestRenderer.act(async () => {
        renderer = ReactTestRenderer.create(
          <DateChooserModal
            initialDate={today}
            onCancel={onCancel}
            onConfirm={onConfirm}
            palette={palette}
            title="Duplicate Timesheet"
            visible={true}
          />
        );
      });

      // Quick option: Yesterday
      const yesterdayBtn = renderer!.root.findByProps({ accessibilityLabel: 'Choose yesterday' });
      expect(yesterdayBtn).toBeDefined();

      await ReactTestRenderer.act(async () => {
        yesterdayBtn.props.onPress();
      });

      // Confirm button
      const confirmBtn = renderer!.root.findByProps({ accessibilityLabel: 'Confirm duplicate' });
      expect(confirmBtn).toBeDefined();

      await ReactTestRenderer.act(async () => {
        await confirmBtn.props.onPress();
      });

      expect(onConfirm).toHaveBeenCalledWith(yesterday);
      expect(onCancel).not.toHaveBeenCalled();
    });

    it('cancelling date modal calls onCancel and does not call onConfirm', async () => {
      const onConfirm = jest.fn();
      const onCancel = jest.fn();

      let renderer: ReactTestRenderer.ReactTestRenderer;
      await ReactTestRenderer.act(async () => {
        renderer = ReactTestRenderer.create(
          <DateChooserModal
            onCancel={onCancel}
            onConfirm={onConfirm}
            palette={palette}
            title="Duplicate Timesheet"
            visible={true}
          />
        );
      });

      const cancelBtn = renderer!.root.findByProps({ accessibilityLabel: 'Cancel duplicate' });
      expect(cancelBtn).toBeDefined();

      await ReactTestRenderer.act(async () => {
        cancelBtn.props.onPress();
      });

      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(onConfirm).not.toHaveBeenCalled();
    });

    it('validates custom date input and rejects invalid format', async () => {
      const onConfirm = jest.fn();
      const onCancel = jest.fn();

      let renderer: ReactTestRenderer.ReactTestRenderer;
      await ReactTestRenderer.act(async () => {
        renderer = ReactTestRenderer.create(
          <DateChooserModal
            onCancel={onCancel}
            onConfirm={onConfirm}
            palette={palette}
            title="Duplicate Timesheet"
            visible={true}
          />
        );
      });

      const input = renderer!.root.findByProps({ accessibilityLabel: 'Duplicate target date' });
      expect(input).toBeDefined();

      // Enter invalid date
      await ReactTestRenderer.act(async () => {
        input.props.onChangeText('invalid-date');
      });

      const confirmBtn = renderer!.root.findByProps({ accessibilityLabel: 'Confirm duplicate' });
      expect(confirmBtn.props.disabled).toBe(true);

      // Enter valid date
      await ReactTestRenderer.act(async () => {
        input.props.onChangeText('2026-08-15');
      });

      expect(confirmBtn.props.disabled).toBe(false);
      await ReactTestRenderer.act(async () => {
        await confirmBtn.props.onPress();
      });

      expect(onConfirm).toHaveBeenCalledWith('2026-08-15');
    });
  });

  describe('TimesheetListScreen Duplication Flow', () => {
    it('cancelling single duplicate performs no network requests', async () => {
      const mockDuplicate = jest.fn();

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
          listTimesheets: jest.fn().mockResolvedValue({
            rows: [
              {
                id: 't1',
                user_id: 'u1',
                project_id: 'p1',
                project_name: 'Project Alpha',
                activity_type_id: 'a1',
                activity_name: 'Development',
                log_date: '2026-08-26',
                hours_worked: 8,
                work_done: 'Coding',
              },
            ],
            total: 1,
          }),
          duplicateTimesheet: mockDuplicate,
          getDashboard: jest.fn().mockResolvedValue({}),
        } as unknown as ApiClient;
      });

      const store = new MemoryTokenStore();
      await store.write({ refreshToken: 'initial-refresh', sessionId: 's1' });
      let renderer: ReactTestRenderer.ReactTestRenderer;

      await ReactTestRenderer.act(async () => {
        renderer = ReactTestRenderer.create(
          <ScreenTheme>
          <SessionProvider initialServerUrl="https://timesheet.example.com" tokenStore={store}>
            <TimesheetListScreen
              isDarkMode={false}
              onBack={jest.fn()}
              onLogTime={jest.fn()}
            />
          </SessionProvider>
          </ScreenTheme>
        );
      });

      // 1. Open date modal
      const dupBtn = renderer!.root.findByProps({ accessibilityLabel: 'Duplicate entry on 2026-08-26' });
      await ReactTestRenderer.act(async () => {
        dupBtn.props.onPress();
      });

      // 2. Cancel in modal
      const cancelBtn = renderer!.root.findByProps({ accessibilityLabel: 'Cancel duplicate' });
      await ReactTestRenderer.act(async () => {
        cancelBtn.props.onPress();
      });

      expect(mockDuplicate).not.toHaveBeenCalled();
    });

    it('cancelling bulk duplicate performs no network requests', async () => {
      const mockBatchDuplicate = jest.fn();

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
          listTimesheets: jest.fn().mockResolvedValue({
            rows: [
              {
                id: 't1',
                user_id: 'u1',
                project_id: 'p1',
                project_name: 'Project Alpha',
                activity_type_id: 'a1',
                log_date: '2026-08-26',
                hours_worked: 8,
                work_done: 'Task 1',
              },
            ],
            total: 1,
          }),
          duplicateTimesheets: mockBatchDuplicate,
          getDashboard: jest.fn().mockResolvedValue({}),
        } as unknown as ApiClient;
      });

      const store = new MemoryTokenStore();
      await store.write({ refreshToken: 'initial-refresh', sessionId: 's1' });
      let renderer: ReactTestRenderer.ReactTestRenderer;

      await ReactTestRenderer.act(async () => {
        renderer = ReactTestRenderer.create(
          <ScreenTheme>
          <SessionProvider initialServerUrl="https://timesheet.example.com" tokenStore={store}>
            <TimesheetListScreen
              isDarkMode={false}
              onBack={jest.fn()}
              onLogTime={jest.fn()}
            />
          </SessionProvider>
          </ScreenTheme>
        );
      });

      // 1. Enter select mode & select all
      const selectBtn = renderer!.root.findByProps({ accessibilityLabel: 'Select multiple entries' });
      await ReactTestRenderer.act(async () => {
        selectBtn.props.onPress();
      });
      const selectAllBtn = renderer!.root.findByProps({ accessibilityLabel: 'Select all' });
      await ReactTestRenderer.act(async () => {
        selectAllBtn.props.onPress();
      });

      // 2. Click duplicate in toolbar
      const copyBtn = renderer!.root.findByProps({ accessibilityLabel: 'Duplicate 1 selected entry' });
      await ReactTestRenderer.act(async () => {
        copyBtn.props.onPress();
      });

      // 3. Cancel date dialog
      const cancelBtn = renderer!.root.findByProps({ accessibilityLabel: 'Cancel duplicate' });
      await ReactTestRenderer.act(async () => {
        cancelBtn.props.onPress();
      });

      expect(mockBatchDuplicate).not.toHaveBeenCalled();
    });
  });
});
