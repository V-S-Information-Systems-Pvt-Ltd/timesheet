import React from 'react';
import { Animated, FlatList, Platform, ScrollView, StyleSheet, Text, useWindowDimensions } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { modalBounds } from '../src/utils/modal-layout';
import { DateChooserModal } from '../src/components/DateChooserModal';
import { SearchablePickerModal } from '../src/components/SearchablePickerModal';
import { PressableScale } from '../src/components/PressableScale';
import { getPalette } from '../src/theme';

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
      renderer = ReactTestRenderer.create(<DateChooserModal visible title="Duplicate Timesheet" palette={palette} onCancel={jest.fn()} onConfirm={onConfirm} />);
    });
    const confirm = renderer!.root.findByProps({ accessibilityLabel: 'Confirm duplicate' });
    expect(StyleSheet.flatten(confirm.props.style)).toMatchObject({ flex: 0, width: '100%', minHeight: 44 });
    expect(renderer!.root.findByType(ScrollView).props.keyboardShouldPersistTaps).toBe('handled');
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
      );
    });

    const bounded = renderer!.root.findAll(
      (node) => StyleSheet.flatten(node.props.style)?.width === 480
    );
    expect(bounded.length).toBeGreaterThan(0);
    expect(StyleSheet.flatten(bounded[0].props.style)).toMatchObject({ flex: 0, width: 480, height: 340 });

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
