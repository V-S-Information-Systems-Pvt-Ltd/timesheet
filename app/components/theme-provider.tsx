'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { THEME_COOKIE, type Theme, type ResolvedTheme } from './theme'

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365
const DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)'

interface ThemeContextValue {
  theme: Theme
  resolvedTheme: ResolvedTheme
  setTheme: (theme: Theme) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

function subscribeSystemTheme(onChange: () => void) {
  const media = window.matchMedia(DARK_MEDIA_QUERY)
  media.addEventListener('change', onChange)
  return () => media.removeEventListener('change', onChange)
}

function systemPrefersDark() {
  return window.matchMedia(DARK_MEDIA_QUERY).matches
}

function serverPrefersDark() {
  return false
}

export function ThemeProvider({ initialTheme = 'system', children }: { initialTheme?: Theme; children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(initialTheme)
  // The server snapshot keeps hydration deterministic. The pre-paint script
  // already applied the OS theme; this store takes over for live OS changes.
  const systemDark = useSyncExternalStore(subscribeSystemTheme, systemPrefersDark, serverPrefersDark)
  const resolvedTheme: ResolvedTheme = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme

  useEffect(() => {
    const dark = theme === 'system' ? systemPrefersDark() : resolvedTheme === 'dark'
    document.documentElement.classList.toggle('dark', dark)
  }, [theme, resolvedTheme])

  const setTheme = useCallback((next: Theme) => {
    document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`
    setThemeState(next)
  }, [])

  const value = useMemo<ThemeContextValue>(() => ({ theme, resolvedTheme, setTheme }), [theme, resolvedTheme, setTheme])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider')
  return ctx
}
