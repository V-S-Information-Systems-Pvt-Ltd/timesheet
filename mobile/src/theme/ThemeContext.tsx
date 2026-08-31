import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import { themeStore, type ThemePreference } from '../storage/theme-store';
import { getPalette, type Palette } from '../theme';

export interface ThemeContextValue {
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => Promise<void>;
  isDarkMode: boolean;
  palette: Palette;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export interface ThemeProviderProps {
  children: React.ReactNode;
  initialPreference?: ThemePreference;
}

export function ThemeProvider({ children, initialPreference }: ThemeProviderProps) {
  const systemColorScheme = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>(() => {
    return initialPreference || themeStore.getInitialSync();
  });

  useEffect(() => {
    themeStore.get().then((stored) => {
      setPreferenceState((current) => (initialPreference ? current : stored));
    });
  }, [initialPreference]);

  const setPreference = useCallback(async (newPref: ThemePreference) => {
    if (newPref !== 'system' && newPref !== 'light' && newPref !== 'dark') return;
    await themeStore.set(newPref);
    setPreferenceState(newPref);
  }, []);

  const isDarkMode =
    preference === 'dark' ? true : preference === 'light' ? false : systemColorScheme === 'dark';

  const palette = useMemo(() => getPalette(isDarkMode), [isDarkMode]);

  const value = useMemo(
    () => ({
      preference,
      setPreference,
      isDarkMode,
      palette,
    }),
    [preference, setPreference, isDarkMode, palette]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return ctx;
}
