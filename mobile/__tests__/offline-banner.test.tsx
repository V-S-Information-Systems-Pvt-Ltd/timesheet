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
});
