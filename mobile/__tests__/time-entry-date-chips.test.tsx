import React from 'react';
import { StyleSheet, Text } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { ScreenTheme } from '../test-utils/theme-fixture';
import { LogTimeScreen } from '../src/screens/LogTimeScreen';
import { SessionProvider } from '../src/auth/SessionProvider';
import { MemoryTokenStore } from '../test-utils/memory-token-store';
import { ApiClient } from '../src/api/client';
import { getPalette, type Palette } from '../src/theme';

jest.mock('../src/api/client');
jest.setTimeout(15000);

/**
 * Regression guard for the quick-date chips: their label switches to
 * `palette.onPrimary` when selected, so the chip itself must switch to
 * `palette.primary`. It previously stayed on `palette.card`, which is #FFFFFF
 * in light mode — the same color as the label, i.e. 1:1 contrast.
 */

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  return [
    parseInt(clean.substring(0, 2), 16),
    parseInt(clean.substring(2, 4), 16),
    parseInt(clean.substring(4, 6), 16),
  ];
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(hex1: string, hex2: string): number {
  const l1 = relativeLuminance(hex1);
  const l2 = relativeLuminance(hex2);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

function styleColor(style: unknown, key: 'backgroundColor' | 'color'): string {
  const flat = StyleSheet.flatten(style as never) as Record<string, unknown> | undefined;
  return String(flat?.[key] ?? '');
}

async function mountLogTime(mode: 'light' | 'dark') {
  (ApiClient as jest.MockedClass<typeof ApiClient>).mockImplementation(
    () =>
      ({
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
        getReference: jest.fn().mockResolvedValue({
          projects: [{ id: 'p-internal', name: 'Internal' }],
          activityTypes: [{ id: 'a1', name: 'Development' }],
        }),
        getDashboard: jest.fn().mockResolvedValue({}),
        createTimesheet: jest.fn().mockResolvedValue({ success: true }),
      } as unknown as ApiClient)
  );

  const store = new MemoryTokenStore();
  await store.write({ refreshToken: 'initial-refresh', sessionId: 's1' });
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <ScreenTheme mode={mode}>
        <SessionProvider initialServerUrl="https://timesheet.example.com" tokenStore={store}>
          <LogTimeScreen isDarkMode={mode === 'dark'} onBack={jest.fn()} onSuccess={jest.fn()} />
        </SessionProvider>
      </ScreenTheme>
    );
  });
  return renderer;
}

function readChip(renderer: ReactTestRenderer.ReactTestRenderer, label: string) {
  const chip = renderer.root.findAllByProps({ accessibilityLabel: label })[0];
  const text = chip.findAllByType(Text)[0];
  return {
    background: styleColor(chip.props.style, 'backgroundColor'),
    text: styleColor(text.props.style, 'color'),
  };
}

/** Resolved touch height, including any hitSlop that closes the gap. */
function touchHeight(renderer: ReactTestRenderer.ReactTestRenderer, label: string) {
  const node = renderer.root.findAllByProps({ accessibilityLabel: label })[0];
  const flat = (StyleSheet.flatten(node.props.style as never) ?? {}) as Record<string, number>;
  const hitSlop = node.props.hitSlop as number | { top?: number; bottom?: number } | undefined;
  const extra =
    typeof hitSlop === 'number' ? hitSlop * 2 : (hitSlop?.top ?? 0) + (hitSlop?.bottom ?? 0);
  return (flat.minHeight ?? flat.height ?? 0) + extra;
}

describe.each<['light' | 'dark', Palette]>([
  ['light', getPalette(false)],
  ['dark', getPalette(true)],
])('%s mode quick-date chips', (mode, palette) => {
  it('paints the selected chip with the primary surface behind its onPrimary label', async () => {
    const renderer = await mountLogTime(mode);
    const selected = readChip(renderer, 'Set to today');

    expect(selected.background).toBe(palette.primary);
    expect(selected.text).toBe(palette.onPrimary);
    expect(selected.background).not.toBe(selected.text);
    expect(contrastRatio(selected.background, selected.text)).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps the unselected chip label readable on its own surface', async () => {
    const renderer = await mountLogTime(mode);

    await ReactTestRenderer.act(async () => {
      renderer.root
        .findAllByProps({ accessibilityLabel: 'Set to yesterday' })[0]
        .props.onPress();
    });

    const unselected = readChip(renderer, 'Set to today');
    expect(unselected.background).toBe(palette.card);
    expect(unselected.text).toBe(palette.foreground);
    expect(unselected.background).not.toBe(unselected.text);
    expect(contrastRatio(unselected.background, unselected.text)).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps the selected activity chip readable', async () => {
    const renderer = await mountLogTime(mode);
    await ReactTestRenderer.act(async () => {
      renderer.root.findAllByProps({ accessibilityLabel: 'Internal' })[0].props.onPress();
    });
    await ReactTestRenderer.act(async () => {
      renderer.root.findAllByProps({ accessibilityLabel: 'Meetings' })[0].props.onPress();
    });
    const activity = readChip(renderer, 'Meetings');

    expect(activity.background).toBe(palette.primary);
    expect(activity.text).toBe(palette.onPrimary);
    expect(activity.background).not.toBe(activity.text);
    expect(contrastRatio(activity.background, activity.text)).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps every chip at the touch minimum', async () => {
    const renderer = await mountLogTime(mode);
    const labels = [
      'Set to today',
      'Set to yesterday',
      'Previous day',
      'Project',
      'Add 0.5 hours',
    ];

    const measured = labels.map((label) => ({ label, height: touchHeight(renderer, label) }));
    for (const { label, height } of measured) {
      // Reported per label so a regression names the control it belongs to.
      expect({ label, meetsMinimum: height >= 44 }).toEqual({ label, meetsMinimum: true });
    }
  });
});
