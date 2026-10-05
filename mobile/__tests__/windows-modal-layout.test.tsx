import React from 'react';
import { Animated, FlatList, Modal, Platform, ScrollView, StyleSheet, Text, useWindowDimensions } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { modalBounds } from '../src/utils/modal-layout';
import { DateChooserModal } from '../src/components/DateChooserModal';
import { SearchablePickerModal } from '../src/components/SearchablePickerModal';
import { PressableScale } from '../src/components/PressableScale';
import { getPalette } from '../src/theme';
import { WindowsModalHost } from '../src/components/WindowsModalHost';

jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native');
  return Object.defineProperty(Object.create(actual), 'useWindowDimensions', {
    value: jest.fn(() => ({ width: 1000, height: 700, scale: 1, fontScale: 1 })),
  });
});

const dimensions = useWindowDimensions as jest.Mock;
const palette = getPalette(false);

describe('Windows modal viewport and shared responsive controls', () => {
  const originalPlatform = Platform.OS;
  afterEach(() => {
    Platform.OS = originalPlatform;
    dimensions.mockReturnValue({ width: 1000, height: 700, scale: 1, fontScale: 1 });
  });

  it.each([[260, 300], [1366, 728], [1920, 1040]])('keeps dialog bounds inside a %i × %i viewport', (width, height) => {
    const bounds = modalBounds(width, height, 720, 700);
    expect(bounds.width).toBeLessThan(width);
    expect(bounds.height).toBeLessThan(height);
    expect(bounds.width).toBeLessThanOrEqual(720);
    expect(bounds.height).toBeLessThanOrEqual(700);
  });

  it('gives a long Windows picker a finite viewport and closes when selecting its final result', async () => {
    Platform.OS = 'windows';
    dimensions.mockReturnValue({ width: 800, height: 400, scale: 1, fontScale: 1 });
    const items = Array.from({ length: 100 }, (_, index) => ({ id: String(index), name: `Project ${index}` }));
    const onSelect = jest.fn();
    const onClose = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(<SearchablePickerModal visible title="Projects" items={items} selectedId="" onSelect={onSelect} onClose={onClose} palette={palette} />);
    });
    const list = renderer!.root.findByType(FlatList);
    expect(StyleSheet.flatten(list.props.style).flex).toBe(1);
    expect(list.props.data).toHaveLength(100);
    const modalRoot = renderer!.root.findAll((node) => StyleSheet.flatten(node.props.style)?.height === 340);
    expect(modalRoot.length).toBeGreaterThan(0);
    await ReactTestRenderer.act(async () => {
      renderer!.root.findByProps({ accessibilityLabel: 'Search...' }).props.onChangeText('Project 99');
    });
    await ReactTestRenderer.act(async () => {
      renderer!.root.findByProps({ accessibilityLabel: 'Project 99' }).props.onPress();
    });
    expect(onSelect).toHaveBeenCalledWith(items[99]);
    expect(onClose).toHaveBeenCalledTimes(1);
    await ReactTestRenderer.act(async () => renderer!.unmount());
  });

  it('stacks duplicate actions in a narrow window and retains scrolling and invalid-date refusal', async () => {
    Platform.OS = 'windows';
    dimensions.mockReturnValue({ width: 300, height: 380, scale: 1, fontScale: 1 });
    const onConfirm = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(<WindowsModalHost><DateChooserModal visible title="Duplicate Timesheet" palette={palette} onCancel={jest.fn()} onConfirm={onConfirm} /></WindowsModalHost>);
    });
    const confirm = renderer!.root.findByProps({ accessibilityLabel: 'Confirm duplicate' });
    expect(StyleSheet.flatten(confirm.props.style)).toMatchObject({ flex: 0, width: '100%', minHeight: 44 });
    expect(renderer!.root.findByType(ScrollView).props.keyboardShouldPersistTaps).toBe('handled');
    expect(renderer!.root.findAllByType(Modal)).toHaveLength(0);
    expect(StyleSheet.flatten(renderer!.root.findByProps({ testID: 'windows-modal-overlay' }).props.style)).toMatchObject({ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 });
    await ReactTestRenderer.act(async () => renderer!.root.findByProps({ accessibilityLabel: 'Duplicate target date' }).props.onChangeText('invalid'));
    expect(confirm.props.disabled).toBe(true);
    expect(onConfirm).not.toHaveBeenCalled();
    await ReactTestRenderer.act(async () => renderer!.unmount());
  });

  it('bounds the entry-date picker and renders its parameterized copy', async () => {
    Platform.OS = 'windows';
    dimensions.mockReturnValue({ width: 800, height: 400, scale: 1, fontScale: 1 });
    const onConfirm = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <WindowsModalHost>
          <DateChooserModal
            cancelAccessibilityLabel="Cancel date selection"
            confirmAccessibilityLabel="Use entry date"
            confirmLabel="Use This Date"
            dateInputLabel="Entry date"
            initialDate="2026-10-24"
            onCancel={jest.fn()}
            onConfirm={onConfirm}
            palette={palette}
            previewLabel="Logging for:"
            title="Entry date"
            visible
          />
        </WindowsModalHost>
      );
    });

    const bounded = renderer!.root.findAll(
      (node) => StyleSheet.flatten(node.props.style)?.width === 420
    );
    expect(bounded.length).toBeGreaterThan(0);
    expect(StyleSheet.flatten(bounded[0].props.style)).toMatchObject({ flex: 0, width: 420, height: 340 });

    const body = JSON.stringify(renderer!.toJSON());
    expect(body).toContain('Logging for:');
    expect(body).not.toContain('Duplicating to:');

    await ReactTestRenderer.act(async () => {
      renderer!.root.findByProps({ accessibilityLabel: 'Entry date' }).props.onChangeText('2026-10-26');
    });
    await ReactTestRenderer.act(async () => {
      renderer!.root.findByProps({ accessibilityLabel: 'Use entry date' }).props.onPress();
    });
    expect(onConfirm).toHaveBeenCalledWith('2026-10-26');
    await ReactTestRenderer.act(async () => renderer!.unmount());
  });

  it('adapts an open Windows dialog when the app window becomes narrow', async () => {
    Platform.OS = 'windows';
    const props = { visible: true, title: 'Duplicate Timesheet', palette, onCancel: jest.fn(), onConfirm: jest.fn() };
    let renderer: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(<WindowsModalHost><DateChooserModal {...props} /></WindowsModalHost>);
    });
    expect(StyleSheet.flatten(renderer!.root.findByProps({ accessibilityLabel: 'Confirm duplicate' }).props.style).flex).toBe(1.5);
    dimensions.mockReturnValue({ width: 420, height: 380, scale: 1, fontScale: 1 });
    await ReactTestRenderer.act(async () => {
      renderer!.update(<WindowsModalHost><DateChooserModal {...props} /></WindowsModalHost>);
    });
    expect(StyleSheet.flatten(renderer!.root.findByProps({ accessibilityLabel: 'Confirm duplicate' }).props.style)).toMatchObject({ flex: 0, width: '100%' });
    expect(renderer!.root.findAll((node) => StyleSheet.flatten(node.props.style)?.width === 378).length).toBeGreaterThan(0);
    expect(StyleSheet.flatten(renderer!.root.findByType(ScrollView).props.style).flex).toBe(1);
    await ReactTestRenderer.act(async () => renderer!.unmount());
  });

  it('keeps the Windows body expandable and follows host resizing when global dimensions stay stale', async () => {
    Platform.OS = 'windows';
    dimensions.mockReturnValue({ width: 1920, height: 1040, scale: 1, fontScale: 1 });
    const onConfirm = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <WindowsModalHost><DateChooserModal visible title="Duplicate Timesheet" initialDate="2026-10-03" palette={palette} onCancel={jest.fn()} onConfirm={onConfirm} /></WindowsModalHost>
      );
    });
    try {
      // Yoga prioritizes explicit flexGrow over flex; flex: 1 alone must not
      // inherit the mobile body's flexGrow: 0 and collapse to zero height.
      expect(StyleSheet.flatten(renderer!.root.findByType(ScrollView).props.style)).toMatchObject({ flexGrow: 1, flexShrink: 1 });
      const resize = async (width: number, height: number) => {
        await ReactTestRenderer.act(async () => {
          renderer!.root.findByProps({ testID: 'date-chooser-backdrop' }).props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width, height } } });
        });
      };
      await ReactTestRenderer.act(async () => {
        renderer!.root.findByProps({ accessibilityLabel: 'Duplicate target date' }).props.onChangeText('2026-10-02');
      });
      await resize(300, 380);
      expect(renderer!.root.findAll((node) => {
        const style = StyleSheet.flatten(node.props.style);
        return style?.width === 270 && style.height === 323;
      }).length).toBeGreaterThan(0);
      expect(StyleSheet.flatten(renderer!.root.findByProps({ accessibilityLabel: 'Confirm duplicate' }).props.style)).toMatchObject({ flex: 0, width: '100%' });
      expect(renderer!.root.findByProps({ accessibilityLabel: 'Duplicate target date' }).props.value).toBe('2026-10-02');
      await resize(0, 0);
      expect(StyleSheet.flatten(renderer!.root.findByProps({ accessibilityLabel: 'Confirm duplicate' }).props.style).flex).toBe(0);
      await resize(800, 600);
      expect(StyleSheet.flatten(renderer!.root.findByProps({ accessibilityLabel: 'Confirm duplicate' }).props.style).flex).toBe(1.5);
      await ReactTestRenderer.act(async () => {
        renderer!.root.findByProps({ accessibilityLabel: 'Duplicate target date' }).props.onChangeText('invalid');
      });
      expect(renderer!.root.findByProps({ accessibilityLabel: 'Confirm duplicate' }).props.disabled).toBe(true);
      expect(onConfirm).not.toHaveBeenCalled();
      await ReactTestRenderer.act(async () => {
        renderer!.root.findByProps({ accessibilityLabel: 'Choose yesterday' }).props.onPress();
      });
      await ReactTestRenderer.act(async () => {
        await renderer!.root.findByProps({ accessibilityLabel: 'Confirm duplicate' }).props.onPress();
      });
      expect(onConfirm).toHaveBeenCalledTimes(1);
      expect(onConfirm).toHaveBeenCalledWith(renderer!.root.findByProps({ accessibilityLabel: 'Duplicate target date' }).props.value);
    } finally {
      await ReactTestRenderer.act(async () => renderer!.unmount());
    }
  });

  it('preserves the row layout inside animated pressables', async () => {
    let renderer: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(<PressableScale style={{ flexDirection: 'row', gap: 8, justifyContent: 'space-between' }}><Text>Icon</Text><Text>Label</Text></PressableScale>);
    });
    const content = renderer!.root.findByType(Animated.View);
    expect(StyleSheet.flatten(content.props.style)).toMatchObject({ flexDirection: 'row', gap: 8, justifyContent: 'space-between' });
    await ReactTestRenderer.act(async () => renderer!.unmount());
  });
});
