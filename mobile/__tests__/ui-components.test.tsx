import React from 'react';
import { Text } from 'react-native';
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
          icon="✨"
          message="Nothing to see here"
          actionLabel="Create Item"
          onAction={onAction}
          palette={palette}
        />
      );
    });

    expect(renderer!.root.findByProps({ children: '✨' })).toBeDefined();
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

  test('TimesheetEntryCard renders project, activity, and status tags', async () => {
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
            log_date: '2026-08-27',
            hours_worked: 7.5,
            work_done: 'Refactored navigation and design system',
            status: 'approved',
          }}
          palette={palette}
        />
      );
    });

    expect(renderer!.root.findByProps({ children: '2026-08-27' })).toBeDefined();
    expect(renderer!.root.findByProps({ children: 'APPROVED' })).toBeDefined();
    expect(renderer!.root.findByProps({ children: 'Project Omega' })).toBeDefined();
    expect(renderer!.root.findByProps({ children: 'Architecture Review' })).toBeDefined();
  });

  test('FeatureHub renders all items in grid', async () => {
    const onReports = jest.fn();
    const onLeaves = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <FeatureHub
          items={[
            { key: 'reports', icon: '📊', label: 'Reports', onPress: onReports, accessibilityLabel: 'View reports' },
            { key: 'leaves', icon: '🌴', label: 'Leaves', onPress: onLeaves, accessibilityLabel: 'View leaves' },
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

  test('Icon renders glyph with size and color', async () => {
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(<Icon color="#2457D6" name="home" size={24} />);
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
});
