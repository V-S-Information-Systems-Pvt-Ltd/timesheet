

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Text } from 'react-native';
import { colors, getPalette, ThemeProvider, useTheme } from '../src/theme';

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  return [r, g, b];
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(v => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(hex1: string, hex2: string): number {
  const l1 = relativeLuminance(hex1);
  const l2 = relativeLuminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

describe('Theme & Token Consistency (WP-03)', () => {
  it('maps primary action brand color to VSIS Blue and info to Blue', () => {
    expect(colors.primary).toBe('#1E73BE');
    expect(colors.primaryDark).toBe('#185B98');
    expect(colors.info).toBe('#2457D6');
  });

  it('satisfies WCAG AA contrast for light theme text (>4.5:1)', () => {
    const light = getPalette(false);
    const foregroundCardContrast = contrastRatio(light.foreground, light.card);
    const mutedCardContrast = contrastRatio(light.muted, light.card);
    const mutedBgContrast = contrastRatio(light.muted, light.background);

    expect(foregroundCardContrast).toBeGreaterThanOrEqual(7.0); // Slate 900 on white is >18:1
    expect(mutedCardContrast).toBeGreaterThanOrEqual(4.5);
    expect(mutedBgContrast).toBeGreaterThanOrEqual(4.5);
  });

  it('satisfies WCAG AA contrast for dark theme text (>4.5:1)', () => {
    const dark = getPalette(true);
    const foregroundCardContrast = contrastRatio(dark.foreground, dark.card);
    const mutedCardContrast = contrastRatio(dark.muted, dark.card);

    expect(foregroundCardContrast).toBeGreaterThanOrEqual(7.0);
    expect(mutedCardContrast).toBeGreaterThanOrEqual(4.5);
  });

  it('exposes complete semantic tokens in both themes', () => {
    const light = getPalette(false);
    const dark = getPalette(true);

    const requiredKeys = [
      'background',
      'foreground',
      'muted',
      'card',
      'border',
      'placeholder',
      'errorBoxBg',
      'badgeBg',
      'successBoxBg',
      'warningBoxBg',
      'infoBoxBg',
      'progressTrack',
      'divider',
      'primary',
      'primaryLight',
      'primaryDark',
      'onPrimary',
      'info',
      'infoLight',
      'success',
      'warning',
      'error',
    ];

    for (const key of requiredKeys) {
      expect((light as any)[key]).toBeDefined();
      expect((dark as any)[key]).toBeDefined();
    }
  });

  it('dynamically adapts palette based on custom primary color', () => {
    const customTeal = '#0D9488';
    const light = getPalette(false, customTeal);
    const dark = getPalette(true, customTeal);

    expect(light.primary).toBe('#0D9488');
    expect(dark.primary).toBe('#0D9488');
    expect(light.badgeBg).toMatch(/^#[0-9A-F]{6}$/);
    expect(dark.badgeBg).toMatch(/^#[0-9A-F]{6}$/);
  });
});

// P3 provider contract: mounted consumers must read the runtime provider
// palette and must fail fast when rendered without ThemeProvider (no production
// fallback). Custom primary is honored in both light and dark modes.
describe('ThemeProvider contract (P3)', () => {
  function PaletteConsumer() {
    const { palette, isDarkMode } = useTheme();
    return (
      <>
        <Text testID="palette-primary">{palette.primary}</Text>
        <Text testID="palette-darkmode">{String(isDarkMode)}</Text>
      </>
    );
  }

  it('returns the custom primary in both light and dark modes', async () => {
    for (const mode of ['light', 'dark'] as const) {
      let renderer: ReactTestRenderer.ReactTestRenderer;
      await ReactTestRenderer.act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialPreference={mode} primaryColor="#0D9488">
            <PaletteConsumer />
          </ThemeProvider>
        );
      });
      const primary = renderer!.root.findByProps({ testID: 'palette-primary' });
      const dark = renderer!.root.findByProps({ testID: 'palette-darkmode' });
      expect(primary.props.children).toBe('#0D9488');
      expect(dark.props.children).toBe(mode === 'dark' ? 'true' : 'false');
    }
  });

  it('throws when mounted consumer renders outside ThemeProvider', async () => {
    let caught: Error | null = null;
    try {
      await ReactTestRenderer.act(async () => {
        ReactTestRenderer.create(<PaletteConsumer />);
      });
    } catch (err) {
      caught = err instanceof Error ? err : new Error(String(err));
    }
    expect(caught?.message).toContain('useTheme must be used within a ThemeProvider');
  });
});
