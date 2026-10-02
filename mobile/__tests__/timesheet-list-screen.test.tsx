import React from 'react';
import { Alert, Platform, Text } from 'react-native';
import { ScreenTheme } from '../test-utils/theme-fixture';
import ReactTestRenderer from 'react-test-renderer';
import { TimesheetListScreen } from '../src/screens/TimesheetListScreen';
import { ScreenHeader } from '../src/components/ScreenHeader';
import { SessionProvider } from '../src/auth/SessionProvider';
import { MemoryTokenStore } from '../test-utils/memory-token-store';
import { ApiClient } from '../src/api/client';
import { formatDatePreview } from '../src/utils/dates';

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

    // 1. Test Edit trigger (the label carries the readable date, not the ISO value)
    const editBtn = renderer!.root.findByProps({
      accessibilityLabel: `Edit entry on ${formatDatePreview('2026-08-26')}`,
    });
    expect(editBtn).toBeDefined();

    await ReactTestRenderer.act(async () => {
      editBtn.props.onPress();
    });
    expect(onEditTime).toHaveBeenCalledWith(
      expect.objectContaining({ id: 't1', project_name: 'Project Alpha' })
    );

    // 2. Test Duplicate trigger (opens date modal, then confirm duplicates)
    const dupBtn = renderer!.root.findByProps({
      accessibilityLabel: `Duplicate entry on ${formatDatePreview('2026-08-26')}`,
    });
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

  function mockSession(listTimesheets: jest.Mock, extra: Record<string, unknown> = {}) {
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
        ...extra,
      } as unknown as ApiClient;
    });
  }

  async function renderList(
    overrides: Partial<React.ComponentProps<typeof TimesheetListScreen>> = {}
  ) {
    const store = new MemoryTokenStore();
    await store.write({ refreshToken: 'initial-refresh', sessionId: 's1' });
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <ScreenTheme>
          <SessionProvider initialServerUrl="https://timesheet.example.com" tokenStore={store}>
            <TimesheetListScreen
              isDarkMode={false}
              onBack={jest.fn()}
              onLogTime={jest.fn()}
              {...overrides}
            />
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

  describe('day grouping, row actions, batch results and date range', () => {
    const cardLabel = (logDate: string, hours: number) =>
      `Entry on ${formatDatePreview(logDate)}, ${hours.toFixed(1)} hours, Project Alpha`;

    const dayHeaders = (renderer: ReactTestRenderer.ReactTestRenderer) =>
      renderer.root.findAll(
        (node) => node.props.accessibilityRole === 'header' && typeof node.type === 'string'
      );

    it('groups the loaded page by day and totals each day', async () => {
      const rows = [
        { ...singleEntry, id: 'd1-a', log_date: '2026-08-26', hours_worked: 8, work_done: 'First day A' },
        { ...singleEntry, id: 'd1-b', log_date: '2026-08-26', hours_worked: 1.5, work_done: 'First day B' },
        { ...singleEntry, id: 'd2-a', log_date: '2026-08-25', hours_worked: 4, work_done: 'Second day' },
      ];
      mockSession(jest.fn().mockResolvedValue({ rows, total: 3 }));
      const renderer = await renderList();

      // One header per day, computed from the rows already in memory.
      expect(dayHeaders(renderer)).toHaveLength(2);
      expect(visibleTexts(renderer)).toContain('9.5 hrs • 2 entries');
      expect(visibleTexts(renderer)).toContain('4 hrs');
      expect(visibleTexts(renderer)).toContain(formatDatePreview('2026-08-25'));

      // No extra request was issued to build the totals.
      expect(renderer.root.findByType(ScreenHeader).props.subtitle).toBe('3 entries logged');
    });

    it('opens the editor when the card body is tapped', async () => {
      mockSession(jest.fn().mockResolvedValue({ rows: [singleEntry], total: 1 }));
      const onEditTime = jest.fn();
      const renderer = await renderList({ onEditTime });

      const card = renderer.root.findAllByProps({
        accessibilityLabel: cardLabel('2026-08-26', 8),
      })[0];
      expect(card.props.accessibilityRole).toBe('button');
      // Selection is reachable without a long press, as a declared action.
      expect(card.props.accessibilityActions).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: 'select' })])
      );

      await ReactTestRenderer.act(async () => {
        card.props.onPress();
      });

      expect(onEditTime).toHaveBeenCalledWith(expect.objectContaining({ id: 't1' }));
    });

    it('long press enters selection mode and selects that entry', async () => {
      mockSession(jest.fn().mockResolvedValue({ rows: [singleEntry], total: 1 }));
      const renderer = await renderList();

      // The explicit Select button stays as the discoverable route.
      expect(
        renderer.root.findAllByProps({ accessibilityLabel: 'Select multiple entries' }).length
      ).toBeGreaterThan(0);
      expect(
        renderer.root.findAllByProps({ accessibilityLabel: 'Delete 1 selected entry' })
      ).toHaveLength(0);

      const card = renderer.root.findAllByProps({
        accessibilityLabel: cardLabel('2026-08-26', 8),
      })[0];
      await ReactTestRenderer.act(async () => {
        card.props.onLongPress();
      });

      // Selection mode is on with exactly this entry selected.
      expect(visibleTexts(renderer)).toContain('Deselect All');
      expect(
        renderer.root.findAllByProps({ accessibilityLabel: 'Delete 1 selected entry' }).length
      ).toBeGreaterThan(0);
    });

    it('summarizes a partial batch failure instead of dumping every reason', async () => {
      const rows = [0, 1, 2, 3].map((index) => ({
        ...singleEntry,
        id: `bulk-${index}`,
        work_done: `Bulk entry ${index}`,
      }));
      const reasons = ['Entry is locked', 'Entry not found', 'Permission denied'];
      const mockDelete = jest.fn().mockResolvedValue({
        deletedCount: 1,
        results: [
          { id: 'bulk-0', success: true },
          { id: 'bulk-1', success: false, error: reasons[0] },
          { id: 'bulk-2', success: false, error: reasons[1] },
          { id: 'bulk-3', success: false, error: reasons[2] },
        ],
      });
      mockSession(jest.fn().mockResolvedValue({ rows, total: 4 }), {
        deleteTimesheets: mockDelete,
      });

      // Drive the destructive confirmation the Alert would normally present.
      const alertSpy = jest
        .spyOn(Alert, 'alert')
        .mockImplementation((_title, _message, buttons) => {
          buttons?.find((button) => button.style === 'destructive')?.onPress?.();
        });

      try {
        const renderer = await renderList();

        await ReactTestRenderer.act(async () => {
          renderer.root
            .findAllByProps({ accessibilityLabel: 'Select multiple entries' })[0]
            .props.onPress();
        });
        await ReactTestRenderer.act(async () => {
          renderer.root.findAllByProps({ accessibilityLabel: 'Select all' })[0].props.onPress();
        });
        await ReactTestRenderer.act(async () => {
          await renderer.root
            .findAllByProps({ accessibilityLabel: 'Delete 4 selected entries' })[0]
            .props.onPress();
        });

        const texts = visibleTexts(renderer);
        expect(texts).toContain('Bulk delete finished with errors');
        expect(texts).toContain('1 of 4 entries deleted. 3 could not be deleted:');
        // The first reasons are shown, the rest stay behind the disclosure.
        expect(texts).toContain('• Entry is locked');
        expect(texts).toContain('• Entry not found');
        expect(texts).not.toContain('• Permission denied');
        expect(texts).not.toContain(reasons.join('\n'));

        await ReactTestRenderer.act(async () => {
          renderer.root
            .findAllByProps({ accessibilityLabel: 'Show all 3 failure reasons' })[0]
            .props.onPress();
        });
        expect(visibleTexts(renderer)).toContain('• Permission denied');
      } finally {
        alertSpy.mockRestore();
      }
    });

    it('confirms a single delete with a date the user can read', async () => {
      mockSession(jest.fn().mockResolvedValue({ rows: [singleEntry], total: 1 }));
      const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
      try {
        const renderer = await renderList();

        const deleteButton = renderer.root.findAllByProps({
          accessibilityLabel: `Delete entry on ${formatDatePreview(singleEntry.log_date)}`,
        })[0];
        await ReactTestRenderer.act(async () => {
          deleteButton.props.onPress();
        });

        const body = String(alertSpy.mock.calls[0]?.[1] ?? '');
        expect(body).toContain(formatDatePreview(singleEntry.log_date));
        expect(body).not.toContain(singleEntry.log_date);
      } finally {
        alertSpy.mockRestore();
      }
    });

    it('filters by an absolute range picked through the date chooser', async () => {
      const mockList = jest.fn().mockResolvedValue({ rows: [singleEntry], total: 1 });
      mockSession(mockList);
      const renderer = await renderList();

      await ReactTestRenderer.act(async () => {
        renderer.root
          .findAllByProps({ accessibilityLabel: 'Filter: Custom range' })[0]
          .props.onPress();
      });

      await ReactTestRenderer.act(async () => {
        renderer.root
          .findAllByProps({ accessibilityLabel: 'Range start date' })[0]
          .props.onChangeText('2026-08-01');
      });
      await ReactTestRenderer.act(async () => {
        await renderer.root
          .findAllByProps({ accessibilityLabel: 'Use range start date' })[0]
          .props.onPress();
      });

      await ReactTestRenderer.act(async () => {
        renderer.root
          .findAllByProps({ accessibilityLabel: 'Range end date' })[0]
          .props.onChangeText('2026-08-31');
      });
      await ReactTestRenderer.act(async () => {
        await renderer.root
          .findAllByProps({ accessibilityLabel: 'Use range end date' })[0]
          .props.onPress();
      });

      expect(mockList).toHaveBeenLastCalledWith(
        'access-123',
        expect.objectContaining({ dateFrom: '2026-08-01', dateTo: '2026-08-31' })
      );
      expect(visibleTexts(renderer)).toContain(
        `${formatDatePreview('2026-08-01')} – ${formatDatePreview('2026-08-31')}`
      );
    });
  });
});
