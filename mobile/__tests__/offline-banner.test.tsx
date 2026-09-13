import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { OfflineBanner } from '../src/components/OfflineBanner';
import { getPalette } from '../src/theme';

describe('OfflineBanner', () => {
  const palette = getPalette(false);

  it('renders null when online and queue is empty', async () => {
    let renderer: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <OfflineBanner
          isOffline={false}
          isSyncing={false}
          onSync={jest.fn()}
          palette={palette}
          pendingCount={0}
        />
      );
    });
    expect(renderer!.toJSON()).toBeNull();
  });

  it('renders offline message when isOffline is true', async () => {
    let renderer: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <OfflineBanner
          isOffline={true}
          isSyncing={false}
          onSync={jest.fn()}
          palette={palette}
          pendingCount={3}
        />
      );
    });
    const alert = renderer!.root.findByProps({ accessibilityRole: 'alert' });
    expect(alert).toBeDefined();
  });

  it('renders pending count and triggers onSync when clicked', async () => {
    const onSync = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <OfflineBanner
          isOffline={false}
          isSyncing={false}
          onSync={onSync}
          palette={palette}
          pendingCount={2}
        />
      );
    });
    const syncBtn = renderer!.root.findByProps({ accessibilityLabel: 'Sync pending changes now' });
    expect(syncBtn).toBeDefined();

    await ReactTestRenderer.act(async () => {
      syncBtn.props.onPress();
    });

    expect(onSync).toHaveBeenCalledTimes(1);
  });

  it('renders failed items with error message and triggers retry and discard actions', async () => {
    const onRetryItem = jest.fn();
    const onDiscardItem = jest.fn();

    const failedItems = [
      {
        id: 'mut-123',
        type: 'create_timesheet' as const,
        payload: {
          input: {
            projectId: 'p1',
            activityTypeId: 'act-1',
            logDate: '2026-09-01',
            hoursWorked: 8,
            workDone: 'Testing',
          },
        },
        createdAt: '2026-09-01T10:00:00Z',
        retryCount: 1,
        status: 'failed' as const,
        lastError: 'Daily total would exceed 24 hours',
      },
    ];

    let renderer: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <OfflineBanner
          isOffline={false}
          isSyncing={false}
          onSync={jest.fn()}
          palette={palette}
          pendingCount={0}
          failedCount={1}
          failedItems={failedItems}
          onRetryItem={onRetryItem}
          onDiscardItem={onDiscardItem}
        />
      );
    });

    const alert = renderer!.root.findByProps({ accessibilityRole: 'alert' });
    expect(alert).toBeDefined();

    const retryBtn = renderer!.root.findByProps({ accessibilityLabel: 'Retry create_timesheet' });
    expect(retryBtn).toBeDefined();

    const discardBtn = renderer!.root.findByProps({ accessibilityLabel: 'Discard create_timesheet' });
    expect(discardBtn).toBeDefined();

    await ReactTestRenderer.act(async () => {
      retryBtn.props.onPress();
    });
    expect(onRetryItem).toHaveBeenCalledWith('mut-123');

    await ReactTestRenderer.act(async () => {
      discardBtn.props.onPress();
    });
    expect(onDiscardItem).toHaveBeenCalledWith('mut-123');
  });

  it('renders discard only and hides retry for committed_unknown items', async () => {
    const onRetryItem = jest.fn();
    const onDiscardItem = jest.fn();
    const failedItems = [
      {
        id: 'mut-unknown',
        type: 'create_timesheet' as const,
        payload: {
          input: {
            projectId: 'p1',
            activityTypeId: 'act-1',
            logDate: '2026-09-01',
            hoursWorked: 8,
            workDone: 'Testing',
          },
        },
        createdAt: '2026-09-01T10:00:00Z',
        retryCount: 1,
        status: 'manual_review' as const,
        lastError: 'already completed — refresh and review',
      },
    ];

    let renderer: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <OfflineBanner
          isOffline={false}
          isSyncing={false}
          onSync={jest.fn()}
          palette={palette}
          pendingCount={0}
          failedCount={1}
          failedItems={failedItems}
          onRetryItem={onRetryItem}
          onDiscardItem={onDiscardItem}
        />
      );
    });

    const discardBtn = renderer!.root.findByProps({ accessibilityLabel: 'Discard create_timesheet' });
    expect(discardBtn).toBeDefined();

    const retryBtns = renderer!.root.findAllByProps({ accessibilityLabel: 'Retry create_timesheet' });
    expect(retryBtns.length).toBe(0);
  });
});
