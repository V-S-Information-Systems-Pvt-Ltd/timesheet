import { Platform } from 'react-native';
import { colors, getPalette, resolveFonts, typography, borderRadius, shadows } from '../src/theme';

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).map(v => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const NEW_KEYS = [
  'paper', 'sheet', 'hairline', 'controlBorder', 'logged', 'loggedText', 'loggedTint',
  'leave', 'leaveTint', 'missing', 'missingText', 'missingTint',
] as const;

describe('Timecard tokens', () => {
  it('uses the Timecard light values', () => {
    const p = getPalette(false);
    expect(p.foreground).toBe('#13294B');
    expect(p.paper).toBe('#F3F6F9');
    expect(p.background).toBe('#F3F6F9');
    expect(p.sheet).toBe('#FFFFFF');
    expect(p.muted).toBe('#55657E');
    expect(p.hairline).toBe('#E1E7EF');
    expect(p.controlBorder).toBe('#7D8CA3');
    expect(p.logged).toBe('#2E8B57');
    expect(p.leave).toBe('#5B4590');
    expect(p.missing).toBe('#EA2B32');
    expect(p.missingText).toBe('#C8232A');
  });

  it.each([false, true])('exposes the new keys as hex colours (dark=%s)', dark => {
    const p = getPalette(dark);
    for (const key of NEW_KEYS) expect(p[key]).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it.each([false, true])('keeps the new keys independent of a primary override (dark=%s)', dark => {
    const base = getPalette(dark);
    const custom = getPalette(dark, '#0D9488');
    expect(custom.primary).toBe('#0D9488');
    for (const key of NEW_KEYS) expect(custom[key]).toBe(base[key]);
  });

  it.each([false, true])('keeps text tokens at 4.5:1 or better (dark=%s)', dark => {
    const p = getPalette(dark);
    for (const surface of [p.sheet, p.paper]) {
      expect(contrast(p.foreground, surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.muted, surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.missingText, surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.error, surface)).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(p.loggedText, p.loggedTint)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(p.leave, p.leaveTint)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(p.missingText, p.missingTint)).toBeGreaterThanOrEqual(4.5);
  });

  it.each([false, true])('gives control borders 3:1 non-text contrast on sheet and paper (dark=%s)', dark => {
    const p = getPalette(dark);
    for (const surface of [p.sheet, p.paper]) expect(contrast(p.controlBorder, surface)).toBeGreaterThanOrEqual(3);
  });

  it('uses the Timecard type scale, radii and flat shadows', () => {
    expect(typography.title).toBe(26);
    expect(typography.heading).toBe(15);
    expect(typography.body).toBe(15);
    expect(typography.caption).toBe(12);
    expect(typography.badge).toBeGreaterThanOrEqual(11);
    expect(borderRadius.control).toBe(10);
    expect(borderRadius.sheet).toBe(18);
    expect(shadows.sm.shadowOpacity).toBe(0);
    expect(shadows.md.elevation).toBe(0);
    expect(colors.placeholder).toBeDefined();
  });
});

describe('fonts', () => {
  it('resolves Barlow per platform', () => {
    expect(resolveFonts('android')).toEqual({
      numeral: 'BarlowSemiCondensed-SemiBold',
      numeralMedium: 'BarlowSemiCondensed-Medium',
    });
    expect(resolveFonts('ios')).toEqual(resolveFonts('android'));
  });

  it('uses the system font on Windows, where bundled fonts cannot be registered', () => {
    expect(resolveFonts('windows')).toEqual({ numeral: undefined, numeralMedium: undefined });
  });

  it('falls back to the system font on an unknown platform', () => {
    expect(resolveFonts('web')).toEqual({ numeral: undefined, numeralMedium: undefined });
  });

  it('derives the exported fonts from Platform.OS at load time', () => {
    const original = Platform.OS;
    Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'ios' });
    try {
      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { fonts } = require('../src/theme');
        expect(fonts.numeral).toBe('BarlowSemiCondensed-SemiBold');
      });
    } finally {
      Object.defineProperty(Platform, 'OS', { configurable: true, get: () => original });
    }
  });
});

describe('Text contrast (WCAG AA 4.5:1)', () => {
  const MODES = [false, true] as const;
  // Default, a yellow and a pale blue (too light on white), and a near-black (too dark on dark cards).
  const BRANDS = [undefined, '#FFD400', '#9CC9F5', '#0A0A14'];

  it.each(MODES)('keeps primaryText readable on every surface it sits on (dark=%s)', (dark) => {
    for (const brand of BRANDS) {
      const p = getPalette(dark, brand);
      for (const surface of [p.sheet, p.paper, p.primaryLight]) {
        expect({ brand, surface, ratio: contrast(p.primaryText, surface) >= 4.5 }).toEqual({ brand, surface, ratio: true });
      }
    }
  });

  it('leaves the default light primaryText close to the brand blue', () => {
    expect(contrast(getPalette(false).primaryText, getPalette(false).primary)).toBeLessThan(1.2);
  });

  it.each(MODES)('keeps body text pairs readable (dark=%s)', (dark) => {
    const p = getPalette(dark);
    const pairs: [string, string][] = [
      [p.foreground, p.paper], [p.foreground, p.sheet],
      [p.muted, p.paper], [p.muted, p.sheet],
      [p.placeholder, p.sheet],
      [p.loggedText, p.loggedTint], [p.missingText, p.missingTint], [p.leave, p.leaveTint],
    ];
    for (const [fg, bg] of pairs) expect(`${fg} on ${bg}: ${contrast(fg, bg) >= 4.5}`).toBe(`${fg} on ${bg}: true`);
  });
});
