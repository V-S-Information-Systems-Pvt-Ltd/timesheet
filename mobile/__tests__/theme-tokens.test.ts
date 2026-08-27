import { colors, getPalette } from '../src/theme';

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
  it('maps primary action brand color to VSIS Crimson and info to Blue', () => {
    expect(colors.primary).toBe('#E4282F');
    expect(colors.primaryDark).toBe('#C01E25');
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
});
