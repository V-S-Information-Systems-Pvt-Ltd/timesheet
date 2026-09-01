// R4.3 source guard — no fixed-primary bypasses in mounted signed-in UI.
// docs/plans/MOBILE_ADMIN_CUSTOMIZATION_REVIEW_FINDINGS_FIX_PLAN.md, R4:
//   * mounted authenticated screens/components must read the semantic runtime
//     palette (useScreenPalette/useTheme); `getPalette(isDarkMode)` is allowed
//     only in the theme implementation and disconnected pre-branding UI;
//   * `colors.primary/primaryDark/primaryLight` may not appear in rendered
//     authenticated UI — every remaining match must be in the documented
//     allowlist below.

/* eslint-disable @typescript-eslint/no-var-requires */
// The react-native tsconfig has no Node types; access the API surface this
// test needs via require (already declared by RN types) instead of pulling
// @types/node into the mobile package.
declare const process: { cwd(): string };
const fs = require('fs') as {
  readFileSync(p: string, enc?: string): string;
  readdirSync(p: string): string[];
  statSync(p: string): { isDirectory(): boolean };
};
const nodePath = require('path') as { join(...parts: string[]): string; resolve(...parts: string[]): string };

// jest runs from the mobile package root.
const ROOT = nodePath.resolve(process.cwd());
const SRC = nodePath.join(ROOT, 'src');
const APP_FILE = nodePath.join(ROOT, 'App.tsx');

const PALETTE_CALL_RE = /getPalette\(isDarkMode\)/;
const FIXED_PRIMARY_RE = /colors\.(primary|primaryDark|primaryLight)\b/;

/**
 * Documented fallback allowlist (reason per entry):
 *  - src/theme.ts, src/theme/ThemeContext.tsx — theme implementation defines
 *    the tokens and is the sole owner of getPalette.
 *  - src/screens/SignInScreen.tsx — disconnected UI rendered before any
 *    workspace branding is available (sign-in / connect / pending flows are
 *    pre-authentication).
 *  - App.tsx — its fixed-primary/getPalette usages live exclusively inside the
 *    disconnected pre-branding components (AppErrorBoundary, WelcomeScreen,
 *    ConnectScreen); the mounted MainNavigator and authenticated shell contain
 *    none (enforced below).
 *  - __tests__ — test code asserts token values, not rendered UI.
 */
const ALLOWED_PATHS = [
  'src/theme.ts',
  'src/theme/ThemeContext.tsx',
  'src/screens/SignInScreen.tsx',
  'App.tsx',
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir)) {
    const full = nodePath.join(dir, entry);
    if (fs.statSync(full).isDirectory()) {
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function relative(p: string): string {
  return p.replace(/\\/g, '/').replace(`${ROOT.replace(/\\/g, '/')}/`, '');
}

const sourceFiles = [APP_FILE, ...walk(SRC)].map((p) => p.replace(/\\/g, '/'));

describe('R4.3 theme source guard', () => {
  it('no getPalette(isDarkMode) remains in mounted authenticated code', () => {
    const violations = sourceFiles
      .filter((f) => !ALLOWED_PATHS.includes(relative(f)))
      .filter((f) => PALETTE_CALL_RE.test(fs.readFileSync(f, 'utf8')));
    expect(violations).toEqual([]);
  });

  it('no colors.primary / colors.primaryDark / colors.primaryLight outside the allowlist', () => {
    const violations = sourceFiles
      .filter((f) => !ALLOWED_PATHS.includes(relative(f)) && !relative(f).startsWith('__tests__'))
      .filter((f) => FIXED_PRIMARY_RE.test(fs.readFileSync(f, 'utf8')));
    expect(violations).toEqual([]);
  });

  it('the allowlist itself stays minimal and documented', () => {
    // Guard the guard: the fallback allowlist must not grow silently.
    expect(ALLOWED_PATHS).toEqual([
      'src/theme.ts',
      'src/theme/ThemeContext.tsx',
      'src/screens/SignInScreen.tsx',
      'App.tsx',
    ]);
  });

  it('App.tsx fixed-primary matches belong only to the disconnected components', () => {
    const appSource = fs.readFileSync(APP_FILE, 'utf8');
    const lines = appSource.split(/\r?\n/);
    const offenders: string[] = [];
    lines.forEach((line: string, index: number) => {
      if (!FIXED_PRIMARY_RE.test(line) && !PALETTE_CALL_RE.test(line)) return;
      // MainNavigator and the authenticated shell must not contain matches.
      const inMounted =
        /MainNavigator|AuthenticatedShell|ThemedAppShell|BrandedThemeProvider/.test(line) ||
        (index > 0 && lines.slice(Math.max(0, index - 40), index).join('\n').includes('export function MainNavigator'));
      if (inMounted) offenders.push(`${index + 1}: ${line.trim()}`);
    });
    expect(offenders).toEqual([]);
  });
});