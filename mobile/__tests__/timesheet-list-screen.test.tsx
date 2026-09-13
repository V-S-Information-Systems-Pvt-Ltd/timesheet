import React from 'react';
import { Platform, Text } from 'react-native';
import { ScreenTheme } from '../test-utils/theme-fixture';
import ReactTestRenderer from 'react-test-renderer';
import { TimesheetListScreen } from '../src/screens/TimesheetListScreen';
import { ScreenHeader } from '../src/components/ScreenHeader';
import { SessionProvider } from '../src/auth/SessionProvider';
import { MemoryTokenStore } from '../test-utils/memory-token-store';
import { ApiClient } from '../src/api/client';

jest.mock('../src/api/client');
// Full-screen mount with fake timers is slow on Windows filesystems (the first
// test exceeded the 5s default under WSL), so allow the same headroom the other
// screen suites use.
jest.setTimeout(30000);

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
        <ScreenTheme>
        <SessionProvider initialServerUrl="https://timesheet.example.com" tokenStore={store}>
          <TimesheetListScreen
            isDarkMode={false}
            onBack={onBack}
            onLogTime={onLogTime}
          />
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
        <ScreenTheme>
        <SessionProvider initialServerUrl="https://timesheet.example.com" tokenStore={store}>
          <TimesheetListScreen
            isDarkMode={false}
            onBack={jest.fn()}
            onEditTime={onEditTime}
            onLogTime={jest.fn()}
          />
        </SessionProvider>
        </ScreenTheme>
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
    expect(mockDuplicate).toHaveBeenCalledWith(
      'access-123',
      't1',
      '2026-08-26',
      expect.objectContaining({ idempotencyKey: expect.any(String) })
    );
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
      ],
      expect.objectContaining({ idempotencyKey: expect.any(String) })
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

  const singleEntry = {
    id: 't1',
    user_id: 'u1',
    project_id: 'p1',
    project_name: 'Project Alpha',
    activity_type_id: 'a1',
    activity_name: 'Development',
    log_date: '2026-08-26',
    hours_worked: 8,
    work_done: 'Daily standup and feature coding',
  };

  function mockSession(listTimesheets: jest.Mock) {
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
        listTimesheets,
        getDashboard: jest.fn().mockResolvedValue({}),
      } as unknown as ApiClient;
    });
  }

  async function renderList() {
    const store = new MemoryTokenStore();
    await store.write({ refreshToken: 'initial-refresh', sessionId: 's1' });
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <ScreenTheme>
          <SessionProvider initialServerUrl="https://timesheet.example.com" tokenStore={store}>
            <TimesheetListScreen isDarkMode={false} onBack={jest.fn()} onLogTime={jest.fn()} />
          </SessionProvider>
        </ScreenTheme>
      );
    });

    return renderer!;
  }

  function visibleTexts(renderer: ReactTestRenderer.ReactTestRenderer): string[] {
    return renderer.root
      .findAllByType(Text)
      .map((node) => node.props.children)
      .filter((child): child is string => typeof child === 'string');
  }

  it('uses the singular noun for a single logged entry', async () => {
    mockSession(jest.fn().mockResolvedValue({ rows: [singleEntry], total: 1 }));
    const renderer = await renderList();

    expect(renderer.root.findByType(ScreenHeader).props.subtitle).toBe('1 entry logged');
  });

  it('uses the plural noun for multiple logged entries', async () => {
    mockSession(
      jest.fn().mockResolvedValue({ rows: [singleEntry, { ...singleEntry, id: 't2' }], total: 2 })
    );
    const renderer = await renderList();

    expect(renderer.root.findByType(ScreenHeader).props.subtitle).toBe('2 entries logged');
  });

  it('shows the empty state only after a successful, genuinely empty load', async () => {
    mockSession(jest.fn().mockResolvedValue({ rows: [], total: 0 }));
    const renderer = await renderList();

    expect(visibleTexts(renderer)).toContain('No timesheet entries found.');
    expect(renderer.root.findAllByProps({ accessibilityLabel: 'Retry loading timesheets' })).toHaveLength(0);
  });

  it('shows a retryable error instead of the empty state when the load fails', async () => {
    const mockList = jest.fn().mockRejectedValue(new TypeError('Network request failed'));
    mockSession(mockList);
    const renderer = await renderList();

    // Regression: a failed read used to resolve as an empty page, so the screen
    // claimed there were no entries while the list actually still had them.
    expect(visibleTexts(renderer)).not.toContain('No timesheet entries found.');
    expect(visibleTexts(renderer)).toContain('Could not load timesheets');
    expect(visibleTexts(renderer)).toContain(
      'You appear to be offline. Check your connection and try again.'
    );

    const retry = renderer.root.findByProps({ accessibilityLabel: 'Retry loading timesheets' });
    mockList.mockResolvedValue({ rows: [singleEntry], total: 1 });
    await ReactTestRenderer.act(async () => {
      retry.props.onPress();
    });

    expect(renderer.root.findByType(ScreenHeader).props.subtitle).toBe('1 entry logged');
    expect(renderer.root.findAllByProps({ accessibilityLabel: 'Retry loading timesheets' })).toHaveLength(0);
  });

  it('offers a refresh action on Windows that refetches the list', async () => {
    const originalOs = Platform.OS;
    Object.defineProperty(Platform, 'OS', { value: 'windows', configurable: true });
    try {
      const mockList = jest.fn().mockResolvedValue({ rows: [singleEntry], total: 1 });
      mockSession(mockList);
      const renderer = await renderList();

      const refresh = renderer.root.findByProps({ accessibilityLabel: 'Refresh timesheets' });
      const callsBefore = mockList.mock.calls.length;
      await ReactTestRenderer.act(async () => {
        refresh.props.onPress();
      });

      expect(mockList.mock.calls.length).toBeGreaterThan(callsBefore);
    } finally {
      Object.defineProperty(Platform, 'OS', { value: originalOs, configurable: true });
    }
  });

  it('does not expose raw server payloads when an API error fails the load', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { ApiClientError } = require('../src/api/client');
    const mockList = jest.fn().mockRejectedValue(
      new ApiClientError('Unexpected token < in JSON at position 0', 502)
    );
    mockSession(mockList);
    const renderer = await renderList();

    expect(visibleTexts(renderer)).not.toContain('Unexpected token < in JSON at position 0');
    expect(visibleTexts(renderer)).toContain('Could not load timesheets. Please try again.');
  });

  it('does not fire duplicate page loads while one is already in flight', async () => {
    let releaseFirst: (value: { rows: typeof singleEntry[]; total: number }) => void = () => {};
    const firstCall = new Promise<{ rows: typeof singleEntry[]; total: number }>((resolve) => {
      releaseFirst = resolve;
    });
    const mockList = jest
      .fn()
      .mockImplementationOnce(() => firstCall)
      .mockResolvedValue({ rows: [singleEntry], total: 1 });
    mockSession(mockList);
    const renderer = await renderList();

    // Regression: boot settles actor/token/serverUrl one after another, each
    // recreating listTimesheets and therefore fetchEntries. The initial-load
    // effect re-ran on every identity change and issued a fresh request for each
    // one (2-4 duplicate page loads were observed) while the first was still in
    // flight. The in-flight guard must collapse that burst into a single load.
    expect(mockList).toHaveBeenCalledTimes(1);

    await ReactTestRenderer.act(async () => {
      releaseFirst({ rows: [singleEntry], total: 1 });
    });

    expect(renderer.root.findByType(ScreenHeader).props.subtitle).toBe('1 entry logged');
  });

  it('uses the newest filter response when the previous filter request is still pending', async () => {
    let releaseAll: (value: { rows: typeof singleEntry[]; total: number }) => void = () => {};
    const allResponse = new Promise<{ rows: typeof singleEntry[]; total: number }>((resolve) => {
      releaseAll = resolve;
    });
    const recentEntry = { ...singleEntry, id: 'recent', work_done: 'Recent filtered entry' };
    const mockList = jest
      .fn()
      .mockImplementationOnce(() => allResponse)
      .mockResolvedValueOnce({ rows: [recentEntry], total: 1 });
    mockSession(mockList);
    const renderer = await renderList();

    const pastSevenDays = renderer.root.findByProps({ label: 'Past 7 Days' });
    await ReactTestRenderer.act(async () => {
      pastSevenDays.props.onPress();
    });
    expect(mockList).toHaveBeenCalledTimes(2);

    await ReactTestRenderer.act(async () => {
      releaseAll({ rows: [singleEntry], total: 1 });
    });

    expect(visibleTexts(renderer)).toContain('Recent filtered entry');
    expect(visibleTexts(renderer)).not.toContain(singleEntry.work_done);
  });

  it('clears superseded pagination state when the filter changes', async () => {
    const firstPage = Array.from({ length: 25 }, (_, index) => ({
      ...singleEntry,
      id: `initial-${index}`,
      work_done: `Initial entry ${index}`,
    }));
    let releasePage: (value: { rows: typeof firstPage; total: number }) => void = () => {};
    const pendingPage = new Promise<{ rows: typeof firstPage; total: number }>((resolve) => {
      releasePage = resolve;
    });
    const filteredEntry = { ...singleEntry, id: 'filtered-1', work_done: 'Filtered entry' };
    const filteredSecond = { ...singleEntry, id: 'filtered-2', work_done: 'Filtered second page' };
    const staleEntry = { ...singleEntry, id: 'stale-page', work_done: 'Stale page entry' };
    const mockList = jest.fn(
      (_token: string, params?: { from?: number; dateFrom?: string }) => {
        if (params?.from === 25) return pendingPage;
        if (params?.from === 1) return Promise.resolve({ rows: [filteredSecond], total: 2 });
        if (params?.dateFrom) return Promise.resolve({ rows: [filteredEntry], total: 2 });
        return Promise.resolve({ rows: firstPage, total: 50 });
      }
    );
    mockSession(mockList);
    const renderer = await renderList();

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const initialList = renderer.root.find((node) => typeof node.props.onEndReached === 'function');
      ReactTestRenderer.act(() => {
        initialList.props.onEndReached();
      });
      if (mockList.mock.calls.some(([, params]) => params?.from === 25)) break;
      await ReactTestRenderer.act(async () => {
        await Promise.resolve();
      });
    }
    expect(mockList).toHaveBeenCalledWith(
      'access-123',
      expect.objectContaining({ from: 25, to: 49, limit: 25 })
    );
    expect(visibleTexts(renderer)).toContain('Loading more entries...');

    const pastSevenDays = renderer.root.findByProps({ label: 'Past 7 Days' });
    await ReactTestRenderer.act(async () => {
      pastSevenDays.props.onPress();
    });

    expect(visibleTexts(renderer)).not.toContain('Loading more entries...');
    expect(visibleTexts(renderer)).toContain('Filtered entry');

    await ReactTestRenderer.act(async () => {
      releasePage({ rows: [staleEntry], total: 50 });
    });
    expect(visibleTexts(renderer)).not.toContain('Stale page entry');

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const filteredList = renderer.root.find((node) => typeof node.props.onEndReached === 'function');
      await ReactTestRenderer.act(async () => {
        await filteredList.props.onEndReached();
      });
      if (mockList.mock.calls.some(([, params]) => params?.from === 1)) break;
      await ReactTestRenderer.act(async () => {
        await Promise.resolve();
      });
    }
    expect(mockList).toHaveBeenLastCalledWith(
      'access-123',
      expect.objectContaining({ from: 1, to: 25, limit: 25 })
    );
  });
});
