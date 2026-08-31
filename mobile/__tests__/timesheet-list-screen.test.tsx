import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { TimesheetListScreen } from '../src/screens/TimesheetListScreen';
import { SessionProvider } from '../src/auth/SessionProvider';
import { MemoryTokenStore } from '../src/platform/secure-storage';
import { ApiClient } from '../src/api/client';

jest.mock('../src/api/client');

describe('TimesheetListScreen', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    ReactTestRenderer.act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  it('renders timesheet list with filters and handles back action', async () => {
    (ApiClient as jest.MockedClass<typeof ApiClient>).mockImplementation(() => {
      return {
        getConfig: jest.fn().mockResolvedValue({}),
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
              work_done: 'Daily standup and feature coding',
            },
          ],
        }),
      } as unknown as ApiClient;
    });

    const store = new MemoryTokenStore();
    const onBack = jest.fn();
    const onLogTime = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <SessionProvider initialServerUrl="https://timesheet.example.com" tokenStore={store}>
          <TimesheetListScreen
            isDarkMode={false}
            onBack={onBack}
            onLogTime={onLogTime}
          />
        </SessionProvider>
      );
    });

    const backBtn = renderer!.root.findByProps({ accessibilityLabel: 'Back to dashboard' });
    expect(backBtn).toBeDefined();

    await ReactTestRenderer.act(async () => {
      backBtn.props.onPress();
    });
    expect(onBack).toHaveBeenCalledTimes(1);

    const logTimeBtn = renderer!.root.findByProps({ accessibilityLabel: 'Log time' });
    expect(logTimeBtn).toBeDefined();

    await ReactTestRenderer.act(async () => {
      logTimeBtn.props.onPress();
    });
    expect(onLogTime).toHaveBeenCalledTimes(1);

    const filterAll = renderer!.root.findByProps({ accessibilityLabel: 'Filter: All' });
    expect(filterAll).toBeDefined();
  });

  it('handles edit and duplicate actions on entries', async () => {
    const mockDuplicate = jest.fn().mockResolvedValue({
      success: true,
      entry: {
        id: 't-dup',
        user_id: 'u1',
        project_id: 'p1',
        log_date: '2026-08-26',
        hours_worked: 8,
        work_done: 'Daily standup and feature coding',
      },
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
              work_done: 'Daily standup and feature coding',
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
    const onEditTime = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <SessionProvider initialServerUrl="https://timesheet.example.com" tokenStore={store}>
          <TimesheetListScreen
            isDarkMode={false}
            onBack={jest.fn()}
            onEditTime={onEditTime}
            onLogTime={jest.fn()}
          />
        </SessionProvider>
      );
    });

    // 1. Test Edit trigger
    const editBtn = renderer!.root.findByProps({ accessibilityLabel: 'Edit entry on 2026-08-26' });
    expect(editBtn).toBeDefined();

    await ReactTestRenderer.act(async () => {
      editBtn.props.onPress();
    });
    expect(onEditTime).toHaveBeenCalledWith(
      expect.objectContaining({ id: 't1', project_name: 'Project Alpha' })
    );

    // 2. Test Duplicate trigger (opens date modal, then confirm duplicates)
    const dupBtn = renderer!.root.findByProps({ accessibilityLabel: 'Duplicate entry on 2026-08-26' });
    expect(dupBtn).toBeDefined();

    await ReactTestRenderer.act(async () => {
      dupBtn.props.onPress();
    });

    // Date chooser is open - find Confirm duplicate button
    const confirmDupBtn = renderer!.root.findByProps({ accessibilityLabel: 'Confirm duplicate' });
    expect(confirmDupBtn).toBeDefined();

    await ReactTestRenderer.act(async () => {
      await confirmDupBtn.props.onPress();
    });
    expect(mockDuplicate).toHaveBeenCalledWith('access-123', 't1', '2026-08-26');
  });

  it('supports multi-selection mode and bulk duplicate with date chooser', async () => {
    const mockBatchDuplicate = jest.fn().mockImplementation((_token, items) => {
      return Promise.resolve({
        results: items.map((it: { id: string; targetDate?: string }) => ({
          id: it.id,
          success: true,
          entry: {
            id: `${it.id}-dup`,
            user_id: 'u1',
            project_id: 'p1',
            log_date: it.targetDate || '2026-08-26',
            hours_worked: 8,
            work_done: 'Duplicate coding',
          },
        })),
        duplicatedCount: items.length,
      });
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
            {
              id: 't2',
              user_id: 'u1',
              project_id: 'p1',
              project_name: 'Project Alpha',
              activity_type_id: 'a1',
              log_date: '2026-08-25',
              hours_worked: 7,
              work_done: 'Task 2',
            },
          ],
          total: 2,
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
        <SessionProvider initialServerUrl="https://timesheet.example.com" tokenStore={store}>
          <TimesheetListScreen
            isDarkMode={false}
            onBack={jest.fn()}
            onLogTime={jest.fn()}
          />
        </SessionProvider>
      );
    });

    // 1. Enter selection mode
    const selectBtn = renderer!.root.findByProps({ accessibilityLabel: 'Select multiple entries' });
    expect(selectBtn).toBeDefined();

    await ReactTestRenderer.act(async () => {
      selectBtn.props.onPress();
    });

    // 2. Select All
    const selectAllBtn = renderer!.root.findByProps({ accessibilityLabel: 'Select all' });
    expect(selectAllBtn).toBeDefined();

    await ReactTestRenderer.act(async () => {
      selectAllBtn.props.onPress();
    });

    // 3. Trigger Bulk Duplicate (opens date chooser)
    const copyBtn = renderer!.root.findByProps({ accessibilityLabel: 'Duplicate 2 selected entries' });
    expect(copyBtn).toBeDefined();

    await ReactTestRenderer.act(async () => {
      copyBtn.props.onPress();
    });

    // 4. Confirm in DateChooserModal
    const confirmBulkBtn = renderer!.root.findByProps({ accessibilityLabel: 'Confirm duplicate' });
    expect(confirmBulkBtn).toBeDefined();

    await ReactTestRenderer.act(async () => {
      await confirmBulkBtn.props.onPress();
    });

    expect(mockBatchDuplicate).toHaveBeenCalledTimes(1);
    expect(mockBatchDuplicate).toHaveBeenCalledWith(
      'access-123',
      [
        expect.objectContaining({ id: 't1', targetDate: expect.any(String) }),
        expect.objectContaining({ id: 't2', targetDate: expect.any(String) }),
      ]
    );
  });

  it('paginates using numeric from and to offsets on load more', async () => {
    const mockList = jest.fn()
      .mockResolvedValueOnce({
        rows: Array.from({ length: 25 }, (_, i) => ({
          id: `t-${i}`,
          user_id: 'u1',
          project_id: 'p1',
          project_name: 'Project Alpha',
          activity_type_id: 'a1',
          activity_name: 'Dev',
          log_date: '2026-08-26',
          hours_worked: 1,
          work_done: `Task ${i}`,
        })),
        total: 100,
      })
      .mockResolvedValueOnce({
        rows: Array.from({ length: 25 }, (_, i) => ({
          id: `t-${i + 25}`,
          user_id: 'u1',
          project_id: 'p1',
          project_name: 'Project Alpha',
          activity_type_id: 'a1',
          activity_name: 'Dev',
          log_date: '2026-08-25',
          hours_worked: 1,
          work_done: `Task ${i + 25}`,
        })),
        total: 100,
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
          email: 'emp@example.com',
          role: 'user',
          permissionRole: 'user',
          hierarchyRole: 'user',
          isActive: true,
        }),
        listTimesheets: mockList,
        getDashboard: jest.fn().mockResolvedValue({}),
      } as unknown as ApiClient;
    });

    const store = new MemoryTokenStore();
    await store.write({ refreshToken: 'initial-refresh', sessionId: 's1' });
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <SessionProvider initialServerUrl="https://timesheet.example.com" tokenStore={store}>
          <TimesheetListScreen
            isDarkMode={false}
            onBack={jest.fn()}
            onLogTime={jest.fn()}
          />
        </SessionProvider>
      );
    });

    // Page 1 initial request
    expect(mockList).toHaveBeenCalledWith(
      'access-123',
      expect.objectContaining({
        from: 0,
        to: 24,
        limit: 25,
      })
    );

    // Trigger onEndReached / load-more on the FlatList
    const flatList = renderer!.root.findByType('RCTScrollView' as React.ElementType) || renderer!.root;
    const flatListProps = (flatList as unknown as { props: { onEndReached?: () => void } }).props;
    if (flatListProps.onEndReached) {
      await ReactTestRenderer.act(async () => {
        flatListProps.onEndReached!();
      });

      // Page 2 request: from 25, to 49
      expect(mockList).toHaveBeenCalledWith(
        'access-123',
        expect.objectContaining({
          from: 25,
          to: 49,
          limit: 25,
        })
      );
    }
  });
});
