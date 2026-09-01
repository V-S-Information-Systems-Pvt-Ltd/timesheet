// P3.2 test composition helper: mounted authenticated screens/components must
// render inside a real ThemeProvider; there is intentionally no production
// fallback. Fixtures use this wrapper so provider-palette behavior (mode +
// workspace primary color) is exercised exactly as in the app.

import React from 'react';
import { ThemeProvider, type ThemePreference } from '../src/theme';

interface ScreenThemeProps {
  children: React.ReactNode;
  mode?: ThemePreference;
  primaryColor?: string | null;
}

export function ScreenTheme({
  children,
  mode = 'light',
  primaryColor = null,
}: ScreenThemeProps) {
  return (
    <ThemeProvider initialPreference={mode} primaryColor={primaryColor}>
      {children}
    </ThemeProvider>
  );
}