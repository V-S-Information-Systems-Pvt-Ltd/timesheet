import React from 'react';
import { Modal, Platform, Text } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { DateChooserModal } from '../src/components/DateChooserModal';
import { WindowsModal, WindowsModalHost } from '../src/components/WindowsModalHost';
import { getPalette } from '../src/theme';

const palette = getPalette(false);

describe('Windows date dialog overlay', () => {
  const originalPlatform = Platform.OS;
  let renderer: ReactTestRenderer.ReactTestRenderer;

  beforeEach(() => {
    Platform.OS = 'windows';
    jest.clearAllMocks();
  });
  afterEach(async () => {
    await ReactTestRenderer.act(async () => { renderer?.unmount(); });
    Platform.OS = originalPlatform;
  });

  it('updates the date, confirms it, closes and reopens without a native popup', async () => {
    const onConfirm = jest.fn();
    const props = { title: 'Duplicate Timesheet', palette, onConfirm, onCancel: jest.fn(), initialDate: '2026-09-29' };
    const render = (visible: boolean) => <WindowsModalHost><Text>App navigation</Text><DateChooserModal {...props} visible={visible} /></WindowsModalHost>;
    await ReactTestRenderer.act(async () => { renderer = ReactTestRenderer.create(render(true)); });
    expect(renderer.root.findAllByType(Modal)).toHaveLength(0);
    expect(renderer.root.findByProps({ testID: 'windows-modal-background' }).props.pointerEvents).toBe('none');
    await ReactTestRenderer.act(async () => {
      renderer.root.findByProps({ accessibilityLabel: 'Duplicate target date' }).props.onChangeText('2026-10-02');
    });
    await ReactTestRenderer.act(async () => {
      await renderer.root.findByProps({ accessibilityLabel: 'Confirm duplicate' }).props.onPress();
    });
    expect(onConfirm).toHaveBeenCalledWith('2026-10-02');
    await ReactTestRenderer.act(async () => { renderer.update(render(false)); });
    expect(renderer.root.findAllByProps({ testID: 'windows-modal-overlay' })).toHaveLength(0);
    expect(renderer.root.findByProps({ testID: 'windows-modal-background' }).props.pointerEvents).toBe('auto');
    await ReactTestRenderer.act(async () => { renderer.update(render(true)); });
    expect(renderer.root.findByProps({ accessibilityLabel: 'Duplicate target date' }).props.value).toBe('2026-09-29');
  });

  it('redirects background focus, handles Escape, and refuses cancellation while duplicating', async () => {
    const onCancel = jest.fn();
    const render = (isLoading: boolean) => (
      <WindowsModalHost>
        <DateChooserModal visible title="Duplicate Timesheet" palette={palette} onConfirm={jest.fn()} onCancel={onCancel} isLoading={isLoading} />
      </WindowsModalHost>
    );
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(render(false));
    });
    const focus = renderer.root.findByProps({ testID: 'windows-modal-overlay' }).instance.focus as jest.Mock;
    expect(focus).toHaveBeenCalled();
    focus.mockClear();
    renderer.root.findByProps({ testID: 'windows-modal-background' }).props.onFocus();
    expect(focus).toHaveBeenCalledTimes(1);
    expect(renderer.root.findByProps({ testID: 'windows-modal-background' }).props.importantForAccessibility).toBe('no-hide-descendants');
    const event = { nativeEvent: { key: 'Escape' }, stopPropagation: jest.fn() };
    await ReactTestRenderer.act(async () => {
      renderer.root.findByProps({ testID: 'windows-modal-overlay' }).props.onKeyDownCapture(event);
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(event.stopPropagation).toHaveBeenCalledTimes(1);
    await ReactTestRenderer.act(async () => { renderer.update(render(true)); });
    await ReactTestRenderer.act(async () => {
      renderer.root.findByProps({ testID: 'windows-modal-overlay' }).props.onKeyDownCapture(event);
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(renderer.root.findAllByProps({ accessibilityLabel: 'Close date chooser' })).toHaveLength(0);
    expect(renderer.root.findByProps({ accessibilityLabel: 'Confirm duplicate' }).props.disabled).toBe(true);
    expect(renderer.root.findByProps({ accessibilityLabel: 'Cancel duplicate' }).props.disabled).toBe(true);
  });

  it('removes only the unmounted owner and clears the overlay when the screen leaves', async () => {
    const render = (first: boolean, second: boolean) => (
      <WindowsModalHost>
        {first ? <WindowsModal key="first" visible><Text>First dialog</Text></WindowsModal> : null}
        {second ? <WindowsModal key="second" visible><Text>Second dialog</Text></WindowsModal> : null}
      </WindowsModalHost>
    );
    await ReactTestRenderer.act(async () => { renderer = ReactTestRenderer.create(render(true, true)); });
    expect(JSON.stringify(renderer.toJSON())).toContain('Second dialog');
    await ReactTestRenderer.act(async () => { renderer.update(render(false, true)); });
    expect(JSON.stringify(renderer.toJSON())).toContain('Second dialog');
    await ReactTestRenderer.act(async () => { renderer.update(render(false, false)); });
    expect(renderer.root.findAllByProps({ testID: 'windows-modal-overlay' })).toHaveLength(0);
    expect(renderer.root.findByProps({ testID: 'windows-modal-background' }).props.onFocus).toBeUndefined();
  });

  it('allows a closed chooser to remain mounted without registering an overlay', async () => {
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <DateChooserModal visible={false} title="Duplicate Timesheet" palette={palette} onConfirm={jest.fn()} onCancel={jest.fn()} />
      );
    });
    expect(renderer.toJSON()).toBeNull();
  });

  it.each(['android', 'ios'] as const)('keeps the native date modal on %s', async (platform) => {
    Platform.OS = platform;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <WindowsModalHost><DateChooserModal visible title="Duplicate Timesheet" palette={palette} onConfirm={jest.fn()} onCancel={jest.fn()} /></WindowsModalHost>
      );
    });
    expect(renderer.root.findByType(Modal).props.transparent).toBe(true);
    expect(renderer.root.findAllByProps({ testID: 'windows-modal-overlay' })).toHaveLength(0);
  });
});
