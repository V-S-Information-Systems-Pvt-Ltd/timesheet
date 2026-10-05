import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { getPalette } from '../src/theme';
import { ScreenHeader } from '../src/components/ScreenHeader';
import { LoadingState } from '../src/components/LoadingState';
import { Toast } from '../src/components/Toast';
import { EmptyState } from '../src/components/EmptyState';
import { PressableScale } from '../src/components/PressableScale';
import { MetricCard } from '../src/components/MetricCard';
import { TimesheetEntryCard } from '../src/components/TimesheetEntryCard';
import { FeatureHub } from '../src/components/FeatureHub';
import { Icon } from '../src/components/Icon';
import { BottomNavBar } from '../src/components/BottomNavBar';
import { formatDatePreview } from '../src/utils/dates';

type HitSlop = number | { top?: number; bottom?: number; left?: number; right?: number };

const slop = (hitSlop: HitSlop | undefined, axis: 'vertical' | 'horizontal') => {
  if (hitSlop === undefined) return 0;
  if (typeof hitSlop === 'number') return hitSlop * 2;
  return axis === 'vertical'
    ? (hitSlop.top ?? 0) + (hitSlop.bottom ?? 0)
    : (hitSlop.left ?? 0) + (hitSlop.right ?? 0);
};

/**
 * A control meets the touch minimum when its own box does, or when its hitSlop
 * closes the remaining gap without changing the visual size.
 */
function touchTarget(style: unknown, hitSlop?: HitSlop) {
  const flat = (StyleSheet.flatten(style as never) ?? {}) as Record<string, number | undefined>;
  return {
    height: (flat.minHeight ?? flat.height ?? 0) + slop(hitSlop, 'vertical'),
    width: (flat.minWidth ?? flat.width ?? 0) + slop(hitSlop, 'horizontal'),
  };
}

describe('Mobile UI Components', () => {
  const palette = getPalette(false);

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  test('ScreenHeader renders title, subtitle, and back action', async () => {
    const onBack = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <ScreenHeader
          title="Test Title"
          subtitle="Test Subtitle"
          onBack={onBack}
          palette={palette}
        />
      );
    });

    const backButton = renderer!.root.findByProps({ accessibilityLabel: 'Back to dashboard' });
    expect(backButton).toBeDefined();

    await ReactTestRenderer.act(async () => {
      backButton.props.onPress();
    });
    expect(onBack).toHaveBeenCalledTimes(1);

    expect(renderer!.root.findByProps({ children: 'Test Title' })).toBeDefined();
    expect(renderer!.root.findByProps({ children: 'Test Subtitle' })).toBeDefined();
  });

  test('LoadingState renders message', async () => {
    let renderer: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <LoadingState message="Custom loading text" palette={palette} />
      );
    });
    expect(renderer!.root.findByProps({ children: 'Custom loading text' })).toBeDefined();
  });

  test('EmptyState renders icon, message, and handles CTA action', async () => {
    const onAction = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <EmptyState
          icon="clock"
          message="Nothing to see here"
          actionLabel="Create Item"
          onAction={onAction}
          palette={palette}
        />
      );
    });

    expect(renderer!.root.findByProps({ children: 'Nothing to see here' })).toBeDefined();

    const actionBtn = renderer!.root.findByProps({ accessibilityLabel: 'Create Item' });
    await ReactTestRenderer.act(async () => {
      actionBtn.props.onPress();
    });
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  test('Toast renders when visible and auto-dismisses', async () => {
    const onDismiss = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <Toast
          message="Operation successful"
          type="success"
          visible={true}
          onDismiss={onDismiss}
          palette={palette}
        />
      );
    });

    expect(renderer!.root.findByProps({ children: 'Operation successful' })).toBeDefined();

    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(3500);
    });

    expect(onDismiss).toHaveBeenCalled();

    let hiddenRenderer: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      hiddenRenderer = ReactTestRenderer.create(
        <Toast
          message="Hidden"
          visible={false}
          onDismiss={onDismiss}
          palette={palette}
        />
      );
    });
    expect(hiddenRenderer!.toJSON()).toBeNull();
  });

  test('PressableScale wraps children and triggers onPress', async () => {
    const onPress = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <PressableScale accessibilityLabel="Press Me" onPress={onPress}>
          <Text>Click</Text>
        </PressableScale>
      );
    });

    const btn = renderer!.root.findByProps({ accessibilityLabel: 'Press Me' });
    await ReactTestRenderer.act(async () => {
      btn.props.onPress();
    });
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  test('MetricCard renders label, value, unit, and date', async () => {
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <MetricCard
          label="Total Hours"
          value="42.5"
          unit="hrs"
          dateLabel="This Month"
          isPrimary={true}
          palette={palette}
        />
      );
    });

    expect(renderer!.root.findByProps({ children: 'Total Hours' })).toBeDefined();
    expect(renderer!.root.findByProps({ children: 'This Month' })).toBeDefined();
  });

  test('TimesheetEntryCard renders project, activity, date, and work description', async () => {
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <TimesheetEntryCard
          entry={{
            id: 't-1',
            user_id: 'u-1',
            user_email: 'u@example.com',
            project_id: 'p-1',
            project_name: 'Project Omega',
            activity_type_id: 'a-1',
            activity_name: 'Architecture Review',
            log_date: '2026-08-27',
            hours_worked: 7.5,
            work_done: 'Refactored navigation and design system',
            created_at: '2026-08-27T10:00:00.000Z',
          }}
          palette={palette}
        />
      );
    });

    // The card shows the readable date, not the stored ISO value.
    const formattedDate = formatDatePreview('2026-08-27');
    expect(formattedDate).not.toBe('2026-08-27');
    expect(renderer!.root.findByProps({ children: formattedDate })).toBeDefined();
    expect(
      renderer!.root.findAllByProps({ children: '2026-08-27' })
    ).toHaveLength(0);
    expect(renderer!.root.findByProps({ children: 'Project Omega' })).toBeDefined();
    expect(renderer!.root.findByProps({ children: 'Legacy · Architecture Review' })).toBeDefined();
    expect(renderer!.root.findByProps({ children: 'Refactored navigation and design system' })).toBeDefined();
  });

  test('FeatureHub renders all items in grid with vector icons', async () => {
    const onReports = jest.fn();
    const onLeaves = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <FeatureHub
          items={[
            { key: 'reports', icon: 'reports', label: 'Reports', onPress: onReports, accessibilityLabel: 'View reports' },
            { key: 'leaves', icon: 'calendar', label: 'Leaves', onPress: onLeaves, accessibilityLabel: 'View leaves' },
          ]}
          palette={palette}
        />
      );
    });

    expect(renderer!.root.findByProps({ children: 'Reports' })).toBeDefined();
    expect(renderer!.root.findByProps({ children: 'Leaves' })).toBeDefined();

    const reportsBtn = renderer!.root.findByProps({ accessibilityLabel: 'View reports' });
    await ReactTestRenderer.act(async () => {
      reportsBtn.props.onPress();
    });
    expect(onReports).toHaveBeenCalledTimes(1);
  });

  test('Icon renders vector glyph with size and VSIS crimson color', async () => {
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(<Icon color="#E4282F" name="home" size={24} />);
    });

    expect(renderer!.root.findByProps({ accessibilityElementsHidden: true })).toBeDefined();
  });

  test('BottomNavBar renders tabs and handles navigation', async () => {
    const onNavigate = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <BottomNavBar
          activeScreen="dashboard"
          isDarkMode={false}
          onNavigate={onNavigate}
          palette={palette}
        />
      );
    });

    expect(renderer!.root.findByProps({ accessibilityLabel: 'Dashboard Tab' })).toBeDefined();
    expect(renderer!.root.findByProps({ accessibilityLabel: 'Timesheets Tab' })).toBeDefined();
    expect(renderer!.root.findByProps({ accessibilityLabel: 'Log Time Action Tab' })).toBeDefined();

    const timesheetsTab = renderer!.root.findByProps({ accessibilityLabel: 'Timesheets Tab' });
    await ReactTestRenderer.act(async () => {
      timesheetsTab.props.onPress();
    });
    expect(onNavigate).toHaveBeenCalledWith('timesheets');
  });

  test('BottomNavBar action tab meets the touch minimum', async () => {
    let renderer: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <BottomNavBar
          activeScreen="dashboard"
          isDarkMode={false}
          onNavigate={jest.fn()}
          palette={palette}
        />
      );
    });

    const actionTab = renderer!.root.findByProps({ accessibilityLabel: 'Log Time Action Tab' });
    const target = touchTarget(actionTab.props.style, actionTab.props.hitSlop);
    expect(target.height).toBeGreaterThanOrEqual(44);
    expect(target.width).toBeGreaterThanOrEqual(44);
  });

  test('entry card selection target reaches 44 without enlarging the 22px box', async () => {
    const logDate = '2026-08-27';
    let renderer: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <TimesheetEntryCard
          entry={{
            id: 't-1',
            user_id: 'u-1',
            project_id: 'p-1',
            project_name: 'Project Omega',
            activity_type_id: 'a-1',
            activity_name: 'Architecture Review',
            log_date: logDate,
            hours_worked: 7.5,
            work_done: 'Refactored navigation and design system',
            created_at: '2026-08-27T10:00:00.000Z',
          }}
          isSelectionMode
          onToggleSelect={jest.fn()}
          palette={palette}
        />
      );
    });

    const checkbox = renderer!.root.findByProps({
      accessibilityLabel: `Select entry on ${formatDatePreview(logDate)}`,
    });
    const target = touchTarget(checkbox.props.style, checkbox.props.hitSlop);
    expect(target.height).toBeGreaterThanOrEqual(44);
    expect(target.width).toBeGreaterThanOrEqual(44);
    // The visible box is unchanged: only the pressable around it grew.
    const box = checkbox.findAllByType(View).filter((node) => {
      const flat = StyleSheet.flatten(node.props.style) as Record<string, number> | undefined;
      return flat?.width === 22 && flat?.height === 22;
    });
    expect(box.length).toBeGreaterThan(0);
  });

  test('PressableScale signals a disabled control visually', async () => {
    let enabled: ReactTestRenderer.ReactTestRenderer;
    let disabled: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      enabled = ReactTestRenderer.create(
        <PressableScale accessibilityLabel="Enabled" onPress={jest.fn()} style={{ minHeight: 48 }}>
          <Text>Go</Text>
        </PressableScale>
      );
      disabled = ReactTestRenderer.create(
        <PressableScale
          accessibilityLabel="Disabled"
          disabled
          onPress={jest.fn()}
          style={{ minHeight: 48 }}
        >
          <Text>Go</Text>
        </PressableScale>
      );
    });

    const stylesFor = (renderer: ReactTestRenderer.ReactTestRenderer, label: string) =>
      renderer.root
        .findAllByProps({ accessibilityLabel: label })
        .map(
          (node) => (StyleSheet.flatten(node.props.style) ?? {}) as Record<string, unknown>
        );

    // One node is the PressableScale wrapper carrying only the caller's style;
    // the rendered control is the one that also carries the disabled treatment.
    const enabledStyles = stylesFor(enabled!, 'Enabled');
    const disabledStyles = stylesFor(disabled!, 'Disabled');

    expect(enabledStyles.every((style) => style.opacity === undefined)).toBe(true);
    expect(
      disabledStyles.some((style) => typeof style.opacity === 'number' && style.opacity < 1)
    ).toBe(true);
  });
});
